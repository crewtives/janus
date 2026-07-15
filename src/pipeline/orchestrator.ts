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
import { relativeVaultPath } from "../core/vault-path.ts";
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

  const stateDir = config.stateDir!;
  await mkdir(stateDir, { recursive: true });

  const cp = Checkpoint.open(stateDir);

  let dates = determineDates(opts);
  // Catch-up backstop, same reasoning as the monthly/weekly ones below: launchd
  // does not re-run what it missed, and the cron path only ever asks for
  // yesterday — so a failed pulse or a day the machine slept through is lost
  // forever.
  if (shouldCatchUp(opts)) {
    const catchUp = computeCatchUpDates({
      cp,
      projects,
      yesterday: yesterdayLocal(),
      windowDays: CATCH_UP_WINDOW_DAYS,
    }).filter((e) => !dates.includes(e.date));
    if (catchUp.length > 0) {
      for (const e of catchUp) {
        const why = e.reason === "failed" ? "previous run failed" : "no pulse recorded";
        console.log(`[janus] catch-up ${e.project}/${e.date} — ${why}`);
      }
      dates = [...new Set([...dates, ...catchUp.map((e) => e.date)])].sort();
    }
  }

  console.log(`[janus] projects: ${projects.map((p) => p.name).join(", ")}`);
  console.log(`[janus] dates: ${dates.join(", ")}`);
  console.log(`[janus] dry-run: ${opts.dryRun ? "yes" : "no"}`);
  if (opts.force) console.log(`[janus] force: yes — reprocessing even if already done`);

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
  // Signal failure to whatever supervises the run. process.exitCode, never
  // process.exit(): the enrich + self-heal blocks below still have to run.
  if (results.some((r) => r.status === "failed")) process.exitCode = 1;

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

    // Monthly auto-trigger: the calendar path fires when a processed date is a
    // first-of-month (generate the prior month). The self-heal backstop (U2)
    // unions in any fully-elapsed month whose digest is missing — so a run that
    // slept through the first-of-month still catches up on the next run.
    try {
      const { isFirstOfMonth, previousMonth, writeMonthlyDigest, pendingMonthlyDigests } =
        await import("../core/monthly.ts");
      const calendar = dates.filter(isFirstOfMonth).map(previousMonth);
      const upTo = dates.reduce((a, b) => (a > b ? a : b));
      const selfHeal = await pendingMonthlyDigests({ vaultPath: config.obsidianVault, upToDate: upTo });
      const triggers = [...new Set([...calendar, ...selfHeal])];
      for (const month of triggers) {
        console.log(`[janus] triggering monthly digest for ${month} (auto-trigger)`);
        const r = await writeMonthlyDigest({ vaultPath: config.obsidianVault, month, config });
        if (r) {
          console.log(`[janus] monthly ✓ ${r.path} · ${r.pulsesArchived} pulses archived`);
        }
      }
    } catch (err) {
      console.warn(`[janus] monthly auto-trigger failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }

    // Weekly self-heal (U1): generate any completed (Sunday-ending) week whose
    // rollup file is missing, back to the last existing weekly. Because launchd
    // does not catch up missed runs, this self-heals a multi-week gap on the
    // next run rather than firing only on a boundary day. Best-effort,
    // non-fatal — mirrors the monthly block above. Derives purely from the
    // run's `dates`; lives in the post-run block, not the per-project queue.
    try {
      const { weeklySelfHeal } = await import("./rollup-runner.ts");
      const upTo = dates.reduce((a, b) => (a > b ? a : b));
      const generated = await weeklySelfHeal({ config, upToDate: upTo });
      for (const sunday of generated) {
        console.log(`[janus] weekly ✓ ${sunday}-week.md (self-heal)`);
      }
    } catch (err) {
      console.warn(`[janus] weekly auto-trigger failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function runRetry(opts: { from: string; force?: boolean | undefined }): Promise<void> {
  const text = await Bun.file(opts.from).text();
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) {
    console.log("[janus] nothing to retry.");
    return;
  }
  const config = await loadConfig();
  const cp = Checkpoint.open(config.stateDir!);

  const { planned, skipped } = planRetry({ lines, projects: config.projects, cp, force: opts.force });
  for (const s of skipped) console.log(`[retry] ${s.project}:${s.date} — ${s.reason}`);

  console.log(`[janus] retrying ${planned.length} of ${lines.length} entries from ${opts.from}`);
  if (opts.force) console.log(`[janus] force: yes — reprocessing even if already done`);

  const queue = makeQueue({
    concurrency: config.concurrency!,
    intervalCap: config.intervalCap!,
    intervalMs: config.intervalMs!,
    taskTimeoutMs: config.taskTimeoutMs!,
    retries: 2,
  });

  const results: ProjectResult[] = [];
  const stillFailing: Array<{ project: string; date: string; error: string; at: string }> = [];
  for (const { project, date } of planned) {
    void queue.add(async () => {
      try {
        const res = await withRetry(() => processProject({ project, date, config, cp, dryRun: false }), {
          retries: 2,
        });
        if (res) results.push(res);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error(`[retry] ${project.name}/${date} FAILED:`, m);
        results.push({ project: project.name, date, status: "failed", error: m });
        stillFailing.push({ project: project.name, date, error: m, at: new Date().toISOString() });
      }
    });
  }
  await queue.onIdle();
  cp.close();

  // Rewrite the dead-letter with what is still dead. Everything else was either
  // repaired now or was already stale — keeping it would make the next retry
  // replay the same destructive set.
  await Bun.write(opts.from, stillFailing.map((e) => JSON.stringify(e) + "\n").join(""));
  console.log(`[janus] dead-letter rewritten: ${stillFailing.length} entries still failing`);

  // A repaired pulse leaves the daily still lying: it is written once, when the
  // date's tasks complete, and nothing revisits it. writeDailyConsolidated
  // re-reads the day's pulses from disk, so this picks up the repair.
  const repairedDates = [...new Set(results.filter((r) => r.status === "ok").map((r) => r.date))].sort();
  for (const date of repairedDates) {
    const daily = await writeDailyConsolidated({
      vaultPath: config.obsidianVault,
      date,
      results: results.filter((r) => r.date === date),
      config,
    });
    if (daily) {
      const tag = daily.llmGenerated ? "[LLM]" : "[fallback]";
      console.log(`[janus] daily consolidated ${tag}: ${daily.path} (${daily.projectCount} projects)`);
    }
  }

  printSummary(results);
}

export interface RetryPlan {
  planned: Array<{ project: ProjectConfig; date: string }>;
  skipped: Array<{ project: string; date: string; reason: string }>;
}

/**
 * Decides what a `janus retry` actually reprocesses. The dead-letter is
 * append-only: it accumulates duplicates and entries that a later run already
 * repaired. Replaying it verbatim reprocesses pulses that are already good —
 * writePulse overwrites without a backup and saveBaseline resets the feedback
 * loop's baseline — so a blind replay destroys work instead of restoring it.
 */
export function planRetry(args: {
  lines: string[];
  projects: ProjectConfig[];
  cp: Pick<Checkpoint, "isDone">;
  force?: boolean | undefined;
}): RetryPlan {
  const { lines, projects, cp, force } = args;
  const seen = new Set<string>();
  const plan: RetryPlan = { planned: [], skipped: [] };
  for (const line of lines) {
    const entry = safeParseEntry(line);
    if (!entry) continue;
    const key = `${entry.project}:${entry.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const project = projects.find((p) => p.name === entry.project);
    if (!project) {
      plan.skipped.push({ ...entry, reason: "project not in config" });
      continue;
    }
    if (project.status === "archived") {
      plan.skipped.push({ ...entry, reason: "project archived in config" });
      continue;
    }
    if (cp.isDone(entry.project, entry.date) && !force) {
      plan.skipped.push({ ...entry, reason: "already done, skip (use --force to reprocess)" });
      continue;
    }
    plan.planned.push({ project, date: entry.date });
  }
  return plan;
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
  const sessions = await Promise.all(sessionFiles.map((f) => summarizeSession(f, date)));
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
  // The pulse is valid, but validation may have salvaged it by cutting a preamble: persist what it
  // vetted, not the raw answer. Skipping this is how a stripped preamble reaches the vault anyway.
  if (validation.sanitized) content = validation.sanitized;
  if (validation.warnings.length > 0) {
    console.warn(`${tag} validation warnings: ${validation.warnings.join("; ")}`);
  }

  const { obsidianTarget } = await writePulse({
    obsidianPath: project.obsidianPath,
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

  return {
    project: project.name,
    date,
    status: "ok",
    obsidianPath: obsidianTarget,
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

function filterProjects(projects: ProjectConfig[], name?: string): ProjectConfig[] {
  if (!name) return projects;
  return projects.filter((p) => p.name === name);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How far back the catch-up looks. 7 days bounds the worst case to one LLM
 * call per project per day of a week — a long outage (or a wiped state.db)
 * degrades into a small recovery instead of an accidental multi-month
 * backfill. Anything older is the weekly rollup's problem, not the pulse's.
 */
export const CATCH_UP_WINDOW_DAYS = 7;

/**
 * Catch-up is for the bare cron path only. `--date`/`--since`/`--backfill` name
 * an explicit range and are honoured literally. `--force` is excluded for a
 * sharper reason: it bypasses the `isDone` gate, so a `--force` widened by a
 * week of recovered dates would rewrite good pulses the user never named, and
 * `writePulse` keeps no backup. Catch-up only ever needs to add dates nobody
 * has written yet — it never needs `--force` to do it.
 */
export function shouldCatchUp(opts: RunPulseOptions): boolean {
  return !opts.date && !opts.since && !opts.backfill && !opts.force;
}

export interface CatchUpEntry {
  project: string;
  date: string;
  /** `failed` = a run tried and lost it; `missing` = no run ever claimed it. */
  reason: "failed" | "missing";
}

/**
 * Dates the cron path would otherwise never revisit: (a) checkpoint failures,
 * (b) the gap between a project's last done pulse and yesterday. Both clamped
 * to the last `windowDays` days.
 *
 * A project with no done pulse at all is skipped: that is a project that never
 * started, not a gap to recover — and treating it as one would make a fresh
 * install backfill a week on first run.
 */
export function computeCatchUpDates(args: {
  cp: Pick<Checkpoint, "queryFailed" | "lastDoneDate">;
  projects: ProjectConfig[];
  yesterday: string;
  windowDays: number;
}): CatchUpEntry[] {
  const { cp, projects, yesterday, windowDays } = args;
  const active = projects.filter((p) => p.status !== "archived");
  if (active.length === 0) return [];
  const names = new Set(active.map((p) => p.name));
  const floor = addDays(yesterday, -(windowDays - 1));

  const out: CatchUpEntry[] = [];
  for (const rec of cp.queryFailed()) {
    if (!names.has(rec.project)) continue;
    if (rec.date < floor || rec.date > yesterday) continue;
    out.push({ project: rec.project, date: rec.date, reason: "failed" });
  }

  const seen = new Set(out.map((e) => `${e.project}:${e.date}`));
  for (const project of active) {
    const lastDone = cp.lastDoneDate(project.name);
    if (!lastDone) continue;
    const start = maxDate(addDays(lastDone, 1), floor);
    for (const date of datesBetween(start, yesterday)) {
      const key = `${project.name}:${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ project: project.name, date, reason: "missing" });
    }
  }
  return out;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

export function determineDates(opts: RunPulseOptions): string[] {
  if (opts.date) {
    if (!ISO_DATE_RE.test(opts.date)) {
      throw new Error(`--date invalid: ${opts.date} (expected YYYY-MM-DD)`);
    }
    return [opts.date];
  }
  if (opts.since) {
    // Yesterday, not today: today is still half-lived. Writing it would mark it
    // done, and tomorrow's cron would skip it — archiving a truncated day that
    // reads as a complete one.
    return datesBetween(opts.since, yesterdayLocal());
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
