import { describe, expect, test } from "bun:test";
import { Checkpoint } from "../src/core/checkpoint.ts";
import type { ProjectConfig } from "../src/config/types.ts";
import { CATCH_UP_WINDOW_DAYS, computeCatchUpDates, determineDates, shouldCatchUp } from "../src/pipeline/orchestrator.ts";

/**
 * Regression: el 2026-07-13 el pulse de un proyecto falló la validación y se
 * perdió para siempre. Nada lo reintentaba: el cron pide sólo [ayer], launchd
 * no recupera corridas perdidas, y `queryFailed()` no tenía un solo caller.
 * Estos tests fijan el backstop y —sobre todo— su cota: nunca debe degenerar
 * en un backfill accidental de meses.
 */

const YESTERDAY = "2026-07-14";

function project(name: string, status?: ProjectConfig["status"]): ProjectConfig {
  return {
    name,
    repoPath: `/tmp/${name}`,
    obsidianPath: `/tmp/vault/${name}`,
    ...(status ? { status } : {}),
  } as ProjectConfig;
}

/** Checkpoint real en memoria: el catch-up depende del SQL, no de un mock. */
function seed(rows: Array<{ project: string; date: string; status: "done" | "failed" }>): Checkpoint {
  const cp = Checkpoint.openInMemory();
  for (const r of rows) {
    if (r.status === "done") {
      cp.markStarted({ project: r.project, date: r.date, sessionId: "s", promptVersion: "v1" });
      cp.markDone({ project: r.project, date: r.date, outputPath: `/tmp/${r.project}-${r.date}.md` });
    } else {
      cp.markFailed({ project: r.project, date: r.date, error: "pulse invalid after retry" });
    }
  }
  return cp;
}

describe("computeCatchUpDates", () => {
  test("recovers a failed date inside the window", () => {
    const cp = seed([
      { project: "gamma", date: "2026-07-12", status: "done" },
      { project: "gamma", date: "2026-07-13", status: "failed" },
    ]);
    const out = computeCatchUpDates({
      cp,
      projects: [project("gamma")],
      yesterday: YESTERDAY,
      windowDays: CATCH_UP_WINDOW_DAYS,
    });
    cp.close();
    expect(out).toEqual([
      { project: "gamma", date: "2026-07-13", reason: "failed" },
      { project: "gamma", date: "2026-07-14", reason: "missing" },
    ]);
  });

  test("recovers days with no pulse between the last done and yesterday", () => {
    const cp = seed([{ project: "janus", date: "2026-07-11", status: "done" }]);
    const out = computeCatchUpDates({
      cp,
      projects: [project("janus")],
      yesterday: YESTERDAY,
      windowDays: CATCH_UP_WINDOW_DAYS,
    });
    cp.close();
    expect(out.map((e) => e.date)).toEqual(["2026-07-12", "2026-07-13", "2026-07-14"]);
    expect(out.every((e) => e.reason === "missing")).toBe(true);
  });

  test("a failed date is reported once, as failed, not also as missing", () => {
    const cp = seed([
      { project: "janus", date: "2026-07-12", status: "done" },
      { project: "janus", date: "2026-07-13", status: "failed" },
    ]);
    const out = computeCatchUpDates({
      cp,
      projects: [project("janus")],
      yesterday: YESTERDAY,
      windowDays: CATCH_UP_WINDOW_DAYS,
    });
    cp.close();
    const forDate = out.filter((e) => e.date === "2026-07-13");
    expect(forDate).toEqual([{ project: "janus", date: "2026-07-13", reason: "failed" }]);
  });

  test("NEVER reaches past the window — a months-old gap recovers only N days", () => {
    const cp = seed([
      { project: "janus", date: "2026-01-05", status: "done" },
      { project: "janus", date: "2026-02-02", status: "failed" },
    ]);
    const out = computeCatchUpDates({
      cp,
      projects: [project("janus")],
      yesterday: YESTERDAY,
      windowDays: CATCH_UP_WINDOW_DAYS,
    });
    cp.close();
    // El gap real es de ~6 meses. El backstop recupera 7 días y nada más.
    expect(out).toHaveLength(CATCH_UP_WINDOW_DAYS);
    expect(out.map((e) => e.date)).toEqual([
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
    ]);
    // El failed de febrero queda fuera: es historia, no un día perdido.
    expect(out.some((e) => e.date === "2026-02-02")).toBe(false);
  });

  test("a project that never produced a pulse is not a gap — fresh install backfills nothing", () => {
    const cp = seed([]);
    const out = computeCatchUpDates({
      cp,
      projects: [project("innervate")],
      yesterday: YESTERDAY,
      windowDays: CATCH_UP_WINDOW_DAYS,
    });
    cp.close();
    expect(out).toEqual([]);
  });

  test("nothing to recover when the last done is yesterday", () => {
    const cp = seed([{ project: "janus", date: YESTERDAY, status: "done" }]);
    const out = computeCatchUpDates({
      cp,
      projects: [project("janus")],
      yesterday: YESTERDAY,
      windowDays: CATCH_UP_WINDOW_DAYS,
    });
    cp.close();
    expect(out).toEqual([]);
  });

  test("archived projects are never caught up", () => {
    const cp = seed([
      { project: "old", date: "2026-07-10", status: "done" },
      { project: "old", date: "2026-07-13", status: "failed" },
    ]);
    const out = computeCatchUpDates({
      cp,
      projects: [project("old", "archived")],
      yesterday: YESTERDAY,
      windowDays: CATCH_UP_WINDOW_DAYS,
    });
    cp.close();
    expect(out).toEqual([]);
  });

  test("failures of projects outside the run's selection are ignored", () => {
    const cp = seed([{ project: "gamma", date: "2026-07-13", status: "failed" }]);
    const out = computeCatchUpDates({
      cp,
      projects: [project("janus")],
      yesterday: YESTERDAY,
      windowDays: CATCH_UP_WINDOW_DAYS,
    });
    cp.close();
    expect(out).toEqual([]);
  });

  test("a date already done is never re-queued as missing", () => {
    const cp = seed([
      { project: "janus", date: "2026-07-13", status: "done" },
      { project: "janus", date: "2026-07-14", status: "done" },
    ]);
    const out = computeCatchUpDates({
      cp,
      projects: [project("janus")],
      yesterday: YESTERDAY,
      windowDays: CATCH_UP_WINDOW_DAYS,
    });
    cp.close();
    expect(out).toEqual([]);
  });

  test("each project gets its own gap", () => {
    const cp = seed([
      { project: "janus", date: "2026-07-13", status: "done" },
      { project: "gamma", date: "2026-07-11", status: "done" },
    ]);
    const out = computeCatchUpDates({
      cp,
      projects: [project("janus"), project("gamma")],
      yesterday: YESTERDAY,
      windowDays: CATCH_UP_WINDOW_DAYS,
    });
    cp.close();
    expect(out.filter((e) => e.project === "janus").map((e) => e.date)).toEqual(["2026-07-14"]);
    expect(out.filter((e) => e.project === "gamma").map((e) => e.date)).toEqual([
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
    ]);
  });
});

