import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Checkpoint } from "../src/core/checkpoint.ts";
import { checkKanvasBoard } from "../src/core/doctor.ts";
import { boardPath } from "../src/core/kanvas.ts";
import type { JanusConfig } from "../src/config/types.ts";

/**
 * R18. `runDoctor` returns `checks.every(ok)` and `janus init` runs doctor, so a
 * red board check would turn onboarding red for every user who has not adopted
 * the feature. Most of these tests pin a *green* case for exactly that reason.
 */

const TODAY = "2026-09-09";

let dir: string;
let vault: string;
let stateDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "janus-kanvas-doctor-"));
  vault = join(dir, "vault");
  stateDir = join(dir, "state");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function config(overrides: Partial<JanusConfig> = {}): JanusConfig {
  return {
    obsidianVault: vault,
    stateDir,
    projects: [
      { name: "alpha", repoPath: join(dir, "repos", "alpha"), obsidianPath: join(vault, "Projects", "alpha") },
    ],
    ...overrides,
  };
}

/** A roadmap mirror with one open checkbox — the only thing that makes a card. */
async function writeRoadmap(project = "alpha"): Promise<void> {
  await Bun.write(
    join(vault, "Projects", project, "_roadmap.md"),
    ["---", "type: roadmap", "needs_review: false", "source: repo-reconciled", "---", "", "## Now", "", "- [ ] ship the parser", ""].join("\n"),
  );
}

async function writeBoard(frontmatter: string[]): Promise<void> {
  await Bun.write(boardPath(vault), ["---", "type: dashboard", ...frontmatter, "---", "", "# Kanvas", ""].join("\n"));
}

const MANAGED = ["managed_by_janus: true", `generated_at: ${TODAY}`, "expected_projects: 1", "failed_projects: []"];

function recordPulse(project = "alpha", date = "2026-09-08"): void {
  const cp = Checkpoint.open(stateDir);
  cp.markStarted({ project, date, sessionId: "s", promptVersion: "v1" });
  cp.markDone({ project, date, outputPath: "/tmp/x.md" });
  cp.close();
}

describe("checkKanvasBoard", () => {
  test("green when no project has a card source and no blocker is in window", async () => {
    recordPulse();
    const res = await checkKanvasBoard(config(), TODAY);
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("nothing to render");
  });

  test("green on a fresh install: mirrors populated but no pulse ever recorded", async () => {
    await writeRoadmap();
    // state.db exists but holds no `done` row — the nightly block never finished.
    const cp = Checkpoint.open(stateDir);
    cp.markStarted({ project: "alpha", date: "2026-09-08", sessionId: "s", promptVersion: "v1" });
    cp.close();

    const res = await checkKanvasBoard(config(), TODAY);
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("no pulse");
  });

  test("green for a frozen board, naming the freeze key and the recovery", async () => {
    await writeRoadmap();
    recordPulse();
    await writeBoard(["managed_by_janus: false", "generated_at: 2026-08-01"]);

    const res = await checkKanvasBoard(config(), TODAY);
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("managed_by_janus");
    expect(res.detail).toContain("delete the file");
  });

  test("green for a board frozen with needs_review: false", async () => {
    await writeRoadmap();
    recordPulse();
    await writeBoard(["managed_by_janus: true", "needs_review: false"]);

    const res = await checkKanvasBoard(config(), TODAY);
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("needs_review");
  });

  test("green with a detail for a board written from a partial run", async () => {
    await writeRoadmap();
    recordPulse();
    await writeBoard(["managed_by_janus: true", `generated_at: ${TODAY}`, "expected_projects: 2", "failed_projects: [beta]"]);

    const res = await checkKanvasBoard(config(), TODAY);
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("partial");
    expect(res.detail).toContain("beta");
  });

  test("green for a healthy board", async () => {
    await writeRoadmap();
    recordPulse();
    await writeBoard(MANAGED);

    const res = await checkKanvasBoard(config(), TODAY);
    expect(res.ok).toBe(true);
  });

  test("red when the board is missing after a pulse was recorded and card sources exist", async () => {
    await writeRoadmap();
    recordPulse();

    const res = await checkKanvasBoard(config(), TODAY);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("janus kanvas");
  });

  test("red when a stale temp file is present", async () => {
    await writeRoadmap();
    recordPulse();
    await writeBoard(MANAGED);
    await Bun.write(`${boardPath(vault)}.janus.tmp`, "half a board");

    const res = await checkKanvasBoard(config(), TODAY);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("Kanvas.md.janus.tmp");
    expect(res.detail).toContain("janus kanvas");
  });

  test("reports a sibling file sharing the board's basename", async () => {
    await writeRoadmap();
    recordPulse();
    await writeBoard(MANAGED);
    await Bun.write(join(vault, "Dashboards", "Kanvas (conflicted copy 2026-09-01).md"), "---\n---\n");

    const res = await checkKanvasBoard(config(), TODAY);
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("Kanvas (conflicted copy 2026-09-01).md");
  });

  test("does not throw when the vault and the state directory are absent", async () => {
    const res = await checkKanvasBoard(
      config({ obsidianVault: join(dir, "no-vault"), stateDir: join(dir, "no-state") }),
      TODAY,
    );
    expect(res.ok).toBe(true);
  });

  test("does not create a state database as a side effect", async () => {
    await writeRoadmap();
    await checkKanvasBoard(config(), TODAY);
    expect(await Bun.file(join(stateDir, "state.db")).exists()).toBe(false);
  });

  test("counts a paused project's cards, like the board model does", async () => {
    // The board model filters on `archived` alone; checkPulseGaps also skips
    // `paused`. This pins the difference so the two checks are not "fixed" into
    // agreement by someone reading them side by side in one doctor run.
    await writeRoadmap();
    recordPulse();
    const cfg = config();
    cfg.projects[0]!.status = "paused";

    const res = await checkKanvasBoard(cfg, TODAY);
    expect(res.ok).toBe(false);
  });

  test("green when the only project is archived", async () => {
    await writeRoadmap();
    recordPulse();
    const cfg = config();
    cfg.projects[0]!.status = "archived";

    const res = await checkKanvasBoard(cfg, TODAY);
    expect(res.ok).toBe(true);
  });
});
