#!/usr/bin/env bun
/**
 * Compacta runs de pulses "quiet" consecutivos por proyecto.
 *
 * Default: solo idle. Cada run de 2+ días idle → 1 pulse `idle-streak`.
 * Con `--include-boring`: también detecta "boring days" (on-track sin
 * shipped/decisions/risks, típicamente commits de mantenimiento) y los
 * compacta en `quiet-streak`.
 *
 * Uso:
 *   bun run scripts/compact-idles.ts                          # todos, solo idle
 *   bun run scripts/compact-idles.ts --include-boring         # idle + boring
 *   bun run scripts/compact-idles.ts <project>                # solo uno
 *   bun run scripts/compact-idles.ts --dry-run                # preview
 *   bun run scripts/compact-idles.ts <project> --dry-run --include-boring
 */
import { loadConfig } from "../src/config/loader.ts";
import { compactIdleStreaks } from "../src/core/compact-idles.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const includeBoring = args.includes("--include-boring");
const onlyProject = args.find((a) => !a.startsWith("--"));

const config = await loadConfig();

let totalStreaks = 0;
let totalWritten = 0;
let totalDeleted = 0;

for (const project of config.projects) {
  if (onlyProject && project.name !== onlyProject) continue;
  const r = await compactIdleStreaks({
    obsidianPath: project.obsidianPath,
    project: project.name,
    dryRun,
    includeBoring,
  });
  totalStreaks += r.streaksFound;
  totalWritten += r.streaksWritten;
  totalDeleted += r.filesDeleted;

  if (r.streaks.length > 0) {
    console.log(`[compact] ${project.name}: ${r.streaks.length} streak(s)`);
    for (const s of r.streaks) {
      const tag = s.kind === "idle" ? "idle" : "quiet";
      console.log(`  · ${s.start} → ${s.end} (${s.days} días, ${tag})`);
    }
  } else {
    console.log(`[compact] ${project.name}: sin streaks`);
  }
}

const tag = `${dryRun ? " [DRY-RUN]" : ""}${includeBoring ? " [include-boring]" : ""}`;
console.log(`\n[compact] resumen${tag}: ${totalStreaks} streaks encontrados, ${totalWritten} pulses escritos, ${totalDeleted} archivos borrados`);
