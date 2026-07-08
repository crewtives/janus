#!/usr/bin/env bun
/**
 * Regenera Daily/YYYY-MM-DD.md leyendo TODOS los pulses del filesystem.
 * Útil cuando algunos dailys quedaron incompletos por skips de idempotency
 * durante un backfill.
 *
 * Uso:
 *   bun run scripts/regenerate-dailys.ts            # todas las fechas con pulses
 *   bun run scripts/regenerate-dailys.ts 2026-05-15 # una fecha específica
 */
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { loadConfig } from "../src/config/loader.ts";
import { writeDailyConsolidated } from "../src/core/daily.ts";
import type { ProjectResult } from "../src/core/discord.ts";

const config = await loadConfig();
const targetDate = process.argv[2]; // opcional
const useFallback = process.argv.includes("--fallback");

// Mapa: date -> [{project, contentPreview}]
const datesMap = new Map<string, ProjectResult[]>();

for (const project of config.projects) {
  const pulseDir = join(project.obsidianPath, "pulse");
  let entries: string[];
  try {
    entries = await readdir(pulseDir);
  } catch {
    continue; // sin carpeta pulse → skip
  }
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    // Match YYYY-MM-DD-<project>.md
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
    if (!m) continue;
    const date = m[1]!;
    if (targetDate && date !== targetDate) continue;
    const filePath = join(pulseDir, name);
    const content = await readFile(filePath, "utf-8");
    const result: ProjectResult = {
      project: project.name,
      date,
      status: "ok",
      obsidianPath: filePath,
      contentPreview: content.slice(0, 400),
    };
    const arr = datesMap.get(date) ?? [];
    arr.push(result);
    datesMap.set(date, arr);
  }
}

const dates = [...datesMap.keys()].sort();
console.log(`[regenerate] ${dates.length} fechas encontradas`);
if (dates.length === 0) {
  console.log("[regenerate] nada por regenerar — no hay pulses en la bóveda.");
  process.exit(0);
}

for (const date of dates) {
  const results = datesMap.get(date)!;
  const daily = await writeDailyConsolidated({
    vaultPath: config.obsidianVault,
    date,
    results,
    config: useFallback ? undefined : config,
  });
  if (daily) {
    const tag = daily.llmGenerated ? "[LLM]" : "[fallback]";
    console.log(`[regenerate] ${tag} ${daily.path} (${daily.projectCount} proyectos)`);
  } else {
    console.log(`[regenerate] ${date} sin resultados ok — skip`);
  }
}

console.log(`[regenerate] listo · ${dates.length} dailys regenerados`);
