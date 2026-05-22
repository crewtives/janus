import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Checkpoint } from "../src/core/checkpoint.ts";
import { aggregateWrappedData } from "../src/core/wrapped/aggregator.ts";
import type { JanusConfig } from "../src/config/types.ts";

function makeConfig(stateDir: string, vault: string, projects: { name: string; repo: string; vault: string }[] = []): JanusConfig {
  return {
    obsidianVault: vault,
    stateDir,
    projects: projects.map((p) => ({ name: p.name, repoPath: p.repo, obsidianPath: p.vault })),
  };
}

describe("wrapped/aggregator", () => {
  test("empty year returns structure with zeros", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-wrap-"));
    const vault = join(dir, "vault");
    mkdirSync(vault, { recursive: true });
    const config = makeConfig(dir, vault);
    const data = await aggregateWrappedData({
      config,
      scope: "yearly",
      year: 2026,
      skipFilesystem: true,
    });
    expect(data.scope).toBe("yearly");
    expect(data.year).toBe(2026);
    expect(data.metrics.pulses).toBe(0);
    expect(data.metrics.projects).toBe(0);
    expect(data.topTracks).toEqual([]);
    expect(data.topDecisions).toEqual([]);
    expect(data.biggestWeek).toBeNull();
  });

  test("aggregates metrics + tracks + decisions for a year with data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-wrap-"));
    const vault = join(dir, "vault");
    mkdirSync(vault, { recursive: true });
    const cp = Checkpoint.open(dir);
    // 3 pulses done en 2026 + 1 fuera del año
    cp.markStarted({ project: "p", date: "2026-03-10", sessionId: "a", promptVersion: "v6" });
    cp.markDone({ project: "p", date: "2026-03-10", outputPath: "/tmp/x" });
    cp.markStarted({ project: "p", date: "2026-03-11", sessionId: "b", promptVersion: "v6" });
    cp.markDone({ project: "p", date: "2026-03-11", outputPath: "/tmp/x" });
    cp.markStarted({ project: "q", date: "2026-06-15", sessionId: "c", promptVersion: "v6" });
    cp.markDone({ project: "q", date: "2026-06-15", outputPath: "/tmp/x" });
    cp.markStarted({ project: "p", date: "2025-12-30", sessionId: "d", promptVersion: "v6" });
    cp.markDone({ project: "p", date: "2025-12-30", outputPath: "/tmp/x" });

    cp.recordTrackMention({ slug: "alpha", project: "p", date: "2026-03-10" });
    cp.recordTrackMention({ slug: "alpha", project: "p", date: "2026-03-11" });
    cp.recordTrackMention({ slug: "beta", project: "q", date: "2026-06-15" });

    cp.recordDecisionReference({ adrId: "ADR-001", pulseDate: "2026-03-10", project: "p", referenceType: "mention" });
    cp.recordDecisionReference({ adrId: "ADR-001", pulseDate: "2026-03-11", project: "p", referenceType: "mention" });
    cp.recordDecisionReference({ adrId: "ADR-002", pulseDate: "2026-06-15", project: "q", referenceType: "mention" });
    cp.close();

    const config = makeConfig(dir, vault);
    const data = await aggregateWrappedData({ config, scope: "yearly", year: 2026, skipFilesystem: true });

    expect(data.metrics.pulsesActive).toBe(3);
    expect(data.metrics.projects).toBe(2);
    expect(data.topTracks.length).toBe(2);
    expect(data.topTracks[0]!.slug).toBe("alpha");
    expect(data.topTracks[0]!.mentionsCount).toBe(2);
    expect(data.topDecisions[0]!.adrId).toBe("ADR-001");
    expect(data.topDecisions[0]!.references).toBe(2);
    expect(data.biggestWeek).not.toBeNull();
    expect(data.biggestWeek!.pulsesCount).toBeGreaterThanOrEqual(2);
  });

  test("scope project filters correctly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-wrap-"));
    const vault = join(dir, "vault");
    mkdirSync(vault, { recursive: true });
    const cp = Checkpoint.open(dir);
    cp.markStarted({ project: "p", date: "2026-03-10", sessionId: "a", promptVersion: "v6" });
    cp.markDone({ project: "p", date: "2026-03-10", outputPath: "/tmp/x" });
    cp.markStarted({ project: "q", date: "2026-03-10", sessionId: "b", promptVersion: "v6" });
    cp.markDone({ project: "q", date: "2026-03-10", outputPath: "/tmp/x" });
    cp.recordTrackMention({ slug: "alpha", project: "p", date: "2026-03-10" });
    cp.recordTrackMention({ slug: "beta", project: "q", date: "2026-03-10" });
    cp.close();

    const config = makeConfig(dir, vault, [
      { name: "p", repo: "/nonex", vault: "/nonex" },
      { name: "q", repo: "/nonex", vault: "/nonex" },
    ]);
    const data = await aggregateWrappedData({
      config,
      scope: "project",
      year: 2026,
      project: "p",
      skipFilesystem: true,
    });
    expect(data.metrics.projects).toBe(1);
    expect(data.topTracks).toHaveLength(1);
    expect(data.topTracks[0]!.slug).toBe("alpha");
  });

  test("birthdays computes years from birth_date to year-end", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-wrap-"));
    const vault = join(dir, "vault");
    mkdirSync(vault, { recursive: true });
    const cp = Checkpoint.open(dir);
    cp.upsertProjectMetadata({ project: "p", birthDateGit: "2023-05-22", birthDatePulse: null });
    cp.upsertProjectMetadata({ project: "q", birthDateGit: null, birthDatePulse: "2026-03-01" });
    cp.close();

    const config = makeConfig(dir, vault, [
      { name: "p", repo: "/nonex", vault: "/nonex" },
      { name: "q", repo: "/nonex", vault: "/nonex" },
    ]);
    const data = await aggregateWrappedData({
      config,
      scope: "yearly",
      year: 2026,
      skipFilesystem: true,
    });
    const pBday = data.birthdays.find((b) => b.project === "p");
    expect(pBday).toBeDefined();
    expect(pBday!.years).toBe(3);
    // q nació en 2026 → year_end - birth_year = 0, no se incluye (>= 1)
    expect(data.birthdays.find((b) => b.project === "q")).toBeUndefined();
  });

  test("discards candidates from top decisions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-wrap-"));
    const vault = join(dir, "vault");
    mkdirSync(vault, { recursive: true });
    const cp = Checkpoint.open(dir);
    cp.recordDecisionReference({
      adrId: "candidate:2026-03-10--p:decision-1",
      pulseDate: "2026-03-10",
      project: "p",
      referenceType: "candidate",
    });
    cp.recordDecisionReference({ adrId: "ADR-005", pulseDate: "2026-03-10", project: "p", referenceType: "mention" });
    cp.close();
    const data = await aggregateWrappedData({ config: makeConfig(dir, vault), scope: "yearly", year: 2026, skipFilesystem: true });
    expect(data.topDecisions).toHaveLength(1);
    expect(data.topDecisions[0]!.adrId).toBe("ADR-005");
  });

  test("themes extracts from monthly headings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-wrap-"));
    const vault = join(dir, "vault");
    const monthlyDir = join(vault, "Timeline", "Monthly");
    mkdirSync(monthlyDir, { recursive: true });
    writeFileSync(
      join(monthlyDir, "2026-03-monthly.md"),
      `# Monthly\n\n## Tracks del mes\n\n### 🔵 Acme onboarding\n- bla\n\n### 🟢 MCP server consolidation\n- bla\n`,
    );
    const config = makeConfig(dir, vault);
    const data = await aggregateWrappedData({ config, scope: "yearly", year: 2026 });
    expect(data.themes.length).toBeGreaterThanOrEqual(2);
    expect(data.themes.some((t) => t.includes("Acme onboarding"))).toBe(true);
  });
});
