import { mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Eta } from "eta";
import type { JanusConfig } from "../config/types.ts";
import { resolveRunner } from "../runners/registry.ts";
import { materializeTracks, parseTracks, recordTrackLineage } from "./tracks.ts";
import { stripCodeFenceWrap } from "./daily.ts";
import { loadVoiceSpec } from "./template.ts";
import { Checkpoint } from "./checkpoint.ts";
import weeklyRollupTemplate from "../prompts/weekly-rollup.v5.md" with { type: "text" };

export const WEEKLY_PROMPT_VERSION = "v5" as const;

interface DailyForRollup {
  date: string;
  content: string;
}

export interface WeeklyWriteResult {
  path: string;
  daysWithData: number;
  /** Tracks materialized as notes in MOCs/Tracks/. */
  tracksMaterialized: number;
}

const eta = new Eta({ autoEscape: false, rmWhitespace: false });

/**
 * Generates a Weekly Rollup by reading the consolidated dailies of the period.
 * Final path: <vault>/Timeline/Weekly/<endDate>-week.md
 */
export async function writeWeeklyRollup(opts: {
  vaultPath: string;
  startDate: string;
  endDate: string;
  config: JanusConfig;
  projectNames: string[];
}): Promise<WeeklyWriteResult | null> {
  const dailies = await collectDailies(opts.vaultPath, opts.startDate, opts.endDate);
  if (dailies.length === 0) {
    console.warn(`[weekly] no daily rollups in ${opts.startDate}..${opts.endDate} — nothing to consolidate`);
    return null;
  }

  const days = daysBetweenInclusive(opts.startDate, opts.endDate);
  const template = weeklyRollupTemplate;
  const voice = await loadVoiceSpec();

  // Phase 2 U1 + U2 + U3 — open loops + stuck blockers detection.
  let openLoopsCallout = "";
  let stuckBlockers: Array<{ text: string; weeklyCount: number; firstSeen: string }> = [];
  if (opts.config.stateDir) {
    try {
      const cp = Checkpoint.open(opts.config.stateDir);
      const { detectOpenTrackLoops, detectOrphanDecisions, renderOpenLoopsCallout } = await import("./reflection/open-loops.ts");
      const tracks = detectOpenTrackLoops({ checkpoint: cp, today: opts.endDate });
      const decisions = detectOrphanDecisions({ checkpoint: cp, today: opts.endDate });
      openLoopsCallout = renderOpenLoopsCallout({ tracks, decisions });
      const { detectStuckPatterns } = await import("./reflection/stuck-patterns.ts");
      stuckBlockers = detectStuckPatterns({ checkpoint: cp, weeklyEndDate: opts.endDate });
      cp.close();
    } catch (err) {
      console.warn(`[weekly] open-loops/stuck-patterns failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Phase 2 U4 — pattern detection LLM pre-pass. Best-effort, non-fatal.
  let patternsCallout = "";
  try {
    const { detectPatterns, renderPatternsCallout } = await import("./reflection/pattern-detector.ts");
    const patterns = await detectPatterns({
      config: opts.config,
      startDate: opts.startDate,
      endDate: opts.endDate,
    });
    if (patterns.length > 0) {
      patternsCallout = renderPatternsCallout(patterns);
      console.log(`[weekly] patterns auto-detected: ${patterns.length} (>= 0.6 confidence)`);
    }
  } catch (err) {
    console.warn(`[weekly] pattern-detector failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  const prompt = eta.renderString(template, {
    days,
    startDate: opts.startDate,
    endDate: opts.endDate,
    projects: opts.projectNames,
    dailies,
    voice,
    promptVersion: WEEKLY_PROMPT_VERSION,
    openLoopsCallout,
    stuckBlockers,
    patternsCallout,
  });
  if (typeof prompt !== "string") throw new Error("weekly template render fail");

  const result = await resolveRunner(opts.config).run({
    prompt,
    cwd: opts.vaultPath,
    model: opts.config.model!,
    effort: opts.config.effort!,
    fallbackModel: opts.config.fallbackModel,
    sessionId: randomUUID(),
    maxTurns: 5,
    timeoutMs: 15 * 60_000,
    logTag: `weekly/${opts.endDate}`,
  });

  const path = join(opts.vaultPath, "Timeline", "Weekly", `${opts.endDate}-week.md`);
  await mkdir(dirname(path), { recursive: true });
  let weeklyMarkdown = stripCodeFenceWrap(result.resultText.trim());

  // Preserve user answers in the "Preguntas para vos" section (U5).
  // If the weekly already exists on disk and the user answered, we merge.
  if (existsSync(path)) {
    try {
      const { preserveQuestionAnswers } = await import("./reflection/question-preserve.ts");
      const previous = await readFile(path, "utf-8");
      weeklyMarkdown = preserveQuestionAnswers({ previous, regenerated: weeklyMarkdown });
    } catch (err) {
      console.warn(`[weekly] question-preserve failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await Bun.write(path, weeklyMarkdown);

  // Phase 2 U3 — record this weekly's blockers for stuck detection.
  if (opts.config.stateDir) {
    try {
      const cp = Checkpoint.open(opts.config.stateDir);
      const { recordWeeklyBlockers } = await import("./reflection/stuck-patterns.ts");
      const r = recordWeeklyBlockers({
        checkpoint: cp,
        weeklyMarkdown,
        weeklyEndDate: opts.endDate,
        project: "_global",
      });
      cp.close();
      if (r.recorded > 0) console.log(`[weekly] stuck patterns: ${r.recorded} blocker(s) recorded`);
    } catch (err) {
      console.warn(`[weekly] record-blockers failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Materialize tracks (idempotent). If the agent respected the prompt v2 format,
  // each track becomes a note at MOCs/Tracks/<slug>.md.
  let tracksMaterialized = 0;
  try {
    const mr = await materializeTracks({
      vaultPath: opts.vaultPath,
      weeklyFilename: basename(path, ".md"),
      weeklyMarkdown,
    });
    tracksMaterialized = mr.tracksWritten;
    if (mr.tracksFound > 0) {
      console.log(`[weekly] tracks materialized: ${mr.tracksWritten}/${mr.tracksFound} in MOCs/Tracks/`);
    }
  } catch (err) {
    console.warn(`[weekly] materializeTracks failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  // Record track lineage in SQLite (Phase 1C). Enables open-loop
  // detection (Phase 2) and "top tracks of the year" (Phase 3 Wrapped).
  if (opts.config.stateDir) {
    try {
      const cp = Checkpoint.open(opts.config.stateDir);
      const tracks = parseTracks(weeklyMarkdown);
      const lr = recordTrackLineage({
        checkpoint: cp,
        tracks,
        sourceFilename: basename(path, ".md"),
      });
      cp.close();
      if (lr.recorded > 0) {
        console.log(`[weekly] track lineage: ${lr.recorded} mention(s) recorded in SQLite`);
      }
    } catch (err) {
      console.warn(`[weekly] track lineage failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Auto-archive stale tracks (not mentioned in the last 4 weeklies).
  try {
    const { archiveStaleTracks } = await import("./track-ttl.ts");
    const ar = await archiveStaleTracks({ vaultPath: opts.vaultPath, ttlWeeks: 4 });
    if (ar.tracksArchived > 0) {
      console.log(`[weekly] tracks archived by TTL: ${ar.tracksArchived} (of ${ar.tracksScanned} scanned)`);
      for (const a of ar.archived) console.log(`  → ${a.slug}: ${a.reason}`);
    }
  } catch (err) {
    console.warn(`[weekly] archive-tracks failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  // Auto-regenerate Project Spines (continuous per-project narrative).
  try {
    const { writeAllProjectSpines } = await import("./spine.ts");
    const spines = await writeAllProjectSpines({ config: opts.config });
    const generated = spines.filter((s): s is NonNullable<typeof s> => s !== null);
    if (generated.length > 0) {
      console.log(`[weekly] project spines regenerated: ${generated.length}`);
    }
  } catch (err) {
    console.warn(`[weekly] spine regeneration failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  return { path, daysWithData: dailies.length, tracksMaterialized };
}

async function collectDailies(vaultPath: string, startDate: string, endDate: string): Promise<DailyForRollup[]> {
  const dailyDir = join(vaultPath, "Timeline", "Daily");
  if (!existsSync(dailyDir)) return [];
  const entries = await readdir(dailyDir);
  const out: DailyForRollup[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const m = name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (!m || !m[1]) continue;
    const date = m[1];
    if (date < startDate || date > endDate) continue;
    const content = await readFile(join(dailyDir, name), "utf-8");
    out.push({ date, content });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function daysBetweenInclusive(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
}