describe("Checkpoint.lastDoneDate", () => {
  test("returns the max done date, ignoring failed rows and other projects", () => {
    const cp = seed([
      { project: "janus", date: "2026-07-10", status: "done" },
      { project: "janus", date: "2026-07-12", status: "done" },
      { project: "janus", date: "2026-07-13", status: "failed" },
      { project: "gamma", date: "2026-07-14", status: "done" },
    ]);
    expect(cp.lastDoneDate("janus")).toBe("2026-07-12");
    expect(cp.lastDoneDate("gamma")).toBe("2026-07-14");
    expect(cp.lastDoneDate("nope")).toBeNull();
    cp.close();
  });
});

describe("shouldCatchUp", () => {
  test("fires on the bare cron path — that is the whole point", () => {
    expect(shouldCatchUp({})).toBe(true);
    expect(shouldCatchUp({ project: "janus" })).toBe(true);
    expect(shouldCatchUp({ dryRun: true })).toBe(true);
  });

  test("an explicit range is honoured literally", () => {
    expect(shouldCatchUp({ date: "2026-07-13" })).toBe(false);
    expect(shouldCatchUp({ since: "2026-07-01" })).toBe(false);
    expect(shouldCatchUp({ backfill: "3d" })).toBe(false);
  });

  test("--force never widens: it bypasses isDone, so a week of catch-up dates would overwrite good pulses", () => {
    // `janus pulse --force` means "redo yesterday". Unioning the catch-up
    // window in would silently rewrite up to CATCH_UP_WINDOW_DAYS days of
    // already-good pulses for every project — writePulse has no backup.
    expect(shouldCatchUp({ force: true })).toBe(false);
  });
});

describe("determineDates", () => {
  test("--since never includes today: today is still half-lived", () => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 3);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dates = determineDates({ since: localDate(start) });

    // El bug: cerraba en todayLocal(), escribía el pulse de medio día y lo
    // marcaba done — el cron de mañana lo saltea y el día queda truncado.
    expect(dates).not.toContain(localDate(today));
    expect(dates.at(-1)).toBe(localDate(yesterday));
  });

  test("--date takes precedence and is honoured literally", () => {
    expect(determineDates({ date: "2026-07-13" })).toEqual(["2026-07-13"]);
  });

  test("--backfill still ends at yesterday", () => {
    const dates = determineDates({ backfill: "3d" });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(dates.at(-1)).toBe(localDate(yesterday));
  });
});

/** Local (no UTC): determineDates usa la fecha local del proceso. */
function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
