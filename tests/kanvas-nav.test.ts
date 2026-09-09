import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JanusConfig } from "../src/config/types.ts";
import { enrichVault } from "../src/core/enrich.ts";
import { generateDashboards } from "../src/core/scaffold/dashboards.ts";
import { generateHubs } from "../src/core/scaffold/hubs.ts";
import { generateMocs } from "../src/core/scaffold/mocs.ts";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "janus-kanvas-nav-"));
  const vault = join(dir, "vault");
  const obsidianPath = join(vault, "Projects", "acme");
  const repoPath = join(dir, "repo");
  await mkdir(join(obsidianPath, "pulse"), { recursive: true });
  await mkdir(repoPath, { recursive: true });
  const config = {
    obsidianVault: vault,
    projects: [{ name: "acme", repoPath, obsidianPath, status: "active" }],
  } as JanusConfig;
  return { vault, obsidianPath, config, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("Kanvas inbound navigation", () => {
  test("the regenerated project index links the board", async () => {
    const { obsidianPath, config, cleanup } = await setup();
    try {
      await enrichVault(config);
      const index = await readFile(join(obsidianPath, "_index.md"), "utf-8");
      // The enrich pass rewrites _index.md on every run, so this is the only
      // link that reaches a vault that was scaffolded before the board existed.
      expect(index).toContain("[[Kanvas]]");
    } finally {
      await cleanup();
    }
  });

  test("a hub generated into a fresh vault links the board", async () => {
    const { obsidianPath, config, cleanup } = await setup();
    try {
      const res = await generateHubs({ config });
      expect(res.created).toBe(1);
      const hub = await readFile(join(obsidianPath, "acme.md"), "utf-8");
      expect(hub).toContain("[[Kanvas]]");
    } finally {
      await cleanup();
    }
  });

  test("an existing hub is skipped, so it never gains the link", async () => {
    const { obsidianPath, config, cleanup } = await setup();
    try {
      const hubPath = join(obsidianPath, "acme.md");
      const existing = "---\ntype: project-hub\nproject: acme\n---\n\n# acme\n\n- [[Janus Pulse|Vista global]] · [[Open Risks]]\n";
      await writeFile(hubPath, existing);
      const res = await generateHubs({ config });
      // create-or-skip: the generator leaves the file byte-identical. The board
      // is not reachable from an existing hub, only from the project index.
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
      expect(await readFile(hubPath, "utf-8")).toBe(existing);
    } finally {
      await cleanup();
    }
  });

  test("MOCs generated into a fresh vault link the board", async () => {
    const { vault, config, cleanup } = await setup();
    try {
      await generateMocs({ config });
      const moc = await readFile(join(vault, "MOCs", "Projects MOC.md"), "utf-8");
      expect(moc).toContain("[[Kanvas]]");
    } finally {
      await cleanup();
    }
  });

  test("the dashboards generator links the board but does not own its file", async () => {
    const { vault, config, cleanup } = await setup();
    try {
      const res = await generateDashboards({ config });
      const dashboards = join(vault, "Dashboards");
      expect(await readFile(join(dashboards, "Janus Pulse.md"), "utf-8")).toContain("[[Kanvas]]");
      expect(await readFile(join(dashboards, "Open Risks.md"), "utf-8")).toContain("[[Kanvas]]");
      // The board is regenerated wholesale by its own writer. If it ever joins
      // this create-or-skip file list it would freeze at its first version.
      expect(existsSync(join(dashboards, "Kanvas.md"))).toBe(false);
      expect(res.total).toBe(4);
    } finally {
      await cleanup();
    }
  });
});
