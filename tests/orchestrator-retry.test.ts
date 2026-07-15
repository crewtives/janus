import { describe, expect, test } from "bun:test";
import { Checkpoint } from "../src/core/checkpoint.ts";
import type { ProjectConfig } from "../src/config/types.ts";
import { planRetry } from "../src/pipeline/orchestrator.ts";

/**
 * Regression: `janus retry` iteraba el dead-letter entero sin chequear
 * isDone(). El archivo es append-only, así que acumulaba 24 entradas de las
 * cuales 23 ya estaban done: correrlo habría reprocesado y PISADO 23 pulses
 * buenos (writePulse escribe sin backup) y reseteado las baselines del
 * feedback loop.
 *
 * planRetry es el único filtro entre el dead-letter y processProject: lo que
 * no esté en `planned` no se toca. Por eso estos tests son la garantía.
 */

function project(name: string, status?: ProjectConfig["status"]): ProjectConfig {
  return {
    name,
    repoPath: `/tmp/${name}`,
    obsidianPath: `/tmp/vault/${name}`,
    ...(status ? { status } : {}),
  } as ProjectConfig;
}

function line(project: string, date: string): string {
  return JSON.stringify({ project, date, error: "boom", at: "2026-07-14T10:00:00.000Z" });
}

function withDone(rows: Array<{ project: string; date: string }>): Checkpoint {
  const cp = Checkpoint.openInMemory();
  for (const r of rows) {
    cp.markStarted({ project: r.project, date: r.date, sessionId: "s", promptVersion: "v1" });
    cp.markDone({ project: r.project, date: r.date, outputPath: `/tmp/${r.project}-${r.date}.md` });
  }
  return cp;
}

describe("planRetry", () => {
  test("does NOT reprocess a date already done", () => {
    const cp = withDone([{ project: "janus", date: "2026-07-12" }]);
    const plan = planRetry({
      lines: [line("janus", "2026-07-12"), line("janus", "2026-07-13")],
      projects: [project("janus")],
      cp,
    });
    cp.close();
    expect(plan.planned.map((p) => p.date)).toEqual(["2026-07-13"]);
    expect(plan.skipped).toEqual([
      { project: "janus", date: "2026-07-12", reason: "already done, skip (use --force to reprocess)" },
    ]);
  });

  test("the real shape of the incident: 24 entries, 23 done — only 1 is replayed", () => {
    const dates = Array.from({ length: 24 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);
    const cp = withDone(dates.slice(0, 23).map((date) => ({ project: "janus", date })));
    const plan = planRetry({
      lines: dates.map((d) => line("janus", d)),
      projects: [project("janus")],
      cp,
    });
    cp.close();
    expect(plan.planned).toHaveLength(1);
    expect(plan.planned[0]!.date).toBe("2026-06-24");
    expect(plan.skipped).toHaveLength(23);
  });

  test("--force reprocesses done entries — that is the escape hatch, and it is opt-in", () => {
    const cp = withDone([{ project: "janus", date: "2026-07-12" }]);
    const plan = planRetry({
      lines: [line("janus", "2026-07-12")],
      projects: [project("janus")],
      cp,
      force: true,
    });
    cp.close();
    expect(plan.planned.map((p) => p.date)).toEqual(["2026-07-12"]);
    expect(plan.skipped).toEqual([]);
  });

  test("dedupes repeated (project, date) — the dead-letter is append-only", () => {
    const cp = Checkpoint.openInMemory();
    const plan = planRetry({
      lines: [line("janus", "2026-07-13"), line("janus", "2026-07-13"), line("janus", "2026-07-13")],
      projects: [project("janus")],
      cp,
    });
    cp.close();
    expect(plan.planned).toHaveLength(1);
  });

  test("skips archived projects (runPulse already did; retry did not)", () => {
    const cp = Checkpoint.openInMemory();
    const plan = planRetry({
      lines: [line("old", "2026-07-13")],
      projects: [project("old", "archived")],
      cp,
    });
    cp.close();
    expect(plan.planned).toEqual([]);
    expect(plan.skipped[0]!.reason).toBe("project archived in config");
  });

  test("skips projects no longer in config", () => {
    const cp = Checkpoint.openInMemory();
    const plan = planRetry({
      lines: [line("ghost", "2026-07-13")],
      projects: [project("janus")],
      cp,
    });
    cp.close();
    expect(plan.planned).toEqual([]);
    expect(plan.skipped[0]!.reason).toBe("project not in config");
  });

  test("ignores malformed lines instead of throwing", () => {
    const cp = Checkpoint.openInMemory();
    const plan = planRetry({
      lines: ["not json", "{}", '{"project":"janus"}', line("janus", "2026-07-13")],
      projects: [project("janus")],
      cp,
    });
    cp.close();
    expect(plan.planned.map((p) => p.date)).toEqual(["2026-07-13"]);
  });

  test("force does not resurrect archived projects or unknown ones", () => {
    const cp = withDone([{ project: "old", date: "2026-07-13" }]);
    const plan = planRetry({
      lines: [line("old", "2026-07-13"), line("ghost", "2026-07-13")],
      projects: [project("old", "archived")],
      cp,
      force: true,
    });
    cp.close();
    expect(plan.planned).toEqual([]);
  });
});
