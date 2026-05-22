#!/usr/bin/env bun
/**
 * Enriquece los archivos default de cada proyecto en la bóveda Obsidian:
 * - `_index.md`: dashboard con TL;DR embed, métricas, decisiones recientes
 * - `_roadmap.md`: si es placeholder/draft, regenera desde la inferencia del último pulse
 * - `STRATEGY.md`: si no existe, crea template guiado
 *
 * Uso:
 *   bun run scripts/enrich-vault.ts              # todos los proyectos
 *   bun run scripts/enrich-vault.ts <name>       # solo uno
 */
import { loadConfig } from "../src/config/loader.ts";
import { enrichVault } from "../src/core/enrich.ts";

const onlyProject = process.argv[2];
const config = await loadConfig();

const result = await enrichVault(config, { onlyProject });

console.log(
  `[enrich] ${result.projectsProcessed} proyectos procesados · ${result.indexesWritten} _index escritos · ${result.roadmapsWritten} _roadmap regenerados · ${result.strategiesWritten} STRATEGY creados`,
);
