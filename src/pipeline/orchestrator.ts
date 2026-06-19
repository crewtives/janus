import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/loader.ts";
import type { JanusConfig, ProjectConfig } from "../config/types.ts";
import { Checkpoint } from "../core/checkpoint.ts";
import { resolveRunner } from "../runners/registry.ts";
import { RunnerError } from "../runners/types.ts";
import { getActivity } from "../core/git.ts";
import { writePulse, readIfExists, roadmapPath, claudeMdPath, readStrategy, readRepoReadme } from "../core/obsidian.ts";
import { findSessionsForDate, summarizeSession } from "../core/sessions.ts";
import { loadPreviousPulses } from "../core/previous-pulses.ts";
import { detectStrategyStatus } from "../core/strategy-status.ts";
import { loadUserEdits } from "../core/user-edits.ts";
import { loadActiveTracks } from "../core/active-tracks.ts";
import { buildPromptContext, PROMPT_VERSION, renderDailyPulsePrompt, loadVoiceSpec } from "../core/template.ts";
import { detectProjectAnniversary, renderAnniversaryCallout } from "../core/reflection/anniversaries.ts";
import { loadDayLastYearAnchor } from "../core/reflection/anchors.ts";
import { validatePulse } from "../core/validate-pulse.ts";
import { notifyDiscord, type ProjectResult } from "../core/discord.ts";
import { writeDailyConsolidated } from "../core/daily.ts";
import { AbortError, makeQueue, withRetry } from "./queue.ts";

export interface RunPulseOptions {
  backfill?: string | undefined;
  project?: string | undefined;
  since?: string | undefined;
  /** Process exactly this date (YYYY-MM-DD). Takes precedence over since/backfill. */
  date?: string | undefined;
  dryRun?: boolean | undefined;
  /** Reprocess even if a (project, date) is already marked done — overrides idempotency. */
  force?: boolean | undefined;
}

