import { describe, expect, test } from "bun:test";
import { daysToYearEnd, getTrickleSnippetForDate, renderSnippet } from "../src/core/wrapped/trickle.ts";
import type { JanusConfig } from "../src/config/types.ts";
import type { WrappedData } from "../src/core/wrapped/types.ts";

const baseConfig: JanusConfig = { obsidianVault: "/tmp", projects: [] };

function makeData(arch = "The Shipper"): WrappedData {
  return {
    scope: "yearly", year: 2026, target: "_global",
    periodStart: "2026-01-01", periodEnd: "2026-12-31",
    metrics: { pulses: 0, pulsesActive: 0, projects: 0, projectsActive: 0, decisionsCanonical: 0, decisionsCandidate: 0, tracksOpen: 0, tracksCompleted: 0, tracksArchived: 0, hoursSessions: null, commits: null, pulsesByMonth: {} },
    topTracks: [{ slug: "alpha", project: "p", mentionsCount: 8, firstSeen: "2026-01-01", lastMentioned: "2026-11-01", status: "open" }],
    topDecisions: [], biggestWeek: null, birthdays: [], themes: [], sampleTldrs: [],
    personality: arch ? { archetype: arch, explanation: "", evidence: [], confidence: 0.8, signals: { shipRatio: 0.8, refactorRatio: 0.1, exploreSpread: 0.5, connectorRatio: 0.1, avgSessionLength: 50, sessionsCount: 100 } } : null,
  };
}

describe("wrapped/trickle — daysToYearEnd", () => {
  test("computes correct offset", () => {
    expect(daysToYearEnd("2026-12-24")).toBe(7);
    expect(daysToYearEnd("2026-12-31")).toBe(0);
    expect(daysToYearEnd("2026-12-30")).toBe(1);
    expect(daysToYearEnd("2026-06-15")).toBeGreaterThan(7);
  });

  test("returns null on invalid format", () => {
    expect(daysToYearEnd("not-a-date")).toBeNull();
  });
});

describe("wrapped/trickle — snippets", () => {
  test("T-7 mentions 'one week to go'", () => {
    const out = renderSnippet(7, makeData(), "2026-12-24");
    expect(out).toContain("cocinando");
    expect(out).toContain("semana");
  });

  test("T-5 mentions archetype", () => {
    const out = renderSnippet(5, makeData("The Connector"), "2026-12-26");
    expect(out).toContain("The Connector");
    expect(out).toContain("personality");
  });

  test("T-3 mentions top track", () => {
    const out = renderSnippet(3, makeData(), "2026-12-28");
    expect(out).toContain("alpha");
    expect(out).toContain("8 menciones");
  });

  test("T-1 announces it arrives tomorrow", () => {
    const out = renderSnippet(1, null, "2026-12-30");
    expect(out).toContain("mañana");
  });

  test("T-0 confirms it shipped", () => {
    const out = renderSnippet(0, makeData(), "2026-12-31");
    expect(out).toContain("salió hoy");
  });
});

describe("wrapped/trickle — getTrickleSnippetForDate", () => {
  test("outside the window → null", async () => {
    const out = await getTrickleSnippetForDate({ config: baseConfig, date: "2026-06-15" });
    expect(out).toBeNull();
  });

  test("inside the window but a no-emit day (T-6) → null", async () => {
    const out = await getTrickleSnippetForDate({ config: baseConfig, date: "2026-12-25" });
    expect(out).toBeNull();
  });

  test("T-5 emits", async () => {
    const out = await getTrickleSnippetForDate({
      config: baseConfig,
      date: "2026-12-26",
      loadWrappedData: async () => makeData("The Shipper"),
    });
    expect(out).not.toBeNull();
    expect(out!.dayOffset).toBe(5);
    expect(out!.text).toContain("The Shipper");
  });

  test("opt-out via config → null", async () => {
    const opted: any = { ...baseConfig, wrapped: { trickle: { enabled: false } } };
    const out = await getTrickleSnippetForDate({ config: opted, date: "2026-12-26" });
    expect(out).toBeNull();
  });
});
