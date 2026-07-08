import { mkdir, readFile, readdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Eta } from "eta";
import type { JanusConfig, ProjectConfig } from "../config/types.ts";
import { resolveRunner } from "../runners/registry.ts";
import { stripCodeFenceWrap } from "./daily.ts";
import { materializeTracks, parseTracks, recordTrackLineage } from "./tracks.ts";
import { loadVoiceSpec } from "./template.ts";
import { Checkpoint } from "./checkpoint.ts";
import monthlyDigestTemplate from "../prompts/monthly-digest.v4.md" with { type: "text" };

export const MONTHLY_PROMPT_VERSION = "v4" as const;

const eta = new Eta({ autoEscape: false, rmWhitespace: false });

interface DailyForMonth {
  date: string;
  content: string;
}

interface WeeklyForMonth {
  date: string; // weekly endDate
  startDate: string;
  endDate: string;
  content: string;
}

export interface MonthlyWriteResult {
  path: string;
  month: string;
  daysProcessed: number;
  weekliesUsed: number;
  pulsesArchived: number;
  tracksMaterialized: number;
}

/**
 * Generates the Monthly Digest for `month` (YYYY-MM) and then archives each
 * project's individual pulses into `<obsidianPath>/_archive/YYYY-MM/`.
 *
 * Idempotent: if the monthly file already exists, it is overwritten; the
 * archive steps tolerate "already moved".
 */
