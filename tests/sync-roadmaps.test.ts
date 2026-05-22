import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncRoadmapsFromPulses } from "../src/core/sync-roadmaps.ts";

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

async function setup(opts: { roadmapContent: string | null; pulses: Array<{ date: string; content: string }> }): Promise<{ obsidianPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "janus-sync-rdm-"));
  const obsidianPath = join(dir, "vault");
  const pulseDir = join(obsidianPath, "pulse");
  await mkdir(pulseDir, { recursive: true });
  if (opts.roadmapContent !== null) {
    await writeFile(join(obsidianPath, "_roadmap.md"), opts.roadmapContent);
  }
  for (const p of opts.pulses) {
    await writeFile(join(pulseDir, `${p.date}-test-proj.md`), p.content);
  }
  return { obsidianPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("syncRoadmapsFromPulses", () => {
  test("syncs roadmap draft with Vs Roadmap from the most recent non-idle pulse", async () => {
    const { obsidianPath, cleanup } = await setup({
      roadmapContent: `---\nneeds_review: true\n---\n\n# Draft\n`,
      pulses: [
        { date: "2026-05-20", content: PULSE_WITH_VS },
        { date: "2026-05-19", content: "---\nstatus: idle\n---\n" },
      ],
    });
    const r = await syncRoadmapsFromPulses({ projects: [{ name: "test-proj", obsidianPath }] });
    expect(r.roadmapsSynced).toBe(1);
    const updated = await readFile(join(obsidianPath, "_roadmap.md"), "utf-8");
    expect(updated).toContain("feature A shipped");
    expect(updated).toContain("feature B shipped");
    expect(updated).toContain("feature C");
    expect(updated).toContain("feature D");
    expect(updated).toContain("feature E aparecida");
    expect(updated).toContain("needs_review: true");
    expect(updated).toContain("source: pulse-sync");
    await cleanup();
  });

  test("does NOT touch user-edited (needs_review: false)", async () => {
    const userRdm = `---\nneeds_review: false\n---\n\n# Roadmap manual\n- [ ] cosa mía\n`;
    const { obsidianPath, cleanup } = await setup({
      roadmapContent: userRdm,
      pulses: [{ date: "2026-05-20", content: PULSE_WITH_VS }],
    });
    const r = await syncRoadmapsFromPulses({ projects: [{ name: "test-proj", obsidianPath }] });
    expect(r.roadmapsSynced).toBe(0);
    expect(r.roadmapsSkippedUserEdited).toBe(1);
    const after = await readFile(join(obsidianPath, "_roadmap.md"), "utf-8");
    expect(after).toBe(userRdm);
    await cleanup();
  });

  test("regenerates the original placeholder (no needs_review but with marker)", async () => {
    const placeholder = `# Roadmap — test-proj\n\n> Editá este archivo con los hitos y objetivos del proyecto.\n`;
    const { obsidianPath, cleanup } = await setup({
      roadmapContent: placeholder,
      pulses: [{ date: "2026-05-20", content: PULSE_WITH_VS }],
    });
    const r = await syncRoadmapsFromPulses({ projects: [{ name: "test-proj", obsidianPath }] });
    expect(r.roadmapsSynced).toBe(1);
    await cleanup();
  });

  test("no non-idle pulse → does not sync", async () => {
    const { obsidianPath, cleanup } = await setup({
      roadmapContent: `---\nneeds_review: true\n---\n`,
      pulses: [{ date: "2026-05-20", content: "---\nstatus: idle\n---\n" }],
    });
    const r = await syncRoadmapsFromPulses({ projects: [{ name: "test-proj", obsidianPath }] });
    expect(r.roadmapsSynced).toBe(0);
    expect(r.roadmapsSkippedNoSource).toBe(1);
    await cleanup();
  });

  test("dryRun does not write", async () => {
    const { obsidianPath, cleanup } = await setup({
      roadmapContent: `---\nneeds_review: true\n---\n# Original\n`,
      pulses: [{ date: "2026-05-20", content: PULSE_WITH_VS }],
    });
    await syncRoadmapsFromPulses({ projects: [{ name: "test-proj", obsidianPath }], dryRun: true });
    const after = await readFile(join(obsidianPath, "_roadmap.md"), "utf-8");
    expect(after).toContain("# Original");
    await cleanup();
  });
});
