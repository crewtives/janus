import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JanusConfig } from "../src/config/types.ts";
import { writeGraphConfig, projectGroupPaths, buildColorGroups } from "../src/core/graph-config.ts";

const tmps: string[] = [];
afterEach(async () => {
  for (const d of tmps.splice(0)) await rm(d, { recursive: true, force: true });
});

// Synthetic roster exercising the grouping algorithm: flat projects stay
// separate, a nested product folder ("suite" with 3 subprojects) collapses to
// one group, and archived projects are excluded.
const PROJECT_PATHS: Array<[string, string, "active" | "archived"]> = [
  ["myorg-core", "Projects/myorg/core", "active"],
  ["myorg-suite-web", "Projects/myorg/suite/web", "active"],
  ["myorg-suite-api", "Projects/myorg/suite/api", "active"],
  ["myorg-suite-mobile", "Projects/myorg/suite/mobile", "active"],
  ["myorg-portal", "Projects/myorg/portal", "active"],
  ["myorg-dash", "Projects/myorg/dash", "active"],
  ["legacy-alpha", "Projects/legacy/alpha", "archived"],
  ["legacy-beta", "Projects/legacy/beta", "archived"],
];

async function makeConfig(baseGraph?: object): Promise<JanusConfig> {
  const vault = await mkdtemp(join(tmpdir(), "janus-graph-"));
  tmps.push(vault);
  if (baseGraph) {
    await mkdir(join(vault, ".obsidian"), { recursive: true });
    await writeFile(join(vault, ".obsidian", "graph.json"), JSON.stringify(baseGraph, null, 2));
  }
  return {
    obsidianVault: vault,
    projects: PROJECT_PATHS.map(([name, rel, status]) => ({
      name,
      repoPath: `/repos/${name}`,
      obsidianPath: join(vault, rel),
      status,
    })),
    model: "sonnet",
    effort: "xhigh",
  };
}

async function readGraph(config: JanusConfig): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(config.obsidianVault, ".obsidian", "graph.json"), "utf-8"));
}

describe("graph-config — idempotency / merge (execution note: written first)", () => {
  test("second run over its own output is byte-for-byte identical and preserves display keys", async () => {
    const config = await makeConfig({
      scale: 0.0347,
      nodeSizeMultiplier: 0.5147,
      "collapse-filter": true,
      showTags: true, // owned → will be overwritten
      search: "stale", // owned → will be overwritten
    });
    await writeGraphConfig({ config });
    const first = await readFile(join(config.obsidianVault, ".obsidian", "graph.json"), "utf-8");
    await writeGraphConfig({ config });
    const second = await readFile(join(config.obsidianVault, ".obsidian", "graph.json"), "utf-8");
    expect(second).toBe(first); // idempotent for owned keys

    const g = JSON.parse(second) as Record<string, unknown>;
    // Display keys preserved:
    expect(g.scale).toBe(0.0347);
    expect(g.nodeSizeMultiplier).toBe(0.5147);
    expect(g["collapse-filter"]).toBe(true);
  });
});

describe("graph-config — color groups", () => {
  test("one color group per active project; nested product collapses to one; archived excluded", async () => {
    const config = await makeConfig();
    const groups = projectGroupPaths(config.obsidianVault, config.projects);
    expect(groups).toEqual([
      "Projects/myorg/core",
      "Projects/myorg/suite",
      "Projects/myorg/portal",
      "Projects/myorg/dash",
    ]);
    // No archived (legacy) group leaks in.
    expect(groups.some((g) => g.includes("legacy"))).toBe(false);
    // The nested product collapses to exactly one group.
    expect(groups.filter((g) => g.endsWith("/suite"))).toHaveLength(1);
  });

  test("queries use path:\"Projects/…\" derived from each project's vault-relative path", async () => {
    const config = await makeConfig();
    const groups = buildColorGroups(config);
    const projectGroups = groups.slice(0, -1); // last is the overlay
    for (const g of projectGroups) {
      expect(g.query).toMatch(/^path:"Projects\/myorg\/[^"]+"$/);
    }
  });

  test("bright overlay group present, last, targeting spine + hub notes", async () => {
    const config = await makeConfig();
    const groups = buildColorGroups(config);
    const overlay = groups[groups.length - 1]!;
    expect(overlay.color.rgb).toBe(parseInt("ffe119", 16));
    expect(overlay.query).toContain(`file:"-spine.md"`);
    expect(overlay.query).toContain(`path:"/myorg-core.md"`);
    expect(overlay.query).toContain(`path:"/myorg-suite-web.md"`);
    // Overlay is last so it wins precedence on hub/spine notes.
    expect(groups.filter((g) => g.color.rgb === parseInt("ffe119", 16))).toHaveLength(1);
  });
});

describe("graph-config — merge and owned keys", () => {
  test("merge preserves display keys unchanged", async () => {
    const config = await makeConfig({
      scale: 0.01,
      nodeSizeMultiplier: 0.9,
      "collapse-filter": true,
      "collapse-display": true,
      textFadeMultiplier: 3,
    });
    await writeGraphConfig({ config });
    const g = await readGraph(config);
    expect(g.scale).toBe(0.01);
    expect(g.nodeSizeMultiplier).toBe(0.9);
    expect(g["collapse-filter"]).toBe(true);
    expect(g["collapse-display"]).toBe(true);
    expect(g.textFadeMultiplier).toBe(3);
  });

  test("owned keys are overwritten to the new values", async () => {
    const config = await makeConfig({
      search: "old",
      showOrphans: true,
      showTags: true,
      showAttachments: true,
      repelStrength: 1,
      linkDistance: 30,
      centerStrength: 0.9,
      linkStrength: 0,
    });
    await writeGraphConfig({ config });
    const g = await readGraph(config);
    expect(g.search).toBe(
      `-path:"Timeline" -path:"Dashboards" -path:"MOCs/Projects MOC" ` +
        `-path:"MOCs/Decisions MOC" -path:"MOCs/Risks MOC" ` +
        `-path:"MOCs/Tracks MOC" -path:"MOCs/Weekly MOC"`,
    );
    expect(g.showOrphans).toBe(false);
    expect(g.showTags).toBe(false);
    expect(g.showAttachments).toBe(false);
    expect(g.repelStrength).toBe(15);
    expect(g.linkDistance).toBe(250);
    expect(g.centerStrength).toBe(0.05);
    expect(g.linkStrength).toBe(0.5);
  });

  test("no existing file → a valid graph.json is created fresh", async () => {
    const config = await makeConfig(); // no base graph.json
    const res = await writeGraphConfig({ config });
    expect(res.wrote).toBe(true);
    expect(res.projectGroups).toBe(4);
    const g = await readGraph(config);
    expect(Array.isArray(g.colorGroups)).toBe(true);
    expect((g.colorGroups as unknown[]).length).toBe(5); // 4 project + overlay
  });

  test("dryRun writes nothing", async () => {
    const config = await makeConfig();
    const res = await writeGraphConfig({ config, dryRun: true });
    expect(res.wrote).toBe(false);
    expect(existsSync(join(config.obsidianVault, ".obsidian", "graph.json"))).toBe(false);
  });
});
