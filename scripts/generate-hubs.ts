#!/usr/bin/env bun
/**
 * Genera notas hub por proyecto en la bóveda Obsidian.
 * El hub vive en `${obsidianPath}/${name}.md` y resuelve los wiki-links
 * `[[<project>]]` que cada pulse usa en su sección Related.
 *
 * Idempotente: si el hub ya existe, NO lo sobreescribe.
 *
 * Uso:
 *   bun run scripts/generate-hubs.ts
 *   bun run scripts/generate-hubs.ts --force   # sobreescribe los existentes
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadConfig } from "../src/config/loader.ts";
import type { ProjectConfig } from "../src/config/types.ts";

const FORCE = process.argv.includes("--force");

const config = await loadConfig();

function relativeVaultPath(vaultRoot: string, projectObsidianPath: string): string {
  return projectObsidianPath.startsWith(vaultRoot)
    ? projectObsidianPath.slice(vaultRoot.length).replace(/^\/+/, "")
    : projectObsidianPath;
}

function aliasFor(project: string): string {
  // crewtives-acme-app → acme-app, fly-foo → foo, crewtives-janus → janus
  const parts = project.split("-");
  if (parts.length <= 1) return project;
  return parts.slice(1).join("-");
}

function renderHub(project: ProjectConfig, vaultRelPath: string): string {
  const alias = aliasFor(project.name);
  return `---
type: project-hub
project: ${project.name}
tags: [project-hub]
aliases: ["${alias}"]
---

# ${project.name}

> [!summary]+ Hub del proyecto
> Punto central de navegación. Pulses, roadmap, decisions, risks.

## Documentos

- [[_roadmap|Roadmap]] · [[_index|Dashboard]]
- Strategy: \`STRATEGY.md\`

## Pulses recientes

\`\`\`dataview
TABLE WITHOUT ID file.link AS Pulse, date, status, commits, risks
FROM "${vaultRelPath}/pulse"
WHERE contains(tags, "pulse")
SORT date DESC
LIMIT 14
\`\`\`

## Decisions del último mes

\`\`\`dataview
LIST
FROM "${vaultRelPath}/pulse"
WHERE contains(tags, "pulse") AND date >= date(today) - dur(30 days)
FLATTEN file.outlinks AS link
WHERE contains(string(link), "decision")
LIMIT 20
\`\`\`

## Risks abiertos

\`\`\`dataview
TABLE WITHOUT ID file.link AS Pulse, date, risks
FROM "${vaultRelPath}/pulse"
WHERE contains(tags, "pulse") AND risks > 0
SORT date DESC
LIMIT 10
\`\`\`

## MOCs

- [[Projects MOC]] · [[Decisions MOC]] · [[Risks MOC]] · [[Tracks MOC]] · [[Weekly MOC]]

## Dashboards

- [[Janus Pulse|Vista global]] · [[Open Risks]] · [[Drift]] · [[Inferring]]
`;
}

let created = 0;
let skipped = 0;
for (const project of config.projects) {
  const target = join(project.obsidianPath, `${project.name}.md`);
  if (existsSync(target) && !FORCE) {
    console.log(`[hubs] skip — ${target} ya existe`);
    skipped += 1;
    continue;
  }
  const vaultRelPath = relativeVaultPath(config.obsidianVault, project.obsidianPath);
  const content = renderHub(project, vaultRelPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  console.log(`[hubs] ✓ ${target}`);
  created += 1;
}

console.log(`[hubs] resumen: ${created} creados, ${skipped} skipped (de ${config.projects.length})`);
