import { loadConfig } from "../config/loader.ts";
import type { JanusConfig } from "../config/types.ts";
import type { LLMRunner } from "../runners/types.ts";
import type { WeeklyWriteResult } from "../core/weekly.ts";
import {
  writeWeeklyRollup,
  weeklyRollupExists,
  completedWeekEndsSince,
  latestWeeklyEnd,
  mostRecentSunday,
} from "../core/weekly.ts";

export interface RunRollupOptions {
  week?: boolean | undefined;
  days?: string | undefined;
  endDate?: string | undefined;
  /** Pre-loaded config (self-heal / backfill / tests). Falls back to loadConfig(). */
  config?: JanusConfig | undefined;
  /** Suppress spine regeneration — the dominant cost — during bulk backfill. */
  skipSpines?: boolean | undefined;
  /** Inject a fake runner for hermetic tests. */
  runnerOverride?: LLMRunner | undefined;
}

export async function runRollup(opts: RunRollupOptions): Promise<WeeklyWriteResult | null> {
  const config = opts.config ?? (await loadConfig());

  const days = opts.week ? 7 : opts.days ? parseInt(opts.days, 10) : 7;
  if (isNaN(days) || days < 1 || days > 60) {
    throw new Error(`--days invalid: ${opts.days} (1-60)`);
  }

  const endDate = opts.endDate ?? yesterdayLocal();
  const endD = new Date(`${endDate}T00:00:00`);
  const startD = new Date(endD);
  startD.setDate(startD.getDate() - (days - 1));
  const startDate = formatDate(startD);

  console.log(`[rollup] generating rollup of ${days} days: ${startDate} → ${endDate}`);

  const result = await writeWeeklyRollup({
    vaultPath: config.obsidianVault,
    startDate,
    endDate,
    config,
    projectNames: config.projects.map((p) => p.name),
    skipSpines: opts.skipSpines,
    runnerOverride: opts.runnerOverride,
  });

  if (result) {
    console.log(`[rollup] ✓ ${result.path} (${result.daysWithData} days with data)`);
  } else {
    console.log(`[rollup] nothing generated (no daily rollups in that period)`);
  }
  return result;
}

/**
 * Weekly self-heal (U1). Generates every completed (Sunday-ending) week whose
 * rollup file is missing, back to the last existing weekly — recovering a
 * multi-week gap on the next run after a missed one. Reused from the pulse
 * post-run block (KTD4). Returns the Sunday end-dates actually generated.
 */
export async function weeklySelfHeal(opts: {
  config: JanusConfig;
  upToDate: string;
  skipSpines?: boolean;
  runnerOverride?: LLMRunner;
}): Promise<string[]> {
  const vaultPath = opts.config.obsidianVault;
  const floor = await latestWeeklyEnd(vaultPath);
  const candidates = completedWeekEndsSince(floor, opts.upToDate);
  const generated: string[] = [];
  for (const sunday of candidates) {
    // Idempotency: skip a week that already has its file — no LLM call.
    if (await weeklyRollupExists(vaultPath, sunday)) continue;
    const r = await runRollup({
      endDate: sunday,
      config: opts.config,
      skipSpines: opts.skipSpines,
      runnerOverride: opts.runnerOverride,
    });
    if (r) generated.push(sunday);
  }
  return generated;
}

/**
 * Weekly backfill (U3). Regenerates missing historical weeklies over an explicit
 * range. Enumerates every Sunday from `since` (or the most recent completed
 * week when omitted) up to the most recent completed week, skipping any whose
 * file already exists. Cost-aware: `--skip-spines` suppresses the dominant
 * `writeAllProjectSpines` cost while still generating the weekly narrative.
 */
export async function backfillWeeklies(opts: {
  since?: string | undefined;
  upToDate?: string | undefined;
  skipSpines?: boolean | undefined;
  config?: JanusConfig | undefined;
  runnerOverride?: LLMRunner | undefined;
}): Promise<{ generated: string[]; skipped: string[]; empty: string[] }> {
  const config = opts.config ?? (await loadConfig());
  const upTo = opts.upToDate ?? yesterdayLocal();
  // `since` is an inclusive floor; completedWeekEndsSince treats its floor as
  // exclusive, so step back one day to include the Sunday of `since` itself.
  const floor = opts.since ? dayBefore(opts.since) : dayBefore(mostRecentSunday(upTo));
  const candidates = completedWeekEndsSince(floor, upTo);

  const generated: string[] = [];
  const skipped: string[] = [];
  const empty: string[] = [];
  for (const sunday of candidates) {
    if (await weeklyRollupExists(config.obsidianVault, sunday)) {
      skipped.push(sunday);
      continue;
    }
    const r = await runRollup({
      endDate: sunday,
      config,
      skipSpines: opts.skipSpines,
      runnerOverride: opts.runnerOverride,
    });
    if (r) generated.push(sunday);
    else empty.push(sunday);
  }
  console.log(
    `[backfill] weeklies — ${generated.length} generated, ${skipped.length} already present, ${empty.length} empty (no dailies)`,
  );
  return { generated, skipped, empty };
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return formatDate(d);
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
