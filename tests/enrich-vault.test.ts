import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichVault } from "../src/core/enrich.ts";
import type { JanusConfig } from "../src/config/types.ts";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "janus-enrich-"));
  const vault = join(dir, "vault");
  const obsidianPath = join(vault, "Projects", "acme");
  const repoPath = join(dir, "repo");
  await mkdir(join(obsidianPath, "pulse"), { recursive: true });
  await mkdir(repoPath, { recursive: true });
  const config = {
    obsidianVault: vault,
    projects: [{ name: "acme", repoPath, obsidianPath, status: "active" }],
  } as JanusConfig;
  return { obsidianPath, repoPath, config, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("enrichVault — roadmap is never left broken", () => {
  test("writes a PENDIENTE placeholder _roadmap.md when there is no inferring pulse nor repo ROADMAP.md", async () => {
    const { obsidianPath, config, cleanup } = await setup();
    try {
      const res = await enrichVault(config);
      const rdm = join(obsidianPath, "_roadmap.md");
      // Before the fix this returned early and left the file missing, breaking
      // the `![[_roadmap]]` embed in _index.md.
      expect(existsSync(rdm)).toBe(true);
      expect(await readFile(rdm, "utf-8")).toContain("PENDIENTE");
      expect(res.roadmapsWritten).toBe(1);
    } finally {
      await cleanup();
    }
  });

  test("does not touch a user-edited _roadmap.md (needs_review:false)", async () => {
    const { obsidianPath, config, cleanup } = await setup();
    try {
      const rdm = join(obsidianPath, "_roadmap.md");
      const edited = `---\ntype: roadmap\nneeds_review: false\n---\n\n# My real roadmap\n`;
      await writeFile(rdm, edited);
      const res = await enrichVault(config);
      expect(await readFile(rdm, "utf-8")).toBe(edited);
      expect(res.roadmapsWritten).toBe(0);
    } finally {
      await cleanup();
    }
  });
});

describe("enrichVault — _index respects managed_by_janus", () => {
  test("does not overwrite a frozen _index.md (managed_by_janus:false)", async () => {
    const { obsidianPath, config, cleanup } = await setup();
    try {
      const idx = join(obsidianPath, "_index.md");
      const frozen = `---\ntype: project-index\nmanaged_by_janus: false\n---\n\n# my custom dashboard\n`;
      await writeFile(idx, frozen);
      const res = await enrichVault(config);
      expect(await readFile(idx, "utf-8")).toBe(frozen);
      expect(res.indexesWritten).toBe(0);
    } finally {
      await cleanup();
    }
  });

  test("rewrites a managed _index.md by default", async () => {
    const { obsidianPath, config, cleanup } = await setup();
    try {
      const idx = join(obsidianPath, "_index.md");
      await writeFile(idx, `---\nmanaged_by_janus: true\n---\nold content`);
      const res = await enrichVault(config);
      const body = await readFile(idx, "utf-8");
      expect(body).toContain("Current state");
      expect(body).toContain("managed_by_janus: true");
      expect(res.indexesWritten).toBe(1);
    } finally {
      await cleanup();
    }
  });
});
