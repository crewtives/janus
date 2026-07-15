import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Checkpoint } from "../src/core/checkpoint.ts";
import {
  checkDeadLetter,
  checkLaunchdLoaded,
  checkProjectPulseGap,
  duePulseDates,
  pulseDatesOnDisk,
} from "../src/core/doctor.ts";
import type { ProjectConfig } from "../src/config/types.ts";

/**
 * The 2026-07-14 incident: `doctor` reported 17/17 OK while a `failed` row for
 * acme-gamma/2026-07-13 sat in state.db and the pulse was absent from the
 * vault. These cover the checks that close that hole.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "janus-doctor-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function project(name: string, obsidianPath: string): ProjectConfig {
  return { name, repoPath: join(dir, "repo"), obsidianPath };
}

async function writePulse(obsidianPath: string, filename: string): Promise<void> {
  await Bun.write(join(obsidianPath, "pulse", filename), "---\nstatus: ok\n---\n");
}

describe("checkDeadLetter", () => {
  test("passes when there is no failed.jsonl", async () => {
    const res = await checkDeadLetter(dir);
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("nothing to retry");
  });

  test("passes on an empty failed.jsonl", async () => {
    await Bun.write(join(dir, "failed.jsonl"), "\n\n");
    const res = await checkDeadLetter(dir);
    expect(res.ok).toBe(true);
  });

  test("fails and names the entry still failed in state.db", async () => {
    await Bun.write(
      join(dir, "failed.jsonl"),
      JSON.stringify({
        project: "acme-gamma",
        date: "2026-07-13",
        error: "validation failed",
        at: "2026-07-14T13:00:00.000Z",
      }) + "\n",
    );
    const cp = Checkpoint.open(dir);
    cp.markFailed({ project: "acme-gamma", date: "2026-07-13", error: "validation failed" });
    cp.close();

    const res = await checkDeadLetter(dir);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("acme-gamma/2026-07-13");
    expect(res.detail).toContain("janus retry");
  });

  test("passes once the entry was repaired — the file outlives the failure", async () => {
    await Bun.write(
      join(dir, "failed.jsonl"),
      JSON.stringify({ project: "p", date: "2026-07-13", error: "boom" }) + "\n",
    );
    const cp = Checkpoint.open(dir);
    cp.markFailed({ project: "p", date: "2026-07-13", error: "boom" });
    cp.markStarted({ project: "p", date: "2026-07-13", sessionId: "s", promptVersion: "v7" });
    cp.markDone({ project: "p", date: "2026-07-13", outputPath: "/x.md" });
    cp.close();

    const res = await checkDeadLetter(dir);
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("resolved");
  });

  test("counts a task that failed on every attempt once", async () => {
    const line = JSON.stringify({ project: "p", date: "2026-07-13", error: "boom" }) + "\n";
    await Bun.write(join(dir, "failed.jsonl"), line + line + line);
    const cp = Checkpoint.open(dir);
    cp.markFailed({ project: "p", date: "2026-07-13", error: "boom" });
    cp.close();

    const res = await checkDeadLetter(dir);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("1 unresolved");
  });

  test("ignores a half-written line instead of blowing up", async () => {
    await Bun.write(
      join(dir, "failed.jsonl"),
      JSON.stringify({ project: "p", date: "2026-07-13" }) + '\n{"project":"q","da',
    );
    const cp = Checkpoint.open(dir);
    cp.markFailed({ project: "p", date: "2026-07-13", error: "boom" });
    cp.close();

    const res = await checkDeadLetter(dir);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("1 unresolved");
  });
});

describe("duePulseDates", () => {
  test("after the scheduled hour, yesterday is due", () => {
    const dates = duePulseDates(new Date("2026-07-14T11:00:00"), 3);
    expect(dates).toEqual(["2026-07-11", "2026-07-12", "2026-07-13"]);
  });

  test("before the scheduled hour, yesterday is not late — it has not run yet", () => {
    const dates = duePulseDates(new Date("2026-07-14T09:00:00"), 3);
    expect(dates).toEqual(["2026-07-10", "2026-07-11", "2026-07-12"]);
    expect(dates).not.toContain("2026-07-13");
  });

  test("crosses a month boundary", () => {
    expect(duePulseDates(new Date("2026-07-02T12:00:00"), 3)).toEqual([
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
    ]);
  });
});

describe("pulseDatesOnDisk", () => {
  test("returns an empty set for a vault folder that does not exist", async () => {
    expect((await pulseDatesOnDisk(join(dir, "nope"))).size).toBe(0);
  });

  test("reads current pulses and archived ones, single- and double-dash alike", async () => {
    const vault = join(dir, "Projects/p");
    await writePulse(vault, "2026-07-13-p.md");
    await writePulse(vault, "2026-07-12--p.md");
    await Bun.write(join(vault, "_archive/2026-06/2026-06-30-p.md"), "x");

    const dates = await pulseDatesOnDisk(vault);
    expect([...dates].sort()).toEqual(["2026-06-30", "2026-07-12", "2026-07-13"]);
  });

  test("ignores non-pulse notes in the folder", async () => {
    const vault = join(dir, "Projects/p");
    await writePulse(vault, "2026-07-13-p.md");
    await Bun.write(join(vault, "p-spine.md"), "x");
    await Bun.write(join(vault, "_index.md"), "x");

    expect([...(await pulseDatesOnDisk(vault))]).toEqual(["2026-07-13"]);
  });
});

describe("checkProjectPulseGap", () => {
  const due = ["2026-07-11", "2026-07-12", "2026-07-13"];

  test("catches the incident: the pulse the pipeline lost is simply absent", async () => {
    const vault = join(dir, "Projects/gamma");
    await writePulse(vault, "2026-07-11-acme-gamma.md");
    await writePulse(vault, "2026-07-12-acme-gamma.md");

    const res = await checkProjectPulseGap(project("acme-gamma", vault), due);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("2026-07-13");
    expect(res.detail).toContain("janus pulse --date 2026-07-13");
  });

  test("passes when every due date has a pulse", async () => {
    const vault = join(dir, "Projects/p");
    for (const d of due) await writePulse(vault, `${d}-p.md`);

    const res = await checkProjectPulseGap(project("p", vault), due);
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("no gaps since 2026-07-11");
  });

  test("reports every missing date, not just the newest", async () => {
    const vault = join(dir, "Projects/p");
    await writePulse(vault, "2026-07-11-p.md");

    const res = await checkProjectPulseGap(project("p", vault), due);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("2026-07-12, 2026-07-13");
  });

  test("a hole stays visible once later days fill in", async () => {
    const vault = join(dir, "Projects/p");
    await writePulse(vault, "2026-07-11-p.md");
    await writePulse(vault, "2026-07-13-p.md");

    const res = await checkProjectPulseGap(project("p", vault), due);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("2026-07-12");
  });

  test("a project that never ran is not a gap", async () => {
    const res = await checkProjectPulseGap(project("innervate", join(dir, "Projects/innervate")), due);
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("no pulses yet");
  });

  test("the days before a project joined Janus are not missing", async () => {
    const vault = join(dir, "Projects/padelink");
    await writePulse(vault, "2026-07-12-padelink.md");
    await writePulse(vault, "2026-07-13-padelink.md");

    const res = await checkProjectPulseGap(project("padelink", vault), due);
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("no gaps since 2026-07-12");
  });

  test("an archived pulse counts — the month rolled over", async () => {
    const vault = join(dir, "Projects/p");
    await Bun.write(join(vault, "_archive/2026-07/2026-07-11-p.md"), "x");
    await writePulse(vault, "2026-07-12-p.md");
    await writePulse(vault, "2026-07-13-p.md");

    const res = await checkProjectPulseGap(project("p", vault), due);
    expect(res.ok).toBe(true);
  });
});

describe("checkLaunchdLoaded", () => {
  test("non-darwin throws", async () => {
    if (process.platform === "darwin") return;
    await expect(checkLaunchdLoaded()).rejects.toThrow(/macOS-only/);
  });

  test("reports an unloaded job as a failure", async () => {
    if (process.platform !== "darwin") return;
    const res = await checkLaunchdLoaded("com.crewtives.janus.doctor-test-absent");
    expect(res.name).toBe("scheduler");
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("not loaded");
    expect(res.detail).toContain("janus init");
  });

  test("defaults to the label janus init installs", async () => {
    if (process.platform !== "darwin") return;
    const { DEFAULT_LABEL } = await import("../src/core/init/launchd.ts");
    const res = await checkLaunchdLoaded();
    expect(res.detail).toContain(DEFAULT_LABEL);
  });
});
