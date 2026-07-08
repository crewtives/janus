import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JanusConfig } from "../src/config/types.ts";
import type { LLMRunner, RunResult } from "../src/runners/types.ts";
import {
  completedWeekEndsSince,
  mostRecentSunday,
  latestWeeklyEnd,
} from "../src/core/weekly.ts";
import { weeklySelfHeal } from "../src/pipeline/rollup-runner.ts";

// All Sundays in 2026 (7 apart): 2026-06-07, -14, -21, -28, 2026-07-05.

class CountingRunner implements LLMRunner {
  readonly id = "mock";
  readonly capabilities = {
    sessionResume: false, effortControl: false, costTracking: false,
    addDirs: false, jsonStream: false, disableTools: false, fallbackModel: false,
  };
  calls = 0;
  async run(): Promise<RunResult> {
    this.calls += 1;
    return {
      sessionId: null, resultText: "# Weekly\n\nfake weekly digest.\n",
      totalCostUsd: null, durationMs: 0, numTurns: 1, exitCode: 0,
    };
  }
}

const tmps: string[] = [];
afterEach(async () => {
  for (const d of tmps.splice(0)) await rm(d, { recursive: true, force: true });
});

async function makeVault(opts: { dailies?: string[]; weeklies?: string[] }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "janus-weekly-"));
  tmps.push(dir);
  if (opts.dailies?.length) {
    await mkdir(join(dir, "Timeline", "Daily"), { recursive: true });
    for (const d of opts.dailies) {
      await writeFile(join(dir, "Timeline", "Daily", `${d}.md`), `# Daily ${d}\n\nactivity.\n`);
    }
  }
  if (opts.weeklies?.length) {
    await mkdir(join(dir, "Timeline", "Weekly"), { recursive: true });
    for (const w of opts.weeklies) {
      await writeFile(join(dir, "Timeline", "Weekly", `${w}-week.md`), `# Week ${w}\n`);
    }
  }
  return dir;
}

// stateDir omitted on purpose → every reflection sub-step in writeWeeklyRollup
// short-circuits (guarded by `if (config.stateDir)`), so the fake runner is the
// only LLM touched. skipSpines is passed by the caller to avoid the real
// resolveRunner in writeAllProjectSpines.
function cfg(vault: string): JanusConfig {
  return { obsidianVault: vault, projects: [], model: "sonnet", effort: "xhigh" };
}

function weekFile(vault: string, sunday: string): string {
  return join(vault, "Timeline", "Weekly", `${sunday}-week.md`);
}

describe("weekly self-heal — idempotency (execution note: written first)", () => {
  test("the most-recent completed week already present → no regeneration, no LLM call", async () => {
    // upTo 2026-07-07 → most recent completed Sunday is 2026-07-05, already on disk.
    const vault = await makeVault({
      dailies: ["2026-07-03", "2026-07-05"],
      weeklies: ["2026-07-05"],
    });
    const runner = new CountingRunner();
    const generated = await weeklySelfHeal({
      config: cfg(vault), upToDate: "2026-07-07", skipSpines: true, runnerOverride: runner,
    });
    expect(generated).toEqual([]);
    expect(runner.calls).toBe(0);
  });

  test("the floor bounds the trigger to the latest weekly — history is not auto-backfilled", async () => {
    // Latest existing weekly is 2026-06-28; an older gap (06-14, 06-21) is
    // missing but sits *below* the floor, so the daily trigger fills only
    // forward (07-05). The historical gap is the explicit `--backfill` job.
    const vault = await makeVault({
      dailies: ["2026-06-14", "2026-06-21", "2026-06-28", "2026-07-05"],
      weeklies: ["2026-06-28"],
    });
    const runner = new CountingRunner();
    const generated = await weeklySelfHeal({
      config: cfg(vault), upToDate: "2026-07-05", skipSpines: true, runnerOverride: runner,
    });
    expect(generated).toEqual(["2026-07-05"]);
    expect(runner.calls).toBe(1);
    expect(existsSync(weekFile(vault, "2026-06-21"))).toBe(false); // below floor, untouched
    expect(existsSync(weekFile(vault, "2026-07-05"))).toBe(true);
  });
});

