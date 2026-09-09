import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JanusConfig, ProjectConfig } from "../src/config/types.ts";
import { Checkpoint } from "../src/core/checkpoint.ts";
import { boardPath } from "../src/core/kanvas.ts";
import { refreshBoard } from "../src/pipeline/orchestrator.ts";

/**
 * U4 — the board's participation in the nightly run.
 *
 * `runPulse` itself is not hermetic (it resolves `config.local.json` from the
 * cwd and shells out to git per project), which is why no test in this repo
 * drives it. So the behaviour is exercised through `refreshBoard`, which owns
 * the whole decision, and the one thing that function cannot prove about
 * itself — *where* it is called from — is pinned by a source-structure test at
 * the bottom of this file.
 */

const TODAY = "2026-09-09";

const MIRROR = `---
type: roadmap
source: reconciled-vs-repo
needs_review: false
---

## Active milestones this week

- [ ] Wire the board route

## Shipped

- [x] Canvas editor UI
`;

const tmps: string[] = [];
afterEach(async () => {
  for (const d of tmps.splice(0)) await rm(d, { recursive: true, force: true });
});

/**
 * A vault with roadmap mirrors and one weekly blocker row, and no pulse
 * anywhere — the shape of a night on which nothing was generated. The repo
 * paths are never created: nothing in this path may touch a working copy.
 */
async function setup(names: string[] = ["alpha", "beta"]): Promise<JanusConfig> {
  const dir = await mkdtemp(join(tmpdir(), "janus-kanvas-pipeline-"));
  tmps.push(dir);
  const vault = join(dir, "vault");
  const projects: ProjectConfig[] = [];
  for (const name of names) {
    const obsidianPath = join(vault, "Projects", name);
    await mkdir(obsidianPath, { recursive: true });
    await writeFile(join(obsidianPath, "_roadmap.md"), MIRROR);
    projects.push({ name, repoPath: join(dir, "repos", name), obsidianPath });
  }
  const stateDir = join(dir, ".janus");
  const cp = Checkpoint.open(stateDir);
  cp.recordBlockerOccurrence({
    blockerHash: "aaa",
    project: "_global",
    weeklyEndDate: "2026-09-06",
    sampleText: "staging deploy waiting on credentials",
  });
  cp.close();
  return { obsidianVault: vault, projects, stateDir };
}

async function capture<T>(fn: () => Promise<T>): Promise<{ logs: string[]; warns: string[] }> {
  const logs: string[] = [];
  const warns: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a: unknown[]) => void logs.push(a.join(" "));
  console.warn = (...a: unknown[]) => void warns.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return { logs, warns };
}

describe("kanvas in the nightly run — a bare run refreshes the board", () => {
  test("a quiet night, where no project produced a pulse, still refreshes it", async () => {
    const config = await setup();
    await refreshBoard({ config, opts: {}, today: TODAY });
    const board = await readFile(boardPath(config.obsidianVault), "utf8");
    expect(board).toContain("Wire the board route");
    expect(board).toContain(`generated_at: ${TODAY}`);
  });

  test("a run in which every project failed still refreshes it, from mirrors and blocker rows", async () => {
    // The failed run and the quiet one hand `refreshBoard` the same options,
    // because the gate is not allowed to see this run's results at all. What
    // this test pins is the consequence: the board is composed entirely out of
    // artifacts written by earlier runs, so a night that produced no pulse at
    // all still renders a complete board.
    const config = await setup();
    await refreshBoard({ config, opts: {}, today: TODAY });
    const board = await readFile(boardPath(config.obsidianVault), "utf8");
    expect(board).toContain("Wire the board route"); // from the roadmap mirror
    expect(board).toContain("staging deploy waiting on credentials"); // from blocker_history
    expect(existsSync(join(config.projects[0]!.obsidianPath, "pulse"))).toBe(false);
  });

  test("--force is a current run, not a replay, so the board still refreshes", async () => {
    // Deliberately unlike `shouldCatchUp`, which excludes --force because it
    // would rewrite pulses nobody named. The board is regenerated from scratch
    // on every run, so there is nothing for --force to destroy here.
    const config = await setup();
    await refreshBoard({ config, opts: { force: true }, today: TODAY });
    expect(existsSync(boardPath(config.obsidianVault))).toBe(true);
  });

  test("the block runs once per invocation, not once per project", async () => {
    const config = await setup(["alpha", "beta", "gamma"]);
    const { logs } = await capture(() => refreshBoard({ config, opts: {}, today: TODAY }));
    expect(logs.filter((l) => l.startsWith("[janus] kanvas"))).toHaveLength(1);
    expect(await readdir(join(config.obsidianVault, "Dashboards"))).toEqual(["Kanvas.md"]);
  });
});

