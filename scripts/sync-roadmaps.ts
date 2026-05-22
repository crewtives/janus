#!/usr/bin/env bun
/**
 * Sincroniza los _roadmap.md draft con la sección "Vs Roadmap" del pulse no-idle
 * más reciente de cada proyecto. NO toca user-editados (needs_review: false).
 *
 * Uso:
 *   bun run scripts/sync-roadmaps.ts            # todos los proyectos
 *   bun run scripts/sync-roadmaps.ts --dry-run  # preview
 */
import { loadConfig } from "../src/config/loader.ts";
import { syncRoadmapsFromPulses } from "../src/core/sync-roadmaps.ts";

const dryRun = process.argv.includes("--dry-run");
const config = await loadConfig();
const result = await syncRoadmapsFromPulses({ projects: config.projects, dryRun });

for (const d of result.details) {
  const tag = d.status === "synced" ? "✓ synced" : d.status === "user-edited" ? "✗ user-editado (skip)" : d.status === "no-source" ? "—  sin pulse no-idle" : "—  sin Vs Roadmap parseable";
  const src = d.source ? ` ← ${d.source}` : "";
  console.log(`[sync-roadmaps] ${d.project.padEnd(24)} ${tag}${src}`);
}

const tag = dryRun ? " [DRY-RUN]" : "";
console.log(`\n[sync-roadmaps] resumen${tag}: ${result.roadmapsSynced} sincronizados · ${result.roadmapsSkippedUserEdited} skip user-edit · ${result.roadmapsSkippedNoSource} sin source`);