export async function writeMonthlyDigest(opts: {
  vaultPath: string;
  month: string; // YYYY-MM
  config: JanusConfig;
  /** If true, does NOT archive pulses (useful for regeneration without touching files). */
  skipArchive?: boolean;
}): Promise<MonthlyWriteResult | null> {
  const { startDate, endDate, days } = monthBounds(opts.month);

  const dailies = await collectDailies(opts.vaultPath, startDate, endDate);
  const weeklies = await collectWeeklies(opts.vaultPath, startDate, endDate);

  if (dailies.length === 0 && weeklies.length === 0) {
    console.warn(`[monthly] no data in ${opts.month} — nothing to consolidate`);
    return null;
  }

  // Dailies "not covered" by any weekly in the month (so we can include loose ones in the prompt).
  const coveredDates = new Set<string>();
  for (const w of weeklies) {
    for (const d of datesBetweenInclusive(w.startDate, w.endDate)) coveredDates.add(d);
  }
  const uncoveredDailies = dailies.filter((d) => !coveredDates.has(d.date));

  const template = monthlyDigestTemplate;
  const voice = await loadVoiceSpec();
  const prompt = eta.renderString(template, {
    month: opts.month,
    startDate,
    endDate,
    days,
    projects: opts.config.projects.map((p) => p.name),
    weeklies,
    uncoveredDailies,
    voice,
    promptVersion: MONTHLY_PROMPT_VERSION,
  });
  if (typeof prompt !== "string") throw new Error("monthly template render fail");

  const result = await resolveRunner(opts.config).run({
    prompt,
    cwd: opts.vaultPath,
    model: opts.config.model!,
    effort: opts.config.effort!,
    fallbackModel: opts.config.fallbackModel,
    sessionId: randomUUID(),
    maxTurns: 5,
    timeoutMs: 20 * 60_000,
    logTag: `monthly/${opts.month}`,
  });

  const path = join(opts.vaultPath, "Timeline", "Monthly", `${opts.month}-monthly.md`);
  await mkdir(dirname(path), { recursive: true });
  let md = stripCodeFenceWrap(result.resultText.trim());

  // Preserve user answers in "Preguntas para vos" if it already exists.
  if (existsSync(path)) {
    try {
      const { preserveQuestionAnswers } = await import("./reflection/question-preserve.ts");
      const previous = await readFile(path, "utf-8");
      md = preserveQuestionAnswers({ previous, regenerated: md });
    } catch (err) {
      console.warn(`[monthly] question-preserve failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await Bun.write(path, md);

  // Materialize tracks (same format as weekly).
  let tracksMaterialized = 0;
  try {
    const mr = await materializeTracks({
      vaultPath: opts.vaultPath,
      weeklyFilename: basename(path, ".md"),
      weeklyMarkdown: md,
    });
    tracksMaterialized = mr.tracksWritten;
    if (mr.tracksFound > 0) {
      console.log(`[monthly] tracks materialized: ${mr.tracksWritten}/${mr.tracksFound}`);
    }
  } catch (err) {
    console.warn(`[monthly] materializeTracks failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Record track lineage (Phase 1C).
  if (opts.config.stateDir) {
    try {
      const cp = Checkpoint.open(opts.config.stateDir);
      const tracks = parseTracks(md);
      const lr = recordTrackLineage({
        checkpoint: cp,
        tracks,
        sourceFilename: basename(path, ".md"),
      });
      cp.close();
      if (lr.recorded > 0) {
        console.log(`[monthly] track lineage: ${lr.recorded} mention(s)`);
      }
    } catch (err) {
      console.warn(`[monthly] track lineage failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Archive the month's pulses (per project).
  let pulsesArchived = 0;
  if (!opts.skipArchive) {
    for (const project of opts.config.projects) {
      pulsesArchived += await archiveProjectPulses(project, opts.month);
    }
    console.log(`[monthly] pulses archived: ${pulsesArchived} (vault) + idem in repo if present`);
  }

  return {
    path,
    month: opts.month,
    daysProcessed: dailies.length,
    weekliesUsed: weeklies.length,
    pulsesArchived,
    tracksMaterialized,
  };
}

async function collectDailies(vaultPath: string, startDate: string, endDate: string): Promise<DailyForMonth[]> {
  const dir = join(vaultPath, "Timeline", "Daily");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: DailyForMonth[] = [];
  for (const name of entries) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (!m) continue;
    const date = m[1]!;
    if (date < startDate || date > endDate) continue;
    const content = await readFile(join(dir, name), "utf-8");
    out.push({ date, content });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

async function collectWeeklies(vaultPath: string, startDate: string, endDate: string): Promise<WeeklyForMonth[]> {
  const dir = join(vaultPath, "Timeline", "Weekly");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: WeeklyForMonth[] = [];
  for (const name of entries) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-week\.md$/);
    if (!m) continue;
    const endD = m[1]!;
    if (endD < startDate || endD > endDate) continue;
    const content = await readFile(join(dir, name), "utf-8");
    const startMatch = content.match(/^period_start:\s*(\S+)$/m);
    out.push({ date: endD, startDate: startMatch?.[1] ?? endD, endDate: endD, content });
  }
  out.sort((a, b) => a.endDate.localeCompare(b.endDate));
  return out;
}

async function archiveProjectPulses(project: ProjectConfig, month: string): Promise<number> {
  const { startDate, endDate } = monthBounds(month);
  const pulseDir = join(project.obsidianPath, "pulse");
  const archiveDir = join(project.obsidianPath, "_archive", month);
  const repoPulseDir = join(project.repoPath, "docs", "pulse");
  const repoArchiveDir = join(project.repoPath, "docs", "_archive", month);
  if (!existsSync(pulseDir)) return 0;

  await mkdir(archiveDir, { recursive: true });
  await mkdir(repoArchiveDir, { recursive: true });

  const entries = await readdir(pulseDir);
  let moved = 0;
  for (const name of entries) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-/);
    if (!m) continue;
    const d = m[1]!;
    if (d < startDate || d > endDate) continue;
    const from = join(pulseDir, name);
    const to = join(archiveDir, name);
    if (existsSync(to)) continue; // already archived
    try {
      await rename(from, to);
      moved += 1;
    } catch {
      // tolerant: if rename fails, leave the file in place
    }
    // Same in the repo
    const fromRepo = join(repoPulseDir, name);
    const toRepo = join(repoArchiveDir, name);
    if (existsSync(fromRepo) && !existsSync(toRepo)) {
      try { await rename(fromRepo, toRepo); } catch { /* tolerant */ }
    }
  }
  return moved;
}

function monthBounds(month: string): { startDate: string; endDate: string; days: number } {
  const [yStr, mStr] = month.split("-");
  const y = parseInt(yStr!, 10);
  const m = parseInt(mStr!, 10);
  const startDate = `${yStr}-${mStr}-01`;
  const last = new Date(y, m, 0).getDate(); // last day of the month
  const endDate = `${yStr}-${mStr}-${String(last).padStart(2, "0")}`;
  return { startDate, endDate, days: last };
}

function datesBetweenInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  for (let d = s; d <= e; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

/** Returns the month before currentDate (format YYYY-MM-DD → YYYY-MM). */
export function previousMonth(currentDate: string): string {
  const [y, m] = currentDate.split("-").map((s) => parseInt(s!, 10));
  const prev = new Date(y!, m! - 2, 1); // m! - 2 because month is 0-indexed and we want the previous one
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

/** True if currentDate is the first day of its month (auto-monthly trigger). */
export function isFirstOfMonth(currentDate: string): boolean {
  return /-01$/.test(currentDate);
}

// --- Monthly self-heal helpers (Fase 0 / U2) ----------------------------------
//
// The calendar trigger only fires when a run processes a `-01` date; a slept-
// through first-of-month run loses that month with no catch-up on launchd. The
// self-heal backstop regenerates any fully-elapsed month whose digest is
// missing, back to the last existing monthly (KTD2). `writeMonthlyDigest` is
// already idempotent, so no writer change is needed.

/** The next month after `month` (YYYY-MM → YYYY-MM). */
function nextMonth(month: string): string {
  const [y, m] = month.split("-").map((s) => parseInt(s!, 10));
  const d = new Date(y!, m!, 1); // m! is 1-indexed → new Date's 0-indexed month = next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** True if the monthly digest file for `month` (YYYY-MM) already exists. */
export async function monthlyDigestExists(vaultPath: string, month: string): Promise<boolean> {
  return Bun.file(join(vaultPath, "Timeline", "Monthly", `${month}-monthly.md`)).exists();
}

/** The most recent existing monthly digest (YYYY-MM), or null if none. */
export async function latestMonthlyDigest(vaultPath: string): Promise<string | null> {
  const dir = join(vaultPath, "Timeline", "Monthly");
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir);
  let max: string | null = null;
  for (const name of entries) {
    const m = name.match(/^(\d{4}-\d{2})-monthly\.md$/);
    if (!m || !m[1]) continue;
    if (max === null || m[1] > max) max = m[1];
  }
  return max;
}

/**
 * Fully-elapsed months (YYYY-MM) that lack a digest, back to the last existing
 * monthly — ascending. A month is fully elapsed once `upToDate` is in a later
 * month; the most recent one is `previousMonth(upToDate)`.
 *
 * The last existing monthly is the floor so the self-heal never auto-backfills
 * the whole history: an older gap lives *below* the floor and is regenerated
 * only by the explicit `janus monthly --month <YYYY-MM>` command. When no
 * monthly exists at all, only the single most recent elapsed month is returned.
 */
export async function pendingMonthlyDigests(opts: {
  vaultPath: string;
  upToDate: string;
}): Promise<string[]> {
  const target = previousMonth(opts.upToDate); // most recent fully-elapsed month
  const floor = await latestMonthlyDigest(opts.vaultPath);
  if (floor === null) {
    return (await monthlyDigestExists(opts.vaultPath, target)) ? [] : [target];
  }
  if (target <= floor) return [];
  const out: string[] = [];
  for (let cur = nextMonth(floor); cur <= target; cur = nextMonth(cur)) {
    if (!(await monthlyDigestExists(opts.vaultPath, cur))) out.push(cur);
  }
  return out;
}
