import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveStaleTracks, unarchiveTrack } from "../src/core/track-ttl.ts";

async function setupVault(opts: {
  tracks: Array<{ slug: string; mentions: string[]; mtimeDaysAgo?: number; mtimeDate?: string }>;
  weeklies: string[]; // YYYY-MM-DD list (creará -week.md vacíos)
}): Promise<{ vaultPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "janus-ttl-"));
  const vaultPath = join(dir, "vault");
  const tracksDir = join(vaultPath, "MOCs", "Tracks");
  const weeklyDir = join(vaultPath, "Timeline", "Weekly");
  await mkdir(tracksDir, { recursive: true });
  await mkdir(weeklyDir, { recursive: true });

  for (const w of opts.weeklies) {
    await writeFile(join(weeklyDir, `${w}-week.md`), "weekly content");
  }
  for (const t of opts.tracks) {
    const mentionsBlock = t.mentions.map((d) => `- [[${d}-week|${d}-week]]`).join("\n");
    const content = `---
type: track
name: "${t.slug}"
status: "ok"
projects: ["x"]
tags: [track]
---

# ${t.slug}

## Historia de menciones en weeklies

${mentionsBlock || "(sin menciones)"}
`;
    const filePath = join(tracksDir, `${t.slug}.md`);
    await writeFile(filePath, content);
    // Prefer an absolute mtime so the fixture never drifts against the fixed
    // weekly dates as wall-clock advances (archiveStaleTracks measures mtime
    // against the vault's latest weekly, not `Date.now()`).
    if (typeof t.mtimeDate === "string") {
      const past = new Date(`${t.mtimeDate}T00:00:00`);
      await utimes(filePath, past, past);
    } else if (typeof t.mtimeDaysAgo === "number") {
      const past = new Date(Date.now() - t.mtimeDaysAgo * 86_400_000);
      await utimes(filePath, past, past);
    }
  }
  return { vaultPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("archiveStaleTracks", () => {
  test("archives tracks with last mention older than TTL (4 weeks default)", async () => {
    // weekly más reciente: 2026-05-20. Track A mencionado el 2026-05-15 (5 días = 0 weeks). Track B mencionado el 2026-04-01 (~7 weeks).
    const { vaultPath, cleanup } = await setupVault({
      weeklies: ["2026-05-20", "2026-05-13", "2026-05-06"],
      tracks: [
        { slug: "fresh", mentions: ["2026-05-15"] },
        { slug: "stale", mentions: ["2026-04-01"] },
      ],
    });
    const r = await archiveStaleTracks({ vaultPath, ttlWeeks: 4 });
    expect(r.tracksScanned).toBe(2);
    expect(r.tracksArchived).toBe(1);
    expect(r.archived[0]!.slug).toBe("stale");

    const activeDir = await readdir(join(vaultPath, "MOCs", "Tracks"));
    expect(activeDir).toContain("fresh.md");
    expect(activeDir).toContain("_archive");
    expect(activeDir).not.toContain("stale.md");

    const archived = await readdir(join(vaultPath, "MOCs", "Tracks", "_archive"));
    expect(archived).toContain("stale.md");
    await cleanup();
  });

  test("idempotent: re-running does nothing if there are no new stale", async () => {
    const { vaultPath, cleanup } = await setupVault({
      weeklies: ["2026-05-20"],
      tracks: [{ slug: "ok", mentions: ["2026-05-13"] }],
    });
    const r1 = await archiveStaleTracks({ vaultPath, ttlWeeks: 4 });
    expect(r1.tracksArchived).toBe(0);
    const r2 = await archiveStaleTracks({ vaultPath, ttlWeeks: 4 });
    expect(r2.tracksArchived).toBe(0);
    await cleanup();
  });

  test("dry-run does not move files", async () => {
    const { vaultPath, cleanup } = await setupVault({
      weeklies: ["2026-05-20"],
      tracks: [{ slug: "old", mentions: ["2026-03-01"] }],
    });
    const r = await archiveStaleTracks({ vaultPath, ttlWeeks: 4, dryRun: true });
    expect(r.tracksArchived).toBe(1); // contador
    expect(existsSync(join(vaultPath, "MOCs", "Tracks", "old.md"))).toBe(true);
    expect(existsSync(join(vaultPath, "MOCs", "Tracks", "_archive", "old.md"))).toBe(false);
    await cleanup();
  });

  test("configurable TTL", async () => {
    const { vaultPath, cleanup } = await setupVault({
      weeklies: ["2026-05-20"],
      tracks: [{ slug: "two-weeks-old", mentions: ["2026-05-06"] }], // ~2 weeks
    });
    const r1 = await archiveStaleTracks({ vaultPath, ttlWeeks: 4 });
    expect(r1.tracksArchived).toBe(0);

    // Re-crear porque el primer test podría haber archivado
    const { vaultPath: v2, cleanup: c2 } = await setupVault({
      weeklies: ["2026-05-20"],
      tracks: [{ slug: "two-weeks-old", mentions: ["2026-05-06"] }],
    });
    const r2 = await archiveStaleTracks({ vaultPath: v2, ttlWeeks: 1 });
    expect(r2.tracksArchived).toBe(1);
    await cleanup();
    await c2();
  });

  test("track without mentions in weeklies uses mtime", async () => {
    const { vaultPath, cleanup } = await setupVault({
      weeklies: ["2026-05-20"],
      // Fixed mtime ~11 weeks before the latest weekly (2026-05-20) → well past
      // the 4-week ttl. Absolute (not `Date.now()`-relative) so it stays green.
      tracks: [{ slug: "no-mentions", mentions: [], mtimeDate: "2026-03-01" }],
    });
    const r = await archiveStaleTracks({ vaultPath, ttlWeeks: 4 });
    expect(r.tracksArchived).toBe(1);
    expect(r.archived[0]!.reason).toContain("mtime");
    await cleanup();
  });
});

describe("unarchiveTrack", () => {
  test("moves track from _archive/ back to the active dir", async () => {
    const { vaultPath, cleanup } = await setupVault({
      weeklies: ["2026-05-20"],
      tracks: [{ slug: "old", mentions: ["2026-03-01"] }],
    });
    await archiveStaleTracks({ vaultPath, ttlWeeks: 4 });
    expect(existsSync(join(vaultPath, "MOCs", "Tracks", "_archive", "old.md"))).toBe(true);

    const ok = await unarchiveTrack({ vaultPath, slug: "old" });
    expect(ok).toBe(true);
    expect(existsSync(join(vaultPath, "MOCs", "Tracks", "old.md"))).toBe(true);
    expect(existsSync(join(vaultPath, "MOCs", "Tracks", "_archive", "old.md"))).toBe(false);
    await cleanup();
  });

  test("returns false if the track is not archived", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-ttl-un-"));
    const vaultPath = join(dir, "vault");
    await mkdir(join(vaultPath, "MOCs", "Tracks"), { recursive: true });
    const ok = await unarchiveTrack({ vaultPath, slug: "ghost" });
    expect(ok).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});
