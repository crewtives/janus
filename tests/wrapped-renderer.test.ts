import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderDeterministic, renderWrapped } from "../src/core/wrapped/renderer.ts";
import type { JanusConfig } from "../src/config/types.ts";
import type { WrappedData } from "../src/core/wrapped/types.ts";

function makeData(overrides: Partial<WrappedData> = {}): WrappedData {
  return {
    scope: "yearly",
    year: 2026,
    target: "_global",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    metrics: {
      pulses: 320, pulsesActive: 280, projects: 7, projectsActive: 6,
      decisionsCanonical: 12, decisionsCandidate: 25,
      tracksOpen: 4, tracksCompleted: 11, tracksArchived: 5,
      hoursSessions: null, commits: null, pulsesByMonth: { "2026-03": 15 },
    },
    topTracks: [
      { slug: "alpha", project: "p", mentionsCount: 8, firstSeen: "2026-01-15", lastMentioned: "2026-11-22", status: "completed" },
    ],
    topDecisions: [{ adrId: "ADR-007", project: "p", references: 6 }],
    biggestWeek: { startDate: "2026-03-15", endDate: "2026-03-21", density: 18, pulsesCount: 14, decisionsCount: 4 },
    birthdays: [{ project: "p", birthDate: "2024-05-22", years: 2 }],
    themes: ["🔵 Onboarding", "🟢 MCP server"],
    sampleTldrs: [],
    personality: {
      archetype: "The Shipper",
      explanation: "shipRatio 73%",
      evidence: ["11/15 tracks cerrados"],
      confidence: 0.85,
      signals: {
        shipRatio: 0.73, refactorRatio: 0.2, exploreSpread: 0.85, connectorRatio: 0.1,
        avgSessionLength: 45, sessionsCount: 120,
      },
    },
    ...overrides,
  };
}

describe("wrapped/renderer — deterministic", () => {
  test("yearly produces valid markdown with all sections", () => {
    const md = renderDeterministic(makeData());
    expect(md.startsWith("---")).toBe(true);
    expect(md).toContain("type: wrapped-yearly");
    expect(md).toContain("year: 2026");
    expect(md).toContain("Your year in numbers");
    expect(md).toContain("Your maker personality: The Shipper");
    expect(md).toContain("Top tracks of the year");
    expect(md).toContain("alpha");
    expect(md).toContain("Densest week");
    expect(md).toContain("ADR-007");
    expect(md).toContain("Project birthdays");
    expect(md).toContain("🔵 Onboarding");
  });

  test("project scope adjusts tags and frontmatter", () => {
    const md = renderDeterministic(makeData({ scope: "project", target: "janus" }));
    expect(md).toContain("type: wrapped-project");
    expect(md).toContain("project: janus");
    expect(md).toContain("wrapped/project");
  });

  test("empty data produces a minimal wrapped without crashing", () => {
    const md = renderDeterministic(makeData({
      topTracks: [], topDecisions: [], biggestWeek: null, birthdays: [], themes: [],
    }));
    expect(md).toContain("Your year in numbers");
    expect(md).not.toContain("Top tracks of the year");
    expect(md).not.toContain("Densest week");
  });
});

describe("wrapped/renderer — renderWrapped writes file", () => {
  test("deterministicOnly writes file and returns path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-wrap-render-"));
    const vault = join(dir, "vault");
    const config: JanusConfig = {
      obsidianVault: vault,
      stateDir: dir,
      projects: [],
    };
    const out = await renderWrapped({
      config,
      data: makeData(),
      deterministicOnly: true,
    });
    expect(out.path.endsWith("Wrapped-2026.md")).toBe(true);
    expect(out.llmGenerated).toBe(false);
    const content = await Bun.file(out.path).text();
    expect(content).toContain("type: wrapped-yearly");
  });
});