export async function runPulse(opts: RunPulseOptions): Promise<void> {
  const config = await loadConfig();
  const projects = filterProjects(config.projects, opts.project);
  if (projects.length === 0) {
    console.error("No projects to process (check --project or config.local.json).");
    process.exit(1);
  }

  const dates = determineDates(opts);
  console.log(`[janus] projects: ${projects.map((p) => p.name).join(", ")}`);
  console.log(`[janus] dates: ${dates.join(", ")}`);
  console.log(`[janus] dry-run: ${opts.dryRun ? "yes" : "no"}`);
  if (opts.force) console.log(`[janus] force: yes — reprocessing even if already done`);

  const stateDir = config.stateDir!;
  await mkdir(stateDir, { recursive: true });

  const cp = Checkpoint.open(stateDir);
  const queue = makeQueue({
    concurrency: config.concurrency!,
    intervalCap: config.intervalCap!,
    intervalMs: config.intervalMs!,
    taskTimeoutMs: config.taskTimeoutMs!,
    retries: 2,
  });

  const results: ProjectResult[] = [];
  const failedPath = join(stateDir, "failed.jsonl");

  // Track completions per date — fires daily consolidated + Discord ping
  // when all tasks for a date are done (ok, failed, or skipped).
  interface DateCounter {
    expected: number;
    completed: number;
    results: ProjectResult[];
    notified: boolean;
  }
  const dateCounters = new Map<string, DateCounter>();
  for (const date of dates) {
    dateCounters.set(date, { expected: 0, completed: 0, results: [], notified: false });
  }

  const onDateMaybeComplete = async (date: string) => {
    const c = dateCounters.get(date);
    if (!c || c.notified || c.completed < c.expected) return;
    c.notified = true;
    if (!opts.dryRun) {
      const daily = await writeDailyConsolidated({
        vaultPath: config.obsidianVault,
        date,
        results: c.results,
        config,
      });
      if (daily) {
        const tag = daily.llmGenerated ? "[LLM]" : "[fallback]";
        console.log(`[janus] daily consolidated ${tag}: ${daily.path} (${daily.projectCount} projects)`);
      }
      if (config.discord?.webhookUrl) {
        await notifyDiscord(config.discord, c.results, [date]);
      }
    }
  };

  // Serialize per project: each project is enqueued as ONE task that
  // processes its dates in ascending chronological order. p-queue runs N
  // projects in parallel (global concurrency), but within a single project
  // dates run serially — guaranteeing that when day N is processed, day
  // N-1's pulse is already written to disk, and the
  // `Pulse anterior: [[YYYY-MM-DD-<project>]]` wiki-links point to the
  // immediately previous one without race conditions.
  for (const project of projects) {
    if (project.status === "archived") {
      console.log(`[${project.name}] skip — project archived in config`);
      continue;
    }
    const pendingDates: string[] = [];
    for (const date of dates) {
      if (cp.isDone(project.name, date) && !opts.dryRun && !opts.force) {
        console.log(`[${project.name}/${date}] skip — already done`);
        continue;
      }
      const counter = dateCounters.get(date)!;
      counter.expected += 1;
      pendingDates.push(date);
    }
    if (pendingDates.length === 0) continue;

    queue.add(async () => {
      // Sort ascending: day N depends on day N-1 already being written.
      pendingDates.sort();
      for (const date of pendingDates) {
        const counter = dateCounters.get(date)!;
        try {
          const res = await withRetry(
            () => processProject({ project, date, config, cp, dryRun: !!opts.dryRun }),
            { retries: 2 },
          );
          if (res) {
            results.push(res);
            counter.results.push(res);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[${project.name}/${date}] FAILED:`, message);
          if (!opts.dryRun) {
            cp.markFailed({ project: project.name, date, error: message });
            await appendFile(
              failedPath,
              JSON.stringify({ project: project.name, date, error: message, at: new Date().toISOString() }) + "\n",
            );
          }
          const failedResult: ProjectResult = { project: project.name, date, status: "failed", error: message };
          results.push(failedResult);
          counter.results.push(failedResult);
        }
        counter.completed += 1;
        await onDateMaybeComplete(date);
      }
    });
  }

  await queue.onIdle();
  cp.close();

  // Fallback: if any date was never notified (all projects skipped by idempotency,
  // expected === 0 → the callback never ran) → there's nothing to notify anyway. OK.
  printSummary(results);

  // Enrich the vault (idempotent). Only when at least one real ok exists to avoid touching files in dry-run.
  if (!opts.dryRun && results.some((r) => r.status === "ok")) {
    try {
      const { enrichVault } = await import("../core/enrich.ts");
      const er = await enrichVault(config);
      console.log(
        `[janus] vault enriched — ${er.indexesWritten} _index · ${er.roadmapsWritten} _roadmap · ${er.strategiesWritten} STRATEGY (${er.projectsProcessed} projects)`,
      );
    } catch (err) {
      console.warn(`[janus] enrich-vault failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }

    // Vault scaffolding (hubs + MOCs + dashboards). Idempotent: if files
    // already exist, they are not touched. Without this, the wiki-links each
    // pulse generates (`[[<project>]]`, `[[Decisions MOC]]`, `[[Janus Pulse]]`,
    // etc.) end up broken in the Obsidian graph view. Best-effort, non-fatal.
    //
    // Runs in-process so it works from the compiled binary too: there is no
    // `scripts/` directory in the binary's filesystem, and launchd's minimal
    // PATH would not find `bun` either.
    try {
      const [{ generateHubs }, { generateMocs }, { generateDashboards }, { fixAllRelated }] =
        await Promise.all([
          import("../core/scaffold/hubs.ts"),
          import("../core/scaffold/mocs.ts"),
          import("../core/scaffold/dashboards.ts"),
          import("../core/scaffold/fix-related.ts"),
        ]);

      const hubsSummary = await generateHubs({ config });
      console.log(
        `[janus] [hubs] resumen: ${hubsSummary.created} creados, ${hubsSummary.skipped} skipped (de ${hubsSummary.total})`,
      );

      const mocsSummary = await generateMocs({ config });
      console.log(
        `[janus] [mocs] resumen: ${mocsSummary.created} creados, ${mocsSummary.skipped} skipped (de ${mocsSummary.total})`,
      );

      const dashSummary = await generateDashboards({ config });
      console.log(
        `[janus] [dashboards] resumen: ${dashSummary.created} creados, ${dashSummary.skipped} skipped (de ${dashSummary.total})`,
      );

      const fixSummary = await fixAllRelated({ config, dryRun: false });
      console.log(
        `[janus] [fix-prev] fixed ${fixSummary.totalChanged}/${fixSummary.totalScanned} pulses`,
      );
    } catch (err) {
      console.warn(`[janus] scaffold failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }

    // Monthly auto-trigger: if any processed date is the first day of its
    // month, generate the previous month's monthly digest + archive pulses.
    try {
      const { isFirstOfMonth, previousMonth, writeMonthlyDigest } = await import("../core/monthly.ts");
      const triggers = [...new Set(dates.filter(isFirstOfMonth).map(previousMonth))];
      for (const month of triggers) {
        console.log(`[janus] triggering monthly digest for ${month} (month rollover detected)`);
        const r = await writeMonthlyDigest({ vaultPath: config.obsidianVault, month, config });
        if (r) {
          console.log(`[janus] monthly ✓ ${r.path} · ${r.pulsesArchived} pulses archived`);
        }
      }
    } catch (err) {
      console.warn(`[janus] monthly auto-trigger failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function runRetry(opts: { from: string }): Promise<void> {
  const text = await Bun.file(opts.from).text();
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) {
    console.log("[janus] nothing to retry.");
    return;
  }
  console.log(`[janus] retrying ${lines.length} entries from ${opts.from}`);
  const config = await loadConfig();
  const cp = Checkpoint.open(config.stateDir!);

  const queue = makeQueue({
    concurrency: config.concurrency!,
    intervalCap: config.intervalCap!,
    intervalMs: config.intervalMs!,
    taskTimeoutMs: config.taskTimeoutMs!,
    retries: 2,
  });

  const results: ProjectResult[] = [];
  for (const line of lines) {
    const entry = safeParseEntry(line);
    if (!entry) continue;
    const project = config.projects.find((p) => p.name === entry.project);
    if (!project) {
      console.warn(`[retry] project ${entry.project} not in config, skip`);
      continue;
    }
    queue
      .add(() =>
        withRetry(() => processProject({ project, date: entry.date, config, cp, dryRun: false }), { retries: 2 }),
      )
      .then((res) => res && results.push(res))
      .catch((err: unknown) => {
        const m = err instanceof Error ? err.message : String(err);
        results.push({ project: project.name, date: entry.date, status: "failed", error: m });
      });
  }
  await queue.onIdle();
  cp.close();
  printSummary(results);
}

async function processProject(args: {
  project: ProjectConfig;
  date: string;
  config: JanusConfig;
  cp: Checkpoint;
  dryRun: boolean;
}): Promise<ProjectResult> {
  const { project, date, config, cp, dryRun } = args;
  const tag = `[${project.name}/${date}]`;
  const sessionId = randomUUID();

  console.log(`${tag} starting (session ${sessionId.slice(0, 8)})`);
  if (!dryRun) {
    cp.markStarted({ project: project.name, date, sessionId, promptVersion: PROMPT_VERSION });
  }

  const sinceISO = new Date(`${date}T00:00:00`).toISOString();
  const untilISO = new Date(`${date}T23:59:59.999`).toISOString();

  const [activity, roadmap, claudeMd, strategyMd, readmeMd, sessionFiles, previousPulses, strategyStatus, userEdits, activeTracks, voice, anniversary, dayLastYear] = await Promise.all([
    getActivity(project.repoPath, sinceISO, untilISO),
    readIfExists(roadmapPath(project.obsidianPath)),
    readIfExists(claudeMdPath(project.repoPath)),
    readStrategy(project.obsidianPath, project.repoPath),
    readRepoReadme(project.repoPath),
    findSessionsForDate(project.repoPath, date),
    loadPreviousPulses({ obsidianPath: project.obsidianPath, currentDate: date, daysBack: 7 }),
    detectStrategyStatus({ obsidianPath: project.obsidianPath, repoPath: project.repoPath, currentDate: date }),
    loadUserEdits({ checkpoint: cp, project: project.name, obsidianPath: project.obsidianPath, currentDate: date }),
    loadActiveTracks({ vaultPath: config.obsidianVault, project: project.name }),
    loadVoiceSpec(),
    detectProjectAnniversary({ project, checkpoint: cp, today: date }).catch(() => null),
    loadDayLastYearAnchor({ obsidianPath: project.obsidianPath, project: project.name, today: date }).catch(() => null),
  ]);
  const sessions = await Promise.all(sessionFiles.map(summarizeSession));
  if (anniversary) {
    console.log(`${tag} anniversary detected: ${anniversary.years} year(s) since ${anniversary.sinceDate} (${anniversary.source})`);
    // Phase 3 U4 — auto-trigger per-project Wrapped.
    // Idempotent: if the file already exists on disk, it is not regenerated.
    if (!dryRun) {
      try {
        const wrappedPath = join(project.obsidianPath, `${project.name}-wrapped-${date.slice(0, 4)}.md`);
        if (!(await Bun.file(wrappedPath).exists())) {
          const { aggregateWrappedData } = await import("../core/wrapped/aggregator.ts");
          const { computePersonality } = await import("../core/wrapped/personality.ts");
          const { renderWrapped } = await import("../core/wrapped/renderer.ts");
          const data = await aggregateWrappedData({
            config,
            scope: "project",
            year: parseInt(date.slice(0, 4), 10),
            project: project.name,
          });
          data.personality = await computePersonality({ config, data, deterministicOnly: true });
          const result = await renderWrapped({ config, data });
          console.log(`${tag} per-project Wrapped generated: ${result.path} (llm=${result.llmGenerated})`);
        }
      } catch (err) {
        console.warn(`${tag} per-project Wrapped failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Paused: only process if there are commits that day (avoids generating
  // endless idle pulses for inactive projects). Marks done for idempotency.
  if (project.status === "paused" && activity.commits.length === 0 && sessions.length === 0) {
    console.log(`${tag} skip — project paused and no activity that day`);
    if (!dryRun) {
      // Mark done without an output_path so it isn't retried.
      cp.markDone({ project: project.name, date, outputPath: "" });
    }
    return { project: project.name, date, status: "ok", contentPreview: "(paused — no activity)" };
  }

  // Suppress the roadmap draft if the last 3 pulses for this project were inferring without action.
  const suppressRoadmapDraft = await shouldSuppressRoadmapDraft(project, date);

  // vaultRelPath = obsidianPath without the vault prefix (e.g. "Projects/crewtives/acme/app")
  const vaultRelPath = relativeVaultPath(config.obsidianVault, project.obsidianPath);

  const ctx = buildPromptContext({
    project: project.name,
    date,
    voice,
    strategyMd,
    roadmap,
    readmeMd,
    claudeMd,
    activity,
    sessions,
    suppressRoadmapDraft,
    vaultRelPath,
    previousRisks: previousPulses.risks,
    previousDecisions: previousPulses.decisions,
    hasPreviousPulse: previousPulses.immediatePrevious !== null,
    previousPulseFilename: previousPulses.immediatePrevious?.filename ?? "",
    idleStreakBefore: previousPulses.idleStreakBefore,
    strategyStatus: strategyStatus.status,
    strategyDaysAsDraft: strategyStatus.daysAsDraft,
    userEdits,
    activeTracks: activeTracks.map((t) => ({ slug: t.slug, name: t.name, emoji: t.emoji, status: t.status })),
    anniversaryCallout: anniversary ? renderAnniversaryCallout(anniversary, project.name) : "",
    anniversaryYears: anniversary?.years ?? 0,
    anniversarySince: anniversary?.sinceDate ?? "",
    dayLastYear,
  });

  if (userEdits.length > 0) {
    console.log(`${tag} injecting ${userEdits.length} user edit(s) into prompt (feedback loop)`);
  }
  const prompt = await renderDailyPulsePrompt(ctx);

  if (dryRun) {
    console.log(`${tag} dry-run — prompt rendered (${prompt.length} chars). Skip claude.`);
    return { project: project.name, date, status: "dry-run", contentPreview: prompt.slice(0, 240) };
  }

  let content: string;
  // Pass repoPath so the privacy layer can collapse absolute repo paths in the
  // raw session transcripts to `<repo>` (documented in docs/PRIVACY.md). Without
  // it the `<repo>` substitution is dead — paths only ever collapse to `~`.
  const runner = resolveRunner(config, project.repoPath);
  try {
    const claudeResult = await runner.run({
      prompt,
      cwd: project.repoPath,
      model: config.model!,
      effort: config.effort!,
      fallbackModel: config.fallbackModel,
      addDirs: [project.obsidianPath],
      sessionId,
      maxTurns: 30,
      timeoutMs: config.taskTimeoutMs!,
    });
    content = claudeResult.resultText.trim();
  } catch (err) {
    if (err instanceof RunnerError && !err.retriable) {
      throw new AbortError(`${runner.id} error (no retry): ${err.message}`);
    }
    throw err;
  }

  if (!content) {
    throw new Error("claude returned empty content");
  }

  // Validate output. On failure, one retry with the errors in the prompt.
  let validation = validatePulse(content);
  if (!validation.valid) {
    console.warn(`${tag} validation failed (${validation.errors.join("; ")}) — retrying with feedback`);
    const retryPrompt =
      `${prompt}\n\n# ERROR IN PREVIOUS ATTEMPT\n\nYour previous attempt had these validation errors:\n- ${validation.errors.join("\n- ")}\n\nGenerate the report again, respecting ALL hard rules. Start with \`---\`. No preamble.`;
    const retryResult = await runner.run({
      prompt: retryPrompt,
      cwd: project.repoPath,
      model: config.model!,
      effort: config.effort!,
      fallbackModel: config.fallbackModel,
      addDirs: [project.obsidianPath],
      sessionId: randomUUID(),
      maxTurns: 30,
      timeoutMs: config.taskTimeoutMs!,
    });
    content = retryResult.resultText.trim();
    validation = validatePulse(content);
    if (!validation.valid) {
      throw new AbortError(`pulse invalid after retry: ${validation.errors.join("; ")}`);
    }
  }
  if (validation.warnings.length > 0) {
    console.warn(`${tag} validation warnings: ${validation.warnings.join("; ")}`);
  }

  const { obsidianTarget, repoTarget } = await writePulse({
    obsidianPath: project.obsidianPath,
    repoPath: project.repoPath,
    project: project.name,
    date,
    content,
  });
  cp.markDone({ project: project.name, date, outputPath: obsidianTarget });
  // Capture baseline for the feedback loop. If the user edits the file
  // later, the next pulse compares against this baseline and injects the diff.
  cp.saveBaseline({ project: project.name, date, generatedContent: content });

  // Decision graph (Phase 1C) — index which ADRs the pulse references.
  // Best-effort, non-fatal.
  try {
    const { indexPulseDecisions } = await import("../core/decision-graph.ts");
    const dg = indexPulseDecisions({
      checkpoint: cp,
      pulseContent: content,
      pulseDate: date,
      project: project.name,
    });
    if (dg.indexed > 0) {
      console.log(`${tag} decision graph: ${dg.indexed} ADR reference(s) indexed`);
    }
  } catch (err) {
    console.warn(`${tag} decision graph failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  // Index the pulse in FTS5 (best-effort, non-fatal).
  try {
    const { SearchIndex } = await import("../core/search-index.ts");
    const idx = SearchIndex.open(config.stateDir!);
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const statusM = fmMatch ? fmMatch[1]!.match(/^status:\s*(.+)$/m) : null;
    const status = statusM?.[1]?.trim() ?? null;
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    const titleM = body.match(/^#\s+(.+)$/m) ?? body.match(/^##\s+(.+)$/m);
    const title = titleM?.[1]?.trim() ?? `${project.name} ${date}`;
    const docId = obsidianTarget.startsWith(config.obsidianVault)
      ? obsidianTarget.slice(config.obsidianVault.length).replace(/^\/+/, "")
      : obsidianTarget;
    idx.upsert({ docId, project: project.name, date, kind: "pulse", status, title, body });
    idx.close();
  } catch (err) {
    console.warn(`${tag} index (FTS5) failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`${tag} ✓ written to ${obsidianTarget}`);
  console.log(`${tag} ✓ written to ${repoTarget}`);

  return {
    project: project.name,
    date,
    status: "ok",
    obsidianPath: obsidianTarget,
    repoPath: repoTarget,
    contentPreview: content.slice(0, 240),
  };
}

/**
 * Looks at the last 3 pulses for this project on disk. If all 3 have `status: inferring`,
 * the user did not act on the previous drafts → suppress today's draft to avoid repetition.
 */
async function shouldSuppressRoadmapDraft(project: ProjectConfig, currentDate: string): Promise<boolean> {
  const { readdir } = await import("node:fs/promises");
  const pulseDir = join(project.obsidianPath, "pulse");
  let entries: string[];
  try {
    entries = await readdir(pulseDir);
  } catch {
    return false;
  }
  const prevPulses = entries
    .filter((f) => f.endsWith(".md") && f < `${currentDate}--`)
    .sort()
    .reverse()
    .slice(0, 3);
  if (prevPulses.length < 3) return false;
  for (const name of prevPulses) {
    const content = await Bun.file(join(pulseDir, name)).text();
    const m = content.match(/^status:\s*(.+)$/m);
    const status = m && m[1] ? m[1].trim() : "";
    if (status !== "inferring") return false;
  }
  return true;
}

function relativeVaultPath(vaultRoot: string, projectObsidianPath: string): string {
  const rel = projectObsidianPath.startsWith(vaultRoot)
    ? projectObsidianPath.slice(vaultRoot.length).replace(/^\/+/, "")
    : projectObsidianPath;
  return rel;
}

function filterProjects(projects: ProjectConfig[], name?: string): ProjectConfig[] {
  if (!name) return projects;
  return projects.filter((p) => p.name === name);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function determineDates(opts: RunPulseOptions): string[] {
  if (opts.date) {
    if (!ISO_DATE_RE.test(opts.date)) {
      throw new Error(`--date invalid: ${opts.date} (expected YYYY-MM-DD)`);
    }
    return [opts.date];
  }
  if (opts.since) {
    return datesBetween(opts.since, todayLocal());
  }
  if (opts.backfill) {
    const m = opts.backfill.match(/^(\d+)\s*d$/i);
    if (!m || !m[1]) throw new Error(`--backfill invalid: ${opts.backfill} (expected '7d')`);
    const days = parseInt(m[1], 10);
    const start = new Date();
    start.setDate(start.getDate() - days);
    return datesBetween(formatDate(start), yesterdayLocal());
  }
  return [yesterdayLocal()];
}

function todayLocal(): string {
  return formatDate(new Date());
}

function yesterdayLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDate(d);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const startD = new Date(`${start}T00:00:00`);
  const endD = new Date(`${end}T00:00:00`);
  for (let d = startD; d <= endD; d.setDate(d.getDate() + 1)) {
    out.push(formatDate(d));
  }
  return out;
}

function safeParseEntry(line: string): { project: string; date: string } | null {
  try {
    const obj = JSON.parse(line) as { project?: unknown; date?: unknown };
    if (typeof obj.project === "string" && typeof obj.date === "string") {
      return { project: obj.project, date: obj.date };
    }
    return null;
  } catch {
    return null;
  }
}

function printSummary(results: ProjectResult[]): void {
  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const dry = results.filter((r) => r.status === "dry-run").length;
  console.log(`\n[janus] summary: ${ok} ok, ${failed} failed, ${dry} dry-run`);
}
