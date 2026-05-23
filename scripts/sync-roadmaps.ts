#!/usr/bin/env bun
/**
 * Empareja los `_roadmap.md` del vault con la mejor fuente disponible por
 * proyecto: `<repo>/ROADMAP.md` (preferente), pulse legacy con bullets, o
 * deja un PENDIENTE explícito si no hay nada. No toca user-editados.
 *
 * Uso:
 *   bun run scripts/sync-roadmaps.ts            # aplica
 *   bun run scripts/sync-roadmaps.ts --dry-run  # preview
 */
import { loadConfig } from "../src/config/loader.ts";
import { syncRoadmaps } from "../src/core/sync-roadmaps.ts";

const dryRun = process.argv.includes("--dry-run");
const config = await loadConfig();
const result = await syncRoadmaps({ projects: config.projects, dryRun });

const labels: Record<string, string> = {
  "synced-from-repo": "✓ mirror del repo",
  "synced-from-pulse": "✓ derivado de pulse",
  "user-edited": "·  user-edited (skip)",
  "pending-no-source": "!  PENDIENTE (sin fuente)",
};

for (const d of result.details) {
  const tag = labels[d.status] ?? d.status;
  const src = d.source ? ` ← ${d.source}` : "";
  console.log(`[sync-roadmaps] ${d.project.padEnd(24)} ${tag}${src}`);
}

const tag = dryRun ? " [DRY-RUN]" : "";
console.log(
  `\n[sync-roadmaps] resumen${tag}: ${result.roadmapsSyncedFromRepo} desde repo · ${result.roadmapsSyncedFromPulse} desde pulse · ${result.roadmapsSkippedUserEdited} user-edit (skip) · ${result.roadmapsPendingNoSource} pendientes`,
);
