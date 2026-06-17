import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Checkpoint } from "../src/core/checkpoint.ts";
import { dateFromSourceFilename, normalizeTrackStatus, recordTrackLineage } from "../src/core/tracks.ts";

let cp: Checkpoint;

beforeEach(() => {
  cp = Checkpoint.openInMemory();
});

afterEach(() => {
  cp.close();
});

describe("dateFromSourceFilename", () => {
  test("weekly: 2026-05-19-week → 2026-05-19", () => {
    expect(dateFromSourceFilename("2026-05-19-week")).toBe("2026-05-19");
  });
  test("monthly: 2026-05-monthly → 2026-05-01", () => {
    expect(dateFromSourceFilename("2026-05-monthly")).toBe("2026-05-01");
  });
  test("quarterly: 2026-Q2 → 2026-04-01", () => {
    expect(dateFromSourceFilename("2026-Q2")).toBe("2026-04-01");
    expect(dateFromSourceFilename("2026-Q3")).toBe("2026-07-01");
    expect(dateFromSourceFilename("2026-Q4")).toBe("2026-10-01");
    expect(dateFromSourceFilename("2026-Q1")).toBe("2026-01-01");
  });
  test("yearly: 2026-yearly → 2026-01-01", () => {
    expect(dateFromSourceFilename("2026-yearly")).toBe("2026-01-01");
  });
  test("unknown filename → null", () => {
    expect(dateFromSourceFilename("foo-bar")).toBeNull();
  });
});

describe("normalizeTrackStatus", () => {
  test("real prose observed in production maps to the enum", () => {
    expect(normalizeTrackStatus("completado — sin STRATEGY.md formal")).toBe("completed");
    expect(normalizeTrackStatus("completado — WAF de Cloudflare requiere toggle manual para agentes")).toBe("completed");
    expect(normalizeTrackStatus("con blockers — AstroPay live sin payment methods habilitados")).toBe("open");
    expect(normalizeTrackStatus("on-track — blocker puntual en SSE HMAC↔Bearer")).toBe("open");
  });

  test("a 'complete' word in the gloss does not flip an in-progress track", () => {
    expect(normalizeTrackStatus("on-track — falta completar el endpoint")).toBe("open");
  });

  test("already-enum values pass through; empty/unknown default to open", () => {
    expect(normalizeTrackStatus("open")).toBe("open");
    expect(normalizeTrackStatus("completed")).toBe("completed");
    expect(normalizeTrackStatus("archived")).toBe("archived");
    expect(normalizeTrackStatus("—")).toBe("open");
    expect(normalizeTrackStatus("")).toBe("open");
    expect(normalizeTrackStatus(undefined)).toBe("open");
  });

  test("english + spanish completion/archival synonyms", () => {
    expect(normalizeTrackStatus("done: shipped to prod")).toBe("completed");
    expect(normalizeTrackStatus("cerrado")).toBe("completed");
    expect(normalizeTrackStatus("archivado por TTL")).toBe("archived");
    expect(normalizeTrackStatus("abandonado — descartado")).toBe("archived");
  });
});

describe("recordTrackLineage", () => {
  test("first record inserts first_seen = last_mentioned and count=1", () => {
    recordTrackLineage({
      checkpoint: cp,
      tracks: [{ slug: "checkout", name: "Checkout", emoji: "🟢", projects: ["proj-a"], status: "on-track", body: "" }],
      sourceFilename: "2026-05-19-week",
    });
    const rows = cp.listTrackLineage();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slug).toBe("checkout");
    expect(rows[0]?.firstSeen).toBe("2026-05-19");
    expect(rows[0]?.lastMentioned).toBe("2026-05-19");
    expect(rows[0]?.mentionsCount).toBe(1);
    // "on-track" is in-progress prose → normalized to the `open` enum so
    // open-loop detection can see it (it matches status === "open").
    expect(rows[0]?.status).toBe("open");
  });

  test("second record with later date increments count and updates last_mentioned", () => {
    recordTrackLineage({
      checkpoint: cp,
      tracks: [{ slug: "checkout", name: "Checkout", emoji: "🟢", projects: ["proj-a"], status: "on-track", body: "" }],
      sourceFilename: "2026-05-12-week",
    });
    recordTrackLineage({
      checkpoint: cp,
      tracks: [{ slug: "checkout", name: "Checkout", emoji: "🟢", projects: ["proj-a"], status: "completed", body: "" }],
      sourceFilename: "2026-05-19-week",
    });
    const rows = cp.listTrackLineage();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.firstSeen).toBe("2026-05-12");
    expect(rows[0]?.lastMentioned).toBe("2026-05-19");
    expect(rows[0]?.mentionsCount).toBe(2);
    expect(rows[0]?.status).toBe("completed");
  });

  test("regenerating with the same date does not duplicate count (idempotent)", () => {
    recordTrackLineage({
      checkpoint: cp,
      tracks: [{ slug: "checkout", name: "Checkout", emoji: "🟢", projects: ["proj-a"], status: "on-track", body: "" }],
      sourceFilename: "2026-05-19-week",
    });
    recordTrackLineage({
      checkpoint: cp,
      tracks: [{ slug: "checkout", name: "Checkout", emoji: "🟢", projects: ["proj-a"], status: "on-track", body: "" }],
      sourceFilename: "2026-05-19-week",
    });
    const rows = cp.listTrackLineage();
    expect(rows[0]?.mentionsCount).toBe(1);
  });

  test("cross-project track is recorded once per project", () => {
    recordTrackLineage({
      checkpoint: cp,
      tracks: [{ slug: "agent-native", name: "Agent Native", emoji: "🔵", projects: ["acme", "janus", "bar"], status: "on-track", body: "" }],
      sourceFilename: "2026-05-19-week",
    });
    const rows = cp.listTrackLineage();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.project).sort()).toEqual(["acme", "bar", "janus"]);
  });

  test("unknown filename → records nothing", () => {
    const r = recordTrackLineage({
      checkpoint: cp,
      tracks: [{ slug: "x", name: "X", emoji: "", projects: ["a"], status: "", body: "" }],
      sourceFilename: "garbage-filename",
    });
    expect(r.recorded).toBe(0);
    expect(cp.listTrackLineage()).toHaveLength(0);
  });
});
