import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWrappedPng } from "../src/core/wrapped/png.ts";
import type { WrappedData } from "../src/core/wrapped/types.ts";
import type { JanusConfig } from "../src/config/types.ts";

function makeData(): WrappedData {
  return {
    scope: "yearly", year: 2026, target: "_global",
    periodStart: "2026-01-01", periodEnd: "2026-12-31",
    metrics: { pulses: 1, pulsesActive: 1, projects: 1, projectsActive: 1, decisionsCanonical: 0, decisionsCandidate: 0, tracksOpen: 0, tracksCompleted: 0, tracksArchived: 0, hoursSessions: null, commits: null, pulsesByMonth: {} },
    topTracks: [], topDecisions: [], biggestWeek: null, birthdays: [], themes: [], sampleTldrs: [],
    personality: null,
  };
}

describe("wrapped/png", () => {
  test("useful error when puppeteer is not installed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-png-"));
    const config: JanusConfig = { obsidianVault: dir, stateDir: dir, projects: [] };
    // En el entorno del repo no instalamos puppeteer — debe fallar con mensaje útil.
    let err: Error | null = null;
    try {
      await renderWrappedPng({ data: makeData(), config });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain("puppeteer");
    expect(err!.message).toContain("bun add");
  });
});