describe("kanvas in the nightly run — a replay leaves it alone", () => {
  test("an explicit date, since or backfill writes no board", async () => {
    for (const opts of [{ date: "2026-09-01" }, { since: "2026-09-01" }, { backfill: "7d" }]) {
      const config = await setup();
      await refreshBoard({ config, opts, today: TODAY });
      expect(existsSync(boardPath(config.obsidianVault))).toBe(false);
    }
  });

  test("a replay never rewrites a board an earlier nightly run already wrote", async () => {
    const config = await setup();
    await refreshBoard({ config, opts: {}, today: TODAY });
    const before = await readFile(boardPath(config.obsidianVault), "utf8");

    // Something a replay would legitimately pick up if it regenerated.
    await writeFile(
      join(config.projects[0]!.obsidianPath, "_roadmap.md"),
      `${MIRROR}- [ ] Added after the board was written\n`,
    );
    await refreshBoard({ config, opts: { backfill: "7d" }, today: "2026-08-01" });

    expect(await readFile(boardPath(config.obsidianVault), "utf8")).toBe(before);
  });

  test("a dry-run pipeline pass writes no board", async () => {
    const config = await setup();
    await refreshBoard({ config, opts: { dryRun: true }, today: TODAY });
    expect(existsSync(boardPath(config.obsidianVault))).toBe(false);
  });
});

describe("kanvas in the nightly run — failure is non-fatal", () => {
  test("a failure inside the block warns and does not throw", async () => {
    const config = await setup();
    // A file where the Dashboards directory belongs: the write's mkdir fails
    // with ENOTDIR, which is a throw from inside the block rather than one of
    // writeBoard's named refusals.
    await mkdir(config.obsidianVault, { recursive: true });
    await writeFile(join(config.obsidianVault, "Dashboards"), "not a directory\n");

    const { warns } = await capture(() => refreshBoard({ config, opts: {}, today: TODAY }));
    expect(warns.some((w) => w.includes("kanvas") && w.includes("non-fatal"))).toBe(true);
    expect(existsSync(boardPath(config.obsidianVault))).toBe(false);
  });
});

describe("kanvas in the nightly run — where the call site sits", () => {
  // runPulse cannot be driven from a test, so the two invariants that live in
  // its body — the block is outside the success gate, and it is keyed on the
  // run's shape rather than on dates — are pinned against the source.
  const SOURCE_PATH = new URL("../src/pipeline/orchestrator.ts", import.meta.url).pathname;
  const SUCCESS_GATE = `if (!opts.dryRun && results.some((r) => r.status === "ok")) {`;

  async function source(): Promise<string> {
    return readFile(SOURCE_PATH, "utf8");
  }

  /** Index just past the `}` closing the block that opens at `openIndex`. */
  function endOfBlock(src: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return i;
    }
    throw new Error("unbalanced block");
  }

  test("the call is outside the enrich/scaffold/self-heal success gate", async () => {
    const src = await source();
    const gate = src.indexOf(SUCCESS_GATE);
    expect(gate).toBeGreaterThan(-1);
    const call = src.indexOf("refreshBoard({");
    expect(call).toBeGreaterThan(-1);
    // Inside the gate the board would never render on a quiet night — the
    // exact night R17 was written for.
    expect(call).toBeGreaterThan(endOfBlock(src, gate));
  });

  test("the call is last, after the weekly self-heal that writes the blocker rows", async () => {
    const src = await source();
    expect(src.indexOf("refreshBoard({")).toBeGreaterThan(src.indexOf("weeklySelfHeal"));
  });

  test("the call passes the run's shape, never its dates or its results", async () => {
    const src = await source();
    const call = src.slice(src.indexOf("refreshBoard({"));
    const args = call.slice(0, call.indexOf(")") + 1);
    expect(args).toContain("opts");
    expect(args).not.toContain("results");
    expect(args).not.toContain("dates");
  });
});
