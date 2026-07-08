import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { JanusConfig, ProjectConfig } from "../config/types.ts";
import { readIfExists } from "./obsidian.ts";
import { relativeVaultPath } from "./vault-path.ts";

/**
 * Graph-config writer (Fase 1 / U4). Builds and merge-writes
 * `<vault>/.obsidian/graph.json` so the global graph reads as per-project
 * color clusters — one hue per project, subprojects nested under a shared
 * product folder collapsed into one, a bright hub/spine overlay, and
 * Timeline/Dashboards/orphans filtered out. It overwrites only the keys it
 * owns and preserves the user's hand-tuned display values (`scale`,
 * `nodeSizeMultiplier`, `collapse-*`, …).
 *
 * This changes zero note content (R7): it only emits graph configuration.
 */

// Distinct, deterministic hues assigned by config order (Outstanding Question:
// per-project palette). Bright yellow overlay dominates the project color on
// hub/spine notes so each cluster shows one glowing center (R5).
const PALETTE = [
  "e6194b", "3cb44b", "4363d8", "f58231", "911eb4",
  "42d4f4", "f032e6", "bfef45", "469990", "9a6324",
];
const HUB_BRIGHT = "ffe119";

// Force preset (R4/R6): weaker center + stronger repel + longer links spread
// the clusters apart. These four keys are owned; the user's other display
// tuning is preserved by the merge.
const FORCE_PRESET = {
  centerStrength: 0.05,
  repelStrength: 15,
  linkStrength: 0.5,
  linkDistance: 250,
} as const;

interface ColorGroup {
  query: string;
  color: { a: number; rgb: number };
}

export interface GraphConfigResult {
  path: string;
  /** Per-project color groups = the visible clusters (excludes the overlay). */
  projectGroups: number;
  wrote: boolean;
}

function colorObj(hex: string): { a: number; rgb: number } {
  return { a: 1, rgb: parseInt(hex, 16) };
}

/**
 * One `path:` group key per active project. Projects nested under a shared
 * product folder (e.g. `<product>/web`, `<product>/api`, `<product>/mobile`)
 * collapse to that folder, while flat projects stay separate: the key is each
 * project's path truncated to one segment below the root that all active
 * projects share (R4).
 */
export function projectGroupPaths(vaultRoot: string, projects: ProjectConfig[]): string[] {
  const active = projects.filter((p) => p.status !== "archived");
  const segs = active.map((p) => relativeVaultPath(vaultRoot, p.obsidianPath).split("/").filter(Boolean));
  if (segs.length === 0) return [];

  const minDepth = Math.min(...segs.map((s) => s.length));
  const cap = Math.max(0, minDepth - 1); // keep ≥1 distinguishing segment per project
  let commonLen = 0;
  while (commonLen < cap && segs.every((s) => s[commonLen] === segs[0]![commonLen])) {
    commonLen += 1;
  }

  const keys: string[] = [];
  for (const s of segs) {
    const key = s.slice(0, commonLen + 1).join("/");
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Builds the color-group list: one per project cluster, plus the bright overlay. */
export function buildColorGroups(config: JanusConfig): ColorGroup[] {
  const active = config.projects.filter((p) => p.status !== "archived");
  const groupPaths = projectGroupPaths(config.obsidianVault, config.projects);

  const groups: ColorGroup[] = groupPaths.map((gp, i) => ({
    query: `path:"${gp}"`,
    color: colorObj(PALETTE[i % PALETTE.length]!),
  }));

  // Bright hub/spine overlay. Spines match by filename; hubs are path-anchored
  // (`/<id>.md`) so the leading slash excludes the project's pulses
  // (`.../pulse/<date>-<id>.md`, preceded by `-`).
  const hubQueries = active.map((p) => `path:"/${p.name}.md"`);
  const overlayQuery = [`file:"-spine.md"`, ...hubQueries].join(" OR ");

  // Placed LAST so it wins precedence on hub/spine notes: Obsidian applies
  // color groups top-to-bottom and the later match overrides earlier ones.
  // Outstanding Question — confirm visually in Obsidian; if the overlay loses,
  // move this push to an unshift (single-line flip).
  groups.push({ query: overlayQuery, color: colorObj(HUB_BRIGHT) });
  return groups;
}

export async function writeGraphConfig(opts: {
  config: JanusConfig;
  dryRun?: boolean;
}): Promise<GraphConfigResult> {
  const { config } = opts;
  const path = join(config.obsidianVault, ".obsidian", "graph.json");

  // Read-merge the hand-tuned file (KTD3): a blind write would destroy the
  // user's force/display tuning.
  const existing = await readIfExists(path);
  let base: Record<string, unknown> = {};
  if (existing) {
    try {
      base = JSON.parse(existing) as Record<string, unknown>;
    } catch {
      base = {}; // unparseable → fall back to a fresh owned-keys write
    }
  }

  const colorGroups = buildColorGroups(config);
  const projectGroups = colorGroups.length - 1; // minus the overlay

  const merged = {
    ...base,
    colorGroups,
    search: `-path:"Timeline" -path:"Dashboards"`,
    showTags: false,
    showAttachments: false,
    showOrphans: false,
    ...FORCE_PRESET,
  };

  if (opts.dryRun) {
    console.log(`[graph] dry-run — ${projectGroups} project groups + bright overlay; would write ${path}`);
    return { path, projectGroups, wrote: false };
  }

  await mkdir(join(config.obsidianVault, ".obsidian"), { recursive: true });
  await Bun.write(path, JSON.stringify(merged, null, 2));
  return { path, projectGroups, wrote: true };
}
