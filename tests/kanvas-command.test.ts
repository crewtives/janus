import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import command, { runKanvas } from "../src/commands/kanvas.ts";
import type { JanusConfig } from "../src/config/types.ts";
import { boardPath } from "../src/core/kanvas.ts";

const ROADMAP = `---
type: roadmap
source: reconciled-vs-repo
needs_review: false
---

## Active milestones this week

- [ ] Wire the board route

## Shipped

- [x] Canvas editor UI
`;

let dir: string;
let vault: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "janus-kanvas-command-"));
  vault = join(dir, "vault");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function configWith(opts: { roadmap?: string; stateDir?: string } = {}): Promise<JanusConfig> {
  const obsidianPath = join(vault, "Projects", "alpha");
  await mkdir(obsidianPath, { recursive: true });
  if (opts.roadmap !== undefined) await writeFile(join(obsidianPath, "_roadmap.md"), opts.roadmap);
  return {
    obsidianVault: vault,
    projects: [{ name: "alpha", repoPath: join(dir, "repos", "alpha"), obsidianPath }],
    stateDir: opts.stateDir ?? join(dir, ".janus"),
  };
}

async function writeExistingBoard(content: string): Promise<void> {
  await mkdir(join(vault, "Dashboards"), { recursive: true });
  await writeFile(boardPath(vault), content);
}

/** Every runner reaches a model through `Bun.spawn`, so a throwing stub is the
 *  honest proxy for "this verb never calls one". */
async function withNoSpawn<T>(fn: () => Promise<T>): Promise<T> {
  const real = Bun.spawn;
  (Bun as { spawn: typeof Bun.spawn }).spawn = (() => {
    throw new Error("kanvas spawned a process");
  }) as typeof Bun.spawn;
  try {
    return await fn();
  } finally {
    (Bun as { spawn: typeof Bun.spawn }).spawn = real;
  }
}

describe("runKanvas — dry-run", () => {
  test("writes nothing, creates no directory, and still returns a result line", async () => {
    const config = await configWith({ roadmap: ROADMAP });
    const { result, line } = await withNoSpawn(() =>
      runKanvas({ config, today: "2026-09-09", dryRun: true }),
    );

    expect(result.outcome).toBe("written");
    expect(existsSync(join(vault, "Dashboards"))).toBe(false);
    expect(existsSync(boardPath(vault))).toBe(false);
    expect(line).toContain("[kanvas]");
    expect(line).toContain("dry-run");
    expect(line).toContain("would write");
    expect(line).toContain("rendered 2");
  });
});

describe("runKanvas — allow-empty", () => {
  test("without the flag a degenerate model is refused and the refusal is named", async () => {
    const config = await configWith({ roadmap: ROADMAP });
    await runKanvas({ config, today: "2026-09-09" });
    const before = await Bun.file(boardPath(vault)).text();

    await rm(join(vault, "Projects", "alpha", "_roadmap.md"));
    const { result, line } = await runKanvas({ config, today: "2026-09-10" });

    expect(result.outcome).toBe("degenerate");
    expect(line).toContain("refused (degenerate)");
    expect(line).toContain("--allow-empty");
    expect(await Bun.file(boardPath(vault)).text()).toBe(before);
  });

  test("with the flag the degenerate model replaces the board", async () => {
    const config = await configWith({ roadmap: ROADMAP });
    await runKanvas({ config, today: "2026-09-09" });
    const before = await Bun.file(boardPath(vault)).text();

    await rm(join(vault, "Projects", "alpha", "_roadmap.md"));
    const { result, line } = await runKanvas({ config, today: "2026-09-10", allowEmpty: true });

    expect(result.outcome).toBe("written");
    expect(line).toContain("written");
    expect(await Bun.file(boardPath(vault)).text()).not.toBe(before);
  });

  test("the flag does not override a frozen board", async () => {
    const config = await configWith({ roadmap: ROADMAP });
    const frozen = "---\ntype: dashboard\nmanaged_by_janus: false\n---\n\nhand-edited board\n";
    await writeExistingBoard(frozen);

    const { result, line } = await runKanvas({ config, today: "2026-09-09", allowEmpty: true });

    expect(result.outcome).toBe("frozen");
    expect(line).toContain("refused (frozen)");
    expect(await Bun.file(boardPath(vault)).text()).toBe(frozen);
  });

  test("the flag does not override the ownership guard", async () => {
    const config = await configWith({ roadmap: ROADMAP });
    const theirs = "---\ntype: dashboard\n---\n\nsomeone else's board\n";
    await writeExistingBoard(theirs);

    const { result, line } = await runKanvas({ config, today: "2026-09-09", allowEmpty: true });

    expect(result.outcome).toBe("not-ours");
    expect(line).toContain("refused (not-ours)");
    expect(await Bun.file(boardPath(vault)).text()).toBe(theirs);
  });
});

describe("runKanvas — result line", () => {
  test("names the resolved state directory, so a missing state database is self-evident", async () => {
    const stateDir = join(dir, "elsewhere", ".janus");
    const config = await configWith({ roadmap: ROADMAP, stateDir });

    const { line } = await runKanvas({ config, today: "2026-09-09" });

    expect(line).toContain(stateDir);
    expect(line).toContain("state.db");
  });

  test("names the outcome, the counters and the board path on a plain run", async () => {
    const config = await configWith({ roadmap: ROADMAP });

    const { line } = await runKanvas({ config, today: "2026-09-09" });

    expect(line).toContain("written");
    expect(line).toContain("rendered 2");
    expect(line).toContain("summarized 0");
    expect(line).toContain("declined 0");
    expect(line).toContain(boardPath(vault));
  });

  test("reports unchanged rather than going silent on a rerun", async () => {
    const config = await configWith({ roadmap: ROADMAP });
    await runKanvas({ config, today: "2026-09-09" });

    const { result, line } = await runKanvas({ config, today: "2026-09-09" });

    expect(result.outcome).toBe("unchanged");
    expect(line).toContain("unchanged");
  });
});

describe("kanvas verb registration", () => {
  test("resolves from the lazy subcommand map in bin/janus.ts", async () => {
    const bin = await Bun.file(join(import.meta.dir, "..", "bin", "janus.ts")).text();
    expect(bin).toContain('kanvas: () => import("../src/commands/kanvas.ts")');
    expect(command.meta).toMatchObject({ name: "kanvas" });
  });

  test("exposes --dry-run and --allow-empty, and no --force", () => {
    const args = command.args as Record<string, { type?: string; default?: unknown }>;
    expect(args["dry-run"]).toMatchObject({ type: "boolean", default: false });
    expect(args["allow-empty"]).toMatchObject({ type: "boolean", default: false });
    expect(args["force"]).toBeUndefined();
  });
});