describe("weekly self-heal — generation", () => {
  test("AE1: yesterday is a Sunday and its week file is absent → generated", async () => {
    const vault = await makeVault({
      dailies: ["2026-07-01", "2026-07-05"],
      weeklies: ["2026-06-28"],
    });
    const runner = new CountingRunner();
    const generated = await weeklySelfHeal({
      config: cfg(vault), upToDate: "2026-07-05", skipSpines: true, runnerOverride: runner,
    });
    expect(generated).toEqual(["2026-07-05"]);
    expect(runner.calls).toBe(1);
    expect(existsSync(weekFile(vault, "2026-07-05"))).toBe(true);
  });

  test("self-heal from mid-week: last Sunday's file missing → generated", async () => {
    // upTo 2026-07-01 (Wed) → most recent completed Sunday 2026-06-28.
    const vault = await makeVault({
      dailies: ["2026-06-24", "2026-06-28"],
      weeklies: ["2026-06-21"],
    });
    const runner = new CountingRunner();
    const generated = await weeklySelfHeal({
      config: cfg(vault), upToDate: "2026-07-01", skipSpines: true, runnerOverride: runner,
    });
    expect(generated).toEqual(["2026-06-28"]);
    expect(existsSync(weekFile(vault, "2026-06-28"))).toBe(true);
  });

  test("multi-week gap: two consecutive missing weeks → both regenerated in one run", async () => {
    // Floor 2026-06-21, upTo 2026-07-05 → candidates 06-28 and 07-05.
    const vault = await makeVault({
      dailies: ["2026-06-28", "2026-07-05"],
      weeklies: ["2026-06-21"],
    });
    const runner = new CountingRunner();
    const generated = await weeklySelfHeal({
      config: cfg(vault), upToDate: "2026-07-05", skipSpines: true, runnerOverride: runner,
    });
    expect(generated).toEqual(["2026-06-28", "2026-07-05"]);
    expect(runner.calls).toBe(2);
  });

  test("empty range: no dailies in the week → nothing written, no crash, re-evaluates next run", async () => {
    const vault = await makeVault({ weeklies: ["2026-06-28"] }); // no dailies at all
    const runner = new CountingRunner();
    const generated = await weeklySelfHeal({
      config: cfg(vault), upToDate: "2026-07-05", skipSpines: true, runnerOverride: runner,
    });
    expect(generated).toEqual([]);
    expect(existsSync(weekFile(vault, "2026-07-05"))).toBe(false);
    // A second run still finds nothing to lose — the file check re-evaluates.
    const again = await weeklySelfHeal({
      config: cfg(vault), upToDate: "2026-07-05", skipSpines: true, runnerOverride: runner,
    });
    expect(again).toEqual([]);
  });
});

// Dry-run and the "no ok result" gate are enforced structurally: weeklySelfHeal
// is invoked only inside the orchestrator's `!opts.dryRun && results.some(ok)`
// success gate (the same gate guarding enrich/scaffold/monthly). No separate
// test drives runPulse — that path is not hermetic (git, sessions, checkpoint).

describe("weekly self-heal — pure helpers", () => {
  test("mostRecentSunday returns the Sunday on/before the date", () => {
    expect(mostRecentSunday("2026-07-05")).toBe("2026-07-05"); // Sunday itself
    expect(mostRecentSunday("2026-07-07")).toBe("2026-07-05"); // Tue → prev Sunday
    expect(mostRecentSunday("2026-07-08")).toBe("2026-07-05"); // Wed → prev Sunday
    expect(mostRecentSunday("2026-07-11")).toBe("2026-07-05"); // Sat → prev Sunday
    expect(mostRecentSunday("2026-07-12")).toBe("2026-07-12"); // next Sunday
  });

  test("completedWeekEndsSince: null floor yields only the most recent completed week", () => {
    expect(completedWeekEndsSince(null, "2026-07-07")).toEqual(["2026-07-05"]);
  });

  test("completedWeekEndsSince: floor at/after the target yields nothing (idempotent)", () => {
    expect(completedWeekEndsSince("2026-07-05", "2026-07-07")).toEqual([]);
    expect(completedWeekEndsSince("2026-07-06", "2026-07-07")).toEqual([]);
  });

  test("completedWeekEndsSince: enumerates ascending Sundays after the floor", () => {
    expect(completedWeekEndsSince("2026-06-14", "2026-07-05")).toEqual([
      "2026-06-21", "2026-06-28", "2026-07-05",
    ]);
  });

  test("latestWeeklyEnd returns the max end-date, null when absent", async () => {
    const empty = await makeVault({});
    expect(await latestWeeklyEnd(empty)).toBeNull();
    const some = await makeVault({ weeklies: ["2026-05-20", "2026-07-06"] });
    expect(await latestWeeklyEnd(some)).toBe("2026-07-06");
  });
});
