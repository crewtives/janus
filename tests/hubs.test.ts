import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateHubs } from "../src/core/scaffold/hubs.ts";
import type { JanusConfig } from "../src/config/types.ts";

describe("generateHubs (Fase 2 R12 / KD3)", () => {
  test("hub gains canonical tags AND keeps its MOC footer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-hubs-"));
    try {
      const vault = join(dir, "vault");
      const obsidianPath = join(vault, "Projects", "acme");
      await mkdir(obsidianPath, { recursive: true });
      const config = {
        obsidianVault: vault,
        projects: [{ name: "acme", repoPath: join(dir, "repo"), obsidianPath, status: "active" }],
      } as JanusConfig;

      const summary = await generateHubs({ config });
      expect(summary.created).toBe(1);

      const hub = await readFile(join(obsidianPath, "acme.md"), "utf-8");
      // R12: additive canonical tags, keeps bare `project-hub` for dashboards (KD1).
      expect(hub).toContain("tags: [project-hub, type/hub, project/acme]");
      // KD3: hubs/indexes remain the MOC graph tier — the footer stays.
      expect(hub).toContain("[[Projects MOC]]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
