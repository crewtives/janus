#!/usr/bin/env bun
/**
 * Scaffold completo del vault Obsidian: corre los 3 generators en cadena
 * para dejar el grafo conectado sin wiki-links rotos.
 *
 * Genera (idempotente):
 *  1. Hubs por proyecto      (scripts/generate-hubs.ts)
 *  2. MOCs cross-proyecto    (scripts/generate-mocs.ts)
 *  3. Dashboards globales    (scripts/generate-dashboards.ts)
 *
 * Después de un wipe del vault o un `pulse --backfill`, este es el comando
 * para que todos los wiki-links que los pulses generan (`[[<project>]]`,
 * `[[Decisions MOC]]`, `[[Janus Pulse]]`, etc.) resuelvan a archivos reales.
 *
 * Uso:
 *   bun run scripts/scaffold-vault.ts            # idempotente, no toca lo existente
 *   bun run scripts/scaffold-vault.ts --force    # sobreescribe todos
 */
const FORCE = process.argv.includes("--force");
const forceFlag = FORCE ? ["--force"] : [];

async function runScript(name: string): Promise<void> {
  const path = new URL(`./${name}`, import.meta.url).pathname;
  const proc = Bun.spawn(["bun", "run", path, ...forceFlag], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`[scaffold] ${name} falló con exit code ${exitCode}`);
  }
}

console.log(`[scaffold] iniciando vault scaffolding (force=${FORCE})`);
console.log("");

console.log("=== 1/3 · hubs por proyecto ===");
await runScript("generate-hubs.ts");
console.log("");

console.log("=== 2/3 · MOCs cross-proyecto ===");
await runScript("generate-mocs.ts");
console.log("");

console.log("=== 3/4 · Dashboards globales ===");
await runScript("generate-dashboards.ts");
console.log("");

console.log("=== 4/4 · Reparar wiki-links 'Pulse anterior' (idempotente) ===");
await runScript("fix-pulse-anterior-links.ts");
console.log("");

console.log("[scaffold] ✓ vault scaffolding completo");
console.log("");
console.log("Próximos pasos sugeridos:");
console.log("  • bun run bin/janus.ts rollup --week    # weekly + spines + materializa tracks");
console.log("  • abrir Obsidian → Graph view → vas a ver hubs/MOCs/dashboards conectados");
