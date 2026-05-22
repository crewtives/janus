#!/usr/bin/env bun
/**
 * Repara wiki-links rotos "Día anterior" / "Pulse anterior" en pulses existentes.
 * Para cada pulse cuyo link apunte a un archivo que NO existe, reemplaza por
 * el pulse real inmediato anterior en disco (o por placeholder si no hay).
 *
 * Idempotente: si los links ya están bien, no hace nada.
 *
 * Uso:
 *   bun run scripts/fix-broken-links.ts                # todos los proyectos
 *   bun run scripts/fix-broken-links.ts <project>      # uno
 *   bun run scripts/fix-broken-links.ts --dry-run      # preview
 */
import { loadConfig } from "../src/config/loader.ts";
import { fixBrokenPreviousLinks } from "../src/core/fix-links.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyProject = args.find((a) => !a.startsWith("--"));

const config = await loadConfig();

let totalBroken = 0;
let totalFixed = 0;
let totalProjects = 0;

for (const project of config.projects) {
  if (onlyProject && project.name !== onlyProject) continue;
  const r = await fixBrokenPreviousLinks({
    obsidianPath: project.obsidianPath,
    repoPath: project.repoPath,
    project: project.name,
    dryRun,
  });
  totalProjects += 1;
  totalBroken += r.brokenLinksRemoved;
  totalFixed += r.pulsesFixed;
  if (r.brokenLinksRemoved > 0) {
    console.log(`[fix-links] ${project.name}: ${r.brokenLinksRemoved} links rotos · ${r.pulsesFixed} archivos arreglados`);
    for (const d of r.details.slice(0, 5)) {
      console.log(`  · ${d.pulse}: [[${d.from}]] → ${d.to === "(none)" ? "(sin anterior)" : `[[${d.to}]]`}`);
    }
    if (r.details.length > 5) console.log(`  ... y ${r.details.length - 5} más`);
  } else {
    console.log(`[fix-links] ${project.name}: sin links rotos`);
  }
}

const tag = dryRun ? " [DRY-RUN]" : "";
console.log(`\n[fix-links] resumen${tag}: ${totalBroken} links rotos en ${totalFixed} archivos (de ${totalProjects} proyectos)`);
