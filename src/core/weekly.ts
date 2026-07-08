import { mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Eta } from "eta";
import type { JanusConfig } from "../config/types.ts";
import type { LLMRunner } from "../runners/types.ts";
import { resolveRunner } from "../runners/registry.ts";
import { materializeTracks, parseTracks, recordTrackLineage } from "./tracks.ts";
import { stripCodeFenceWrap } from "./daily.ts";
import { loadVoiceSpec } from "./template.ts";
import { Checkpoint } from "./checkpoint.ts";
import weeklyRollupTemplate from "../prompts/weekly-rollup.v6.md" with { type: "text" };

export const WEEKLY_PROMPT_VERSION = "v6" as const;

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
  /**
   * Suppress the `writeAllProjectSpines` side effect — the dominant LLM cost.
   * Used by bulk backfill (`--skip-spines`) and hermetic tests. The weekly
   * narrative itself still uses the LLM.
   */
  skipSpines?: boolean;
  /** Inject a fake runner for hermetic tests; else the config's runner is used. */
  runnerOverride?: LLMRunner;
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

  const runner = opts.runnerOverride ?? resolveRunner(opts.config);
  const result = await runner.run({
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
  // The dominant LLM cost — `skipSpines` suppresses it during bulk backfill.
  if (!opts.skipSpines) {
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

// --- Weekly self-heal helpers (Fase 0 / U1) -----------------------------------
//
// Convention (KTD1): a completed week ends on a Sunday and its rollup lives at
// Timeline/Weekly/<sunday>-week.md. Weekday math uses local-midnight parsing
// (`${date}T00:00:00`) so it matches the operator's local timezone — a bare
// `new Date("YYYY-MM-DD")` parses as UTC and returns the wrong weekday in a
// negative-offset timezone.

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Path of the weekly rollup file for a given (Sunday) end date. */
export function weeklyRollupPath(vaultPath: string, endDate: string): string {
  return join(vaultPath, "Timeline", "Weekly", `${endDate}-week.md`);
}

/** True if the weekly rollup file for `endDate` already exists on disk. */
export async function weeklyRollupExists(vaultPath: string, endDate: string): Promise<boolean> {
  return Bun.file(weeklyRollupPath(vaultPath, endDate)).exists();
}

/** The most recent Sunday on or before `date` — the end of the most recent completed week. */
export function mostRecentSunday(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - d.getDay()); // getDay() === 0 on Sunday → subtracts 0
  return formatLocalDate(d);
}

/**
 * Sunday-ending week-end dates to (re)generate, ascending.
 *
 * Returns every Sunday strictly after `afterEnd` up to and including the most
 * recent completed week (Sunday on/before `upTo`). This recovers a multi-week
 * gap — e.g. a vacation — not just the most recent week.
 *
 * `afterEnd` is the end-date of the last existing weekly (Sunday or legacy). It
 * is the floor so the daily self-heal trigger never auto-backfills the whole
 * history: the historical gap lives *below* the most recent existing weekly and
 * is filled only by the explicit `--backfill` command (KTD5). When `afterEnd`
 * is null (no weekly exists at all) only the single most recent completed week
 * is returned, for the same reason.
 */
export function completedWeekEndsSince(afterEnd: string | null, upTo: string): string[] {
  const target = mostRecentSunday(upTo);
  if (afterEnd !== null && target <= afterEnd) return [];
  if (afterEnd === null) return [target];
  const out: string[] = [];
  let cur = target;
  while (cur > afterEnd) {
    out.push(cur);
    const d = new Date(`${cur}T00:00:00`);
    d.setDate(d.getDate() - 7);
    cur = formatLocalDate(d);
  }
  return out.reverse();
}

/** End-date of the most recent existing weekly rollup file, or null if none. */
export async function latestWeeklyEnd(vaultPath: string): Promise<string | null> {
  const dir = join(vaultPath, "Timeline", "Weekly");
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir);
  let max: string | null = null;
  for (const name of entries) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-week\.md$/);
    if (!m || !m[1]) continue;
    if (max === null || m[1] > max) max = m[1];
  }
  return max;
}
