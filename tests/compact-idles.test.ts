import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactIdleStreaks } from "../src/core/compact-idles.ts";

interface PulseSpec {
  date: string;
  status: string;
  /** Si true, genera un pulse on-track con shipped/decisions/risks (NO boring). */
  withActivity?: boolean;
}

async function setupVault(dates: PulseSpec[]): Promise<{ obsidianPath: string; repoPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "janus-compact-"));
  const obsidianPath = join(dir, "vault");
  const repoPath = join(dir, "repo");
  const pulseDir = join(obsidianPath, "pulse");
  const repoPulseDir = join(repoPath, "docs", "pulse");
  await mkdir(pulseDir, { recursive: true });
  await mkdir(repoPulseDir, { recursive: true });
  for (const { date, status, withActivity } of dates) {
    const body = withActivity
      ? `## TL;DR\n\n> [!summary]+\n> Día con actividad.\n\n> [!success] Shipped\n> - feature X\n\n> [!quote] Decisions\n> - decidimos Y ^decision-1\n`
      : `## TL;DR\n\n> [!summary]+\n> Boring day.\n`;
    const content = `---\ndate: ${date}\nproject: test-proj\nstatus: ${status}\ncommits: 1\nrisks: 0\nprompt_version: v4\ntags: [pulse, pulse/test-proj]\n---\n\n${body}`;
    await writeFile(join(pulseDir, `${date}-test-proj.md`), content);
    await writeFile(join(repoPulseDir, `${date}-test-proj.md`), content);
  }
  return {
    obsidianPath,
    repoPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

describe("compactIdleStreaks", () => {
  test("compacts 3 consecutive idles into 1 idle-streak pulse", async () => {
    const { obsidianPath, repoPath, cleanup } = await setupVault([
      { date: "2026-05-13", status: "idle" },
      { date: "2026-05-14", status: "idle" },
      { date: "2026-05-15", status: "idle" },
      { date: "2026-05-16", status: "on-track" },
    ]);
    const r = await compactIdleStreaks({ obsidianPath, repoPath, project: "test-proj" });
    expect(r.streaksFound).toBe(1);
    expect(r.streaksWritten).toBe(1);
    expect(r.filesDeleted).toBe(4); // 2 vault + 2 repo
    expect(r.streaks[0]!.days).toBe(3);

    const remaining = await readdir(join(obsidianPath, "pulse"));
    expect(remaining.sort()).toEqual(["2026-05-13-test-proj.md", "2026-05-16-test-proj.md"]);

    const compacted = await readFile(join(obsidianPath, "pulse", "2026-05-13-test-proj.md"), "utf-8");
    expect(compacted).toContain("status: idle-streak");
    expect(compacted).toContain("streak_start: 2026-05-13");
    expect(compacted).toContain("streak_end: 2026-05-15");
    expect(compacted).toContain("streak_days: 3");

    await cleanup();
  });

  test("does not compact single-day idles (minLen=2)", async () => {
    const { obsidianPath, repoPath, cleanup } = await setupVault([
      { date: "2026-05-13", status: "idle" },
      { date: "2026-05-14", status: "on-track" },
      { date: "2026-05-15", status: "idle" },
    ]);
    const r = await compactIdleStreaks({ obsidianPath, repoPath, project: "test-proj" });
    expect(r.streaksFound).toBe(0);
    expect(r.streaksWritten).toBe(0);
    await cleanup();
  });

  test("breaks the streak when there is an active day in the middle", async () => {
    const { obsidianPath, repoPath, cleanup } = await setupVault([
      { date: "2026-05-13", status: "idle" },
      { date: "2026-05-14", status: "idle" },
      { date: "2026-05-15", status: "on-track" },
      { date: "2026-05-16", status: "idle" },
      { date: "2026-05-17", status: "idle" },
    ]);
    const r = await compactIdleStreaks({ obsidianPath, repoPath, project: "test-proj" });
    expect(r.streaksFound).toBe(2);
    expect(r.streaksWritten).toBe(2);
    await cleanup();
  });

  test("breaks the streak when there is a gap of non-contiguous dates", async () => {
    const { obsidianPath, repoPath, cleanup } = await setupVault([
      { date: "2026-05-13", status: "idle" },
      { date: "2026-05-14", status: "idle" },
      { date: "2026-05-16", status: "idle" }, // gap del 15
      { date: "2026-05-17", status: "idle" },
    ]);
    const r = await compactIdleStreaks({ obsidianPath, repoPath, project: "test-proj" });
    expect(r.streaksFound).toBe(2); // 13-14 y 16-17
    await cleanup();
  });

  test("dryRun does not touch files", async () => {
    const { obsidianPath, repoPath, cleanup } = await setupVault([
      { date: "2026-05-13", status: "idle" },
      { date: "2026-05-14", status: "idle" },
    ]);
    const r = await compactIdleStreaks({ obsidianPath, repoPath, project: "test-proj", dryRun: true });
    expect(r.streaksFound).toBe(1);
    expect(r.streaksWritten).toBe(0);
    expect(r.filesDeleted).toBe(0);
    const remaining = await readdir(join(obsidianPath, "pulse"));
    expect(remaining.length).toBe(2);
    await cleanup();
  });

  test("includeBoring=false does NOT compact on-track days without shipped (default)", async () => {
    const { obsidianPath, repoPath, cleanup } = await setupVault([
      { date: "2026-05-13", status: "on-track", withActivity: false }, // boring
      { date: "2026-05-14", status: "on-track", withActivity: false }, // boring
      { date: "2026-05-15", status: "on-track", withActivity: false }, // boring
    ]);
    const r = await compactIdleStreaks({ obsidianPath, repoPath, project: "test-proj" });
    expect(r.streaksFound).toBe(0);
    await cleanup();
  });

  test("includeBoring=true compacts boring days into a quiet-streak", async () => {
    const { obsidianPath, repoPath, cleanup } = await setupVault([
      { date: "2026-05-13", status: "on-track", withActivity: false },
      { date: "2026-05-14", status: "on-track", withActivity: false },
      { date: "2026-05-15", status: "on-track", withActivity: false },
    ]);
    const r = await compactIdleStreaks({ obsidianPath, repoPath, project: "test-proj", includeBoring: true });
    expect(r.streaksFound).toBe(1);
    expect(r.streaks[0]!.kind).toBe("quiet");
    expect(r.streaks[0]!.days).toBe(3);
    const compacted = await readFile(join(obsidianPath, "pulse", "2026-05-13-test-proj.md"), "utf-8");
    expect(compacted).toContain("status: quiet-streak");
    expect(compacted).toContain("Low-signal streak");
    await cleanup();
  });

  test("includeBoring=true merges contiguous idle + boring into a single quiet-streak", async () => {
    const { obsidianPath, repoPath, cleanup } = await setupVault([
      { date: "2026-05-13", status: "idle" },
      { date: "2026-05-14", status: "on-track", withActivity: false }, // boring
      { date: "2026-05-15", status: "idle" },
      { date: "2026-05-16", status: "on-track", withActivity: false }, // boring
    ]);
    const r = await compactIdleStreaks({ obsidianPath, repoPath, project: "test-proj", includeBoring: true });
    expect(r.streaksFound).toBe(1);
    expect(r.streaks[0]!.days).toBe(4);
    expect(r.streaks[0]!.kind).toBe("quiet"); // tiene al menos un boring
    await cleanup();
  });

  test("includeBoring=true respects pulses with real activity (does not compact them)", async () => {
    const { obsidianPath, repoPath, cleanup } = await setupVault([
      { date: "2026-05-13", status: "idle" },
      { date: "2026-05-14", status: "on-track", withActivity: true }, // NO boring → corta el streak
      { date: "2026-05-15", status: "idle" },
      { date: "2026-05-16", status: "idle" },
    ]);
    const r = await compactIdleStreaks({ obsidianPath, repoPath, project: "test-proj", includeBoring: true });
    // 13 solo: 1 día → no compacta. 15-16: 2 días → 1 idle-streak.
    expect(r.streaksFound).toBe(1);
    expect(r.streaks[0]!.start).toBe("2026-05-15");
    expect(r.streaks[0]!.kind).toBe("idle");
    await cleanup();
  });

  test("pulse with risks > 0 is not boring even if on-track without shipped", async () => {
    const { obsidianPath, repoPath, cleanup } = await setupVault([
      { date: "2026-05-13", status: "on-track", withActivity: false },
      { date: "2026-05-14", status: "on-track", withActivity: false },
    ]);
    // Manualmente sobrescribir uno con risks > 0
    const path = join(obsidianPath, "pulse", "2026-05-14-test-proj.md");
    const content = `---\ndate: 2026-05-14\nproject: test-proj\nstatus: on-track\ncommits: 1\nrisks: 2\nprompt_version: v4\ntags: [pulse]\n---\n\n## TL;DR\n\n> [!summary]+\n> Día con risks.\n\n> [!danger] Risks\n> - cosa fea\n`;
    await writeFile(path, content);

    const r = await compactIdleStreaks({ obsidianPath, repoPath, project: "test-proj", includeBoring: true });
    // 13 sin actividad pero solo: 1 día → no compacta. 14 tiene risks → no boring.
    expect(r.streaksFound).toBe(0);
    await cleanup();
  });
});
