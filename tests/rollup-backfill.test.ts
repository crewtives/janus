import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JanusConfig } from "../src/config/types.ts";
import type { LLMRunner, RunResult } from "../src/runners/types.ts";
import { backfillWeeklies } from "../src/pipeline/rollup-runner.ts";

// Sundays in 2026 (7 apart): 2026-06-07, -14, -21, -28, 2026-07-05.

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
      sessionId: null, resultText: "# Weekly\n\nfake.\n",
      totalCostUsd: null, durationMs: 0, numTurns: 1, exitCode: 0,
    };
  }
}

const tmps: string[] = [];
afterEach(async () => {
  for (const d of tmps.splice(0)) await rm(d, { recursive: true, force: true });
});

async function makeVault(opts: { dailies?: string[]; weeklies?: string[] }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "janus-backfill-"));
  tmps.push(dir);
  await mkdir(join(dir, "Timeline", "Daily"), { recursive: true });
  for (const d of opts.dailies ?? []) {
    await writeFile(join(dir, "Timeline", "Daily", `${d}.md`), `# Daily ${d}\n`);
  }
  if (opts.weeklies?.length) {
    await mkdir(join(dir, "Timeline", "Weekly"), { recursive: true });
    for (const w of opts.weeklies) {
      await writeFile(join(dir, "Timeline", "Weekly", `${w}-week.md`), `# Week ${w}\n`);
    }
  }
  return dir;
}

function cfg(vault: string): JanusConfig {
  return { obsidianVault: vault, projects: [], model: "sonnet", effort: "xhigh" };
}

function weekFile(vault: string, sunday: string): string {
  return join(vault, "Timeline", "Weekly", `${sunday}-week.md`);
}

const ALL = ["2026-06-07", "2026-06-14", "2026-06-21", "2026-06-28", "2026-07-05"];

describe("weekly backfill — backfillWeeklies", () => {
  test("generates each missing week's file over the range", async () => {
    const vault = await makeVault({ dailies: ALL });
    const runner = new CountingRunner();
    const r = await backfillWeeklies({
      since: "2026-06-07", upToDate: "2026-07-07",
      config: cfg(vault), runnerOverride: runner, skipSpines: true,
    });
    expect(r.generated).toEqual(ALL);
    for (const s of ALL) expect(existsSync(weekFile(vault, s))).toBe(true);
    expect(runner.calls).toBe(ALL.length);
  });

  test("weeks whose file already exists are skipped (idempotent)", async () => {
    const vault = await makeVault({ dailies: ALL, weeklies: ["2026-06-21"] });
    const runner = new CountingRunner();
    const r = await backfillWeeklies({
      since: "2026-06-07", upToDate: "2026-07-07",
      config: cfg(vault), runnerOverride: runner, skipSpines: true,
    });
    expect(r.skipped).toEqual(["2026-06-21"]);
    expect(r.generated).toEqual(["2026-06-07", "2026-06-14", "2026-06-28", "2026-07-05"]);
    expect(runner.calls).toBe(4); // the pre-existing week never hits the runner
  });

  test("weeks with no dailies produce no file (null) and the loop continues", async () => {
    // Omit dailies for the 2026-06-14 week (range 06-08..06-14).
    const vault = await makeVault({ dailies: ["2026-06-07", "2026-06-21", "2026-06-28", "2026-07-05"] });
    const runner = new CountingRunner();
    const r = await backfillWeeklies({
      since: "2026-06-07", upToDate: "2026-07-07",
      config: cfg(vault), runnerOverride: runner, skipSpines: true,
    });
    expect(r.empty).toEqual(["2026-06-14"]);
    expect(existsSync(weekFile(vault, "2026-06-14"))).toBe(false);
    expect(r.generated).toEqual(["2026-06-07", "2026-06-21", "2026-06-28", "2026-07-05"]);
  });

  test("--skip-spines: weekly narrative still generated, no extra spine passes", async () => {
    // Hermetic proxy: with projects=[], the only way spines could add LLM calls
    // is via writeAllProjectSpines. skipSpines:true keeps runner.calls at exactly
    // one per generated week — the weekly narrative — with no multiplier.
    const vault = await makeVault({ dailies: ALL });
    const runner = new CountingRunner();
    const r = await backfillWeeklies({
      since: "2026-06-07", upToDate: "2026-07-07",
      config: cfg(vault), runnerOverride: runner, skipSpines: true,
    });
    expect(runner.calls).toBe(r.generated.length);
    expect(r.generated.length).toBeGreaterThan(0);
  });

  test("--since parsing: enumerates Sunday-ending weeks only, from since inclusive", async () => {
    const vault = await makeVault({ dailies: ALL });
    const runner = new CountingRunner();
    // since is a Sunday → that Sunday is included.
    const r = await backfillWeeklies({
      since: "2026-06-21", upToDate: "2026-07-07",
      config: cfg(vault), runnerOverride: runner, skipSpines: true,
    });
    const all = [...r.generated, ...r.skipped, ...r.empty].sort();
    expect(all).toEqual(["2026-06-21", "2026-06-28", "2026-07-05"]);
    // Every enumerated end-date is a Sunday.
    for (const d of all) expect(new Date(`${d}T00:00:00`).getDay()).toBe(0);
  });

  test("--since on a non-Sunday floors to the next Sunday-ending week", async () => {
    const vault = await makeVault({ dailies: ALL });
    const runner = new CountingRunner();
    // 2026-06-22 (Mon) → first eligible week ends 2026-06-28.
    const r = await backfillWeeklies({
      since: "2026-06-22", upToDate: "2026-07-07",
      config: cfg(vault), runnerOverride: runner, skipSpines: true,
    });
    const all = [...r.generated, ...r.skipped, ...r.empty].sort();
    expect(all).toEqual(["2026-06-28", "2026-07-05"]);
  });
});
