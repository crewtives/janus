import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Checkpoint } from "../src/core/checkpoint.ts";
import { detectAnniversary, firstPulseDate, getProjectBirthDates } from "../src/core/project-metadata.ts";

let tmpRoot: string;
let cp: Checkpoint;

beforeEach(async () => {
  tmpRoot = join(tmpdir(), `janus-metadata-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(tmpRoot, { recursive: true });
  cp = Checkpoint.openInMemory();
});

afterEach(async () => {
  cp.close();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("project-metadata", () => {
  test("detectAnniversary: same month-day and at least 1 year → returns diff", () => {
    expect(detectAnniversary("2025-05-21", "2026-05-21")).toBe(1);
    expect(detectAnniversary("2024-05-21", "2026-05-21")).toBe(2);
  });

  test("detectAnniversary: same year or future date → null", () => {
    expect(detectAnniversary("2026-05-21", "2026-05-21")).toBeNull();
    expect(detectAnniversary("2026-12-01", "2026-05-21")).toBeNull();
  });

  test("detectAnniversary: different month-day → null", () => {
    expect(detectAnniversary("2025-05-22", "2026-05-21")).toBeNull();
  });

  test("detectAnniversary: birth null → null", () => {
    expect(detectAnniversary(null, "2026-05-21")).toBeNull();
  });

  test("firstPulseDate: reads the oldest date from pulse/", async () => {
    const obsidianPath = join(tmpRoot, "vault", "Projects", "demo");
    const pulseDir = join(obsidianPath, "pulse");
    await mkdir(pulseDir, { recursive: true });
    await writeFile(join(pulseDir, "2026-05-21-demo.md"), "x");
    await writeFile(join(pulseDir, "2026-05-19-demo.md"), "x");
    await writeFile(join(pulseDir, "2026-05-20-demo.md"), "x");
    const first = await firstPulseDate(obsidianPath);
    expect(first).toBe("2026-05-19");
  });

  test("firstPulseDate: considers _archive/", async () => {
    const obsidianPath = join(tmpRoot, "vault", "Projects", "demo");
    const pulseDir = join(obsidianPath, "pulse");
    const archDir = join(obsidianPath, "_archive", "2026-04");
    await mkdir(pulseDir, { recursive: true });
    await mkdir(archDir, { recursive: true });
    await writeFile(join(pulseDir, "2026-05-21-demo.md"), "x");
    await writeFile(join(archDir, "2026-04-15-demo.md"), "x");
    const first = await firstPulseDate(obsidianPath);
    expect(first).toBe("2026-04-15");
  });

  test("firstPulseDate: no pulses → null", async () => {
    const obsidianPath = join(tmpRoot, "vault", "Projects", "demo");
    await mkdir(obsidianPath, { recursive: true });
    expect(await firstPulseDate(obsidianPath)).toBeNull();
  });

  test("getProjectBirthDates: combines git + pulse and caches in checkpoint", async () => {
    const obsidianPath = join(tmpRoot, "vault", "Projects", "demo");
    const pulseDir = join(obsidianPath, "pulse");
    await mkdir(pulseDir, { recursive: true });
    await writeFile(join(pulseDir, "2026-05-19-demo.md"), "x");

    const r = await getProjectBirthDates({
      project: {
        name: "demo",
        repoPath: join(tmpRoot, "no-repo-here"),
        obsidianPath,
      },
      checkpoint: cp,
    });
    expect(r.birthDatePulse).toBe("2026-05-19");
    expect(r.birthDateGit).toBeNull();
    expect(r.earliest).toBe("2026-05-19");

    // Cache hit: si llamamos de nuevo, debería devolver lo cacheado (sin recomputar git).
    const cached = cp.getProjectMetadata("demo");
    expect(cached?.birthDatePulse).toBe("2026-05-19");
  });
});
