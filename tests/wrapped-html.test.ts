import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWrappedHtml, renderWrappedHtmlString } from "../src/core/wrapped/html.ts";
import type { WrappedData } from "../src/core/wrapped/types.ts";
import type { JanusConfig } from "../src/config/types.ts";

function makeData(overrides: Partial<WrappedData> = {}): WrappedData {
  return {
    scope: "yearly", year: 2026, target: "_global",
    periodStart: "2026-01-01", periodEnd: "2026-12-31",
    metrics: {
      pulses: 320, pulsesActive: 280, projects: 7, projectsActive: 6,
      decisionsCanonical: 12, decisionsCandidate: 25,
      tracksOpen: 4, tracksCompleted: 11, tracksArchived: 5,
      hoursSessions: null, commits: null, pulsesByMonth: {},
    },
    topTracks: [
      { slug: "alpha-track", project: "p", mentionsCount: 8, firstSeen: "2026-01-15", lastMentioned: "2026-11-22", status: "completed" },
    ],
    topDecisions: [{ adrId: "ADR-007", project: "p", references: 6 }],
    biggestWeek: { startDate: "2026-03-15", endDate: "2026-03-21", density: 18, pulsesCount: 14, decisionsCount: 4 },
    birthdays: [], themes: [], sampleTldrs: [],
    personality: {
      archetype: "The Shipper",
      explanation: "shipRatio 73%",
      evidence: ["11/15 tracks cerrados"],
      confidence: 0.85,
      signals: { shipRatio: 0.73, refactorRatio: 0.2, exploreSpread: 0.85, connectorRatio: 0.1, avgSessionLength: 45, sessionsCount: 120 },
    },
    ...overrides,
  };
}

describe("wrapped/html", () => {
  test("renderWrappedHtmlString produces full HTML with metrics", async () => {
    const html = await renderWrappedHtmlString(makeData());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Janus Wrapped 2026");
    expect(html).toContain("The Shipper");
    expect(html).toContain("alpha-track");
    expect(html).toContain("2026-03-15");
    expect(html).toContain("<style>");
    // Sin placeholders sin resolver
    expect(html).not.toContain("{{year}}");
    expect(html).not.toContain("{{personalityArchetype}}");
  });

  test("escapeHtml escapes XSS in target", async () => {
    const html = await renderWrappedHtmlString(makeData({
      scope: "project",
      target: "<script>alert('x')</script>",
    }));
    expect(html).not.toContain("<script>alert('x')</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("renderWrappedHtml writes file to vault/Wrapped/", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-html-"));
    const config: JanusConfig = { obsidianVault: dir, stateDir: dir, projects: [] };
    const out = await renderWrappedHtml({ data: makeData(), config });
    expect(out.path.endsWith("Wrapped-2026.html")).toBe(true);
    const content = await Bun.file(out.path).text();
    expect(content).toContain("The Shipper");
  });
});
