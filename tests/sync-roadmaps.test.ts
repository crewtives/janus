import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncRoadmaps } from "../src/core/sync-roadmaps.ts";

const PULSE_WITH_VS = `---
date: 2026-05-20
project: test-proj
status: on-track
commits: 3
prompt_version: v4
tags: [pulse]
---

## TL;DR
> ok

> [!check] Vs Roadmap
> - ✅ Completado: feature A shipped
> - ✅ Completado: feature B shipped
> - 🚧 En curso: feature C (~40%)
> - ⏸️ Esperado y sin tocar: feature D
> - ❓ Fuera de roadmap: feature E aparecida en commits
`;

interface SetupOpts {
  vaultRoadmap: string | null;
  pulses: Array<{ date: string; content: string }>;
  repoRoadmap?: { relPath: string; content: string };
}

async function setup(opts: SetupOpts): Promise<{
  obsidianPath: string;
  repoPath: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "janus-sync-rdm-"));
  const obsidianPath = join(dir, "vault");
  const repoPath = join(dir, "repo");
  const pulseDir = join(obsidianPath, "pulse");
  await mkdir(pulseDir, { recursive: true });
  await mkdir(repoPath, { recursive: true });
  if (opts.vaultRoadmap !== null) {
    await writeFile(join(obsidianPath, "_roadmap.md"), opts.vaultRoadmap);
  }
  for (const p of opts.pulses) {
    await writeFile(join(pulseDir, `${p.date}-test-proj.md`), p.content);
  }
  if (opts.repoRoadmap) {
    const abs = join(repoPath, opts.repoRoadmap.relPath);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, opts.repoRoadmap.content);
  }
  return { obsidianPath, repoPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("syncRoadmaps", () => {
  test("mirrors <repo>/ROADMAP.md into the vault when it exists", async () => {
    const repoBody = "# Real Roadmap\n\n## Q3 milestones\n\n- ship onboarding\n- ship billing\n";
    const { obsidianPath, repoPath, cleanup } = await setup({
      vaultRoadmap: `---\nneeds_review: true\n---\n\n# Draft\n`,
      pulses: [{ date: "2026-05-20", content: PULSE_WITH_VS }],
      repoRoadmap: { relPath: "ROADMAP.md", content: repoBody },
    });
    const r = await syncRoadmaps({
      projects: [{ name: "test-proj", obsidianPath, repoPath }],
    });
    expect(r.roadmapsSyncedFromRepo).toBe(1);
    expect(r.roadmapsSyncedFromPulse).toBe(0);
    expect(r.details[0]!.source).toBe("ROADMAP.md");
    const updated = await readFile(join(obsidianPath, "_roadmap.md"), "utf-8");
    expect(updated).toContain("source: repo:ROADMAP.md");
    expect(updated).toContain("# Real Roadmap");
    expect(updated).toContain("ship onboarding");
    // Repo wins over the pulse — bullets-with-emoji items must NOT leak.
    expect(updated).not.toContain("feature C");
    await cleanup();
  });

  test("also recognises docs/ROADMAP.md as a repo source", async () => {
    const { obsidianPath, repoPath, cleanup } = await setup({
      vaultRoadmap: `---\nneeds_review: true\n---\n`,
      pulses: [],
      repoRoadmap: { relPath: "docs/ROADMAP.md", content: "# Docs roadmap\n\n- thing\n" },
    });
    const r = await syncRoadmaps({
      projects: [{ name: "test-proj", obsidianPath, repoPath }],
    });
    expect(r.roadmapsSyncedFromRepo).toBe(1);
    expect(r.details[0]!.source).toBe("docs/ROADMAP.md");
    const updated = await readFile(join(obsidianPath, "_roadmap.md"), "utf-8");
    expect(updated).toContain("# Docs roadmap");
    await cleanup();
  });

  test("falls back to pulse bullets when no repo roadmap exists", async () => {
    const { obsidianPath, repoPath, cleanup } = await setup({
      vaultRoadmap: `---\nneeds_review: true\n---\n\n# Draft\n`,
      pulses: [
        { date: "2026-05-20", content: PULSE_WITH_VS },
        { date: "2026-05-19", content: "---\nstatus: idle\n---\n" },
      ],
    });
    const r = await syncRoadmaps({
      projects: [{ name: "test-proj", obsidianPath, repoPath }],
    });
    expect(r.roadmapsSyncedFromRepo).toBe(0);
    expect(r.roadmapsSyncedFromPulse).toBe(1);
    const updated = await readFile(join(obsidianPath, "_roadmap.md"), "utf-8");
    expect(updated).toContain("feature A shipped");
    expect(updated).toContain("feature C");
    expect(updated).toContain("source: pulse-sync");
    expect(updated).toContain("needs_review: true");
    await cleanup();
  });

  test("does NOT touch user-edited (needs_review: false)", async () => {
    const userRdm = `---\nneeds_review: false\n---\n\n# Roadmap manual\n- [ ] cosa mía\n`;
    const { obsidianPath, repoPath, cleanup } = await setup({
      vaultRoadmap: userRdm,
      pulses: [{ date: "2026-05-20", content: PULSE_WITH_VS }],
      repoRoadmap: { relPath: "ROADMAP.md", content: "# anything\n" },
    });
    const r = await syncRoadmaps({
      projects: [{ name: "test-proj", obsidianPath, repoPath }],
    });
    expect(r.roadmapsSkippedUserEdited).toBe(1);
    expect(r.roadmapsSyncedFromRepo).toBe(0);
    expect(r.roadmapsSyncedFromPulse).toBe(0);
    const after = await readFile(join(obsidianPath, "_roadmap.md"), "utf-8");
    expect(after).toBe(userRdm);
    await cleanup();
  });

  test("regenerates the original placeholder (no needs_review but with marker)", async () => {
    const placeholder = `# Roadmap — test-proj\n\n> Editá este archivo con los hitos y objetivos del proyecto.\n`;
    const { obsidianPath, repoPath, cleanup } = await setup({
      vaultRoadmap: placeholder,
      pulses: [{ date: "2026-05-20", content: PULSE_WITH_VS }],
    });
    const r = await syncRoadmaps({
      projects: [{ name: "test-proj", obsidianPath, repoPath }],
    });
    expect(r.roadmapsSyncedFromPulse).toBe(1);
    await cleanup();
  });

  test("writes a PENDING placeholder when no source can be found", async () => {
    const { obsidianPath, repoPath, cleanup } = await setup({
      vaultRoadmap: `---\nneeds_review: true\n---\n`,
      pulses: [{ date: "2026-05-20", content: "---\nstatus: idle\n---\n" }],
    });
    const r = await syncRoadmaps({
      projects: [{ name: "test-proj", obsidianPath, repoPath }],
    });
    expect(r.roadmapsPendingNoSource).toBe(1);
    expect(r.roadmapsSyncedFromRepo).toBe(0);
    expect(r.roadmapsSyncedFromPulse).toBe(0);
    const updated = await readFile(join(obsidianPath, "_roadmap.md"), "utf-8");
    expect(updated).toContain("PENDIENTE");
    expect(updated).toContain("source: pending");
    expect(updated).toContain(repoPath);
    await cleanup();
  });

  test("dryRun does not write", async () => {
    const { obsidianPath, repoPath, cleanup } = await setup({
      vaultRoadmap: `---\nneeds_review: true\n---\n# Original\n`,
      pulses: [{ date: "2026-05-20", content: PULSE_WITH_VS }],
    });
    await syncRoadmaps({
      projects: [{ name: "test-proj", obsidianPath, repoPath }],
      dryRun: true,
    });
    const after = await readFile(join(obsidianPath, "_roadmap.md"), "utf-8");
    expect(after).toContain("# Original");
    await cleanup();
  });
});
