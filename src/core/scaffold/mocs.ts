/**
 * Genera Maps of Content (MOCs) en `~/Obsidian/MOCs/`:
 * - Projects MOC, Decisions MOC, Risks MOC, Tracks MOC, Weekly MOC
 *
 * Importable in-process desde el orchestrator. El thin wrapper en
 * `scripts/generate-mocs.ts` mantiene la invocación CLI standalone.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../config/loader.ts";
import type { JanusConfig } from "../../config/types.ts";
import type { ScaffoldSummary } from "./hubs.ts";

export interface GenerateMocsOptions {
  force?: boolean;
  config?: JanusConfig;
}

function hubLinks(config: JanusConfig): string {
  const byOrg = new Map<string, string[]>();
  for (const p of config.projects) {
    const org = p.name.split("-")[0] ?? "misc";
    const arr = byOrg.get(org) ?? [];
    arr.push(`[[${p.name}]]`);
    byOrg.set(org, arr);
  }
  const lines: string[] = [];
  for (const [org, links] of byOrg) {
    lines.push(`- **${org[0]!.toUpperCase()}${org.slice(1)}**: ${links.join(" · ")}`);
  }
  return lines.join("\n");
}

function buildFiles(config: JanusConfig): Array<{ name: string; content: string }> {
  return [
    {
      name: "Projects MOC.md",
      content: `---
type: moc
tags: [moc, moc/projects]
---

# Projects MOC

Hub de todos los proyectos trackeados por Janus.

\`\`\`dataview
TABLE WITHOUT ID file.link AS Hub, project
FROM "Projects"
WHERE type = "project-hub"
SORT project ASC
\`\`\`

## Por organización

${hubLinks(config)}

## Dashboards relacionados

- [[Janus Pulse|Vista global]] · [[Open Risks]] · [[Drift]] · [[Inferring]]

## MOCs relacionados

- [[Decisions MOC]] · [[Risks MOC]] · [[Tracks MOC]] · [[Weekly MOC]]
`,
    },
    {
      name: "Decisions MOC.md",
      content: `---
type: moc
tags: [moc, moc/decisions]
---

# Decisions MOC

Punto central de decisiones del sistema. Dos capas:

1. **ADRs canónicos** (\`Decisions/ADR-NNN-*.md\`) — decisiones arquitecturales o estratégicas promovidas desde pulses. Status: \`proposed\`/\`accepted\`/\`deprecated\`/\`superseded\`.
2. **Decisiones operativas** del día a día — extraídas de pulses recientes (callout \`> [!quote] Decisions\`).

## ADRs por status

\`\`\`dataview
TABLE WITHOUT ID file.link AS ADR, number, status, project, date
FROM "Decisions"
WHERE type = "adr"
SORT number DESC
\`\`\`

## ADRs activos (no deprecated ni superseded)

\`\`\`dataview
LIST WITHOUT ID file.link
FROM "Decisions"
WHERE type = "adr" AND status != "deprecated" AND status != "superseded"
SORT number DESC
\`\`\`

## Decisiones operativas (últimos 30 días)

\`\`\`dataview
TABLE WITHOUT ID file.link AS Pulse, project, date
FROM "Projects"
WHERE contains(tags, "pulse") AND contains(file.outlinks.path, "decision") AND date >= date(today) - dur(30 days)
SORT date DESC
\`\`\`

## Cómo promover una decisión operativa a ADR

Cuando un pulse marca una decisión con \`🏛️ ADR-candidate\`, podés promoverla:

\`\`\`bash
bun janus adr promote --pulse YYYY-MM-DD-<project> --decision decision-N --title "Título canónico"
\`\`\`

El comando crea un nuevo \`Decisions/ADR-NNN-<slug>.md\` con el contexto pre-llenado desde el pulse, y anota el pulse con el link al ADR.

## Dashboards relacionados

- [[Janus Pulse|Vista global]] · [[Open Risks]] · [[Drift]] · [[Inferring]]

## MOCs relacionados

- [[Projects MOC]] · [[Risks MOC]] · [[Weekly MOC]]
`,
    },
    {
      name: "Risks MOC.md",
      content: `---
type: moc
tags: [moc, moc/risks]
---

# Risks MOC

Riesgos abiertos en todos los pulses recientes.

\`\`\`dataview
TABLE WITHOUT ID file.link AS Pulse, project, date, risks
FROM "Projects"
WHERE contains(tags, "pulse") AND risks > 0 AND date >= date(today) - dur(14 days)
SORT risks DESC, date DESC
\`\`\`

## Dashboards relacionados

- [[Janus Pulse|Vista global]] · [[Open Risks]] · [[Drift]] · [[Inferring]]

## MOCs relacionados

- [[Projects MOC]] · [[Decisions MOC]] · [[Weekly MOC]]
`,
    },
    {
      name: "Tracks MOC.md",
      content: `---
type: moc
tags: [moc, moc/tracks]
---

# Tracks MOC

Tracks de trabajo cruzados detectados en weekly rollups.

(Se va poblando manualmente. El weekly rollup identifica tracks; copialos acá como notas hijas linkadas.)

## Dashboards relacionados

- [[Janus Pulse|Vista global]] · [[Open Risks]] · [[Drift]] · [[Inferring]]

## MOCs relacionados

- [[Projects MOC]] · [[Weekly MOC]]
`,
    },
    {
      name: "Weekly MOC.md",
      content: `---
type: moc
tags: [moc, moc/weekly]
---

# Weekly MOC

Índice de weekly rollups + monthly digests.

## Weeklies

\`\`\`dataview
TABLE WITHOUT ID file.link AS Weekly, period_start, period_end, days
FROM "Timeline/Weekly"
WHERE contains(tags, "weekly-rollup")
SORT period_end DESC
\`\`\`

## Monthly digests

\`\`\`dataview
TABLE WITHOUT ID file.link AS Monthly, period_start, period_end, total_pulses
FROM "Timeline/Monthly"
WHERE contains(tags, "monthly")
SORT month DESC
\`\`\`

## Dashboards relacionados

- [[Janus Pulse|Vista global]] · [[Open Risks]] · [[Drift]] · [[Inferring]]

## MOCs relacionados

- [[Projects MOC]] · [[Decisions MOC]] · [[Risks MOC]] · [[Tracks MOC]]
`,
    },
  ];
}

export async function generateMocs(opts: GenerateMocsOptions = {}): Promise<ScaffoldSummary> {
  const config = opts.config ?? (await loadConfig());
  const force = opts.force ?? false;
  const mocsDir = join(config.obsidianVault, "MOCs");
  const files = buildFiles(config);

  await mkdir(mocsDir, { recursive: true });

  let created = 0;
  let skipped = 0;
  for (const file of files) {
    const target = join(mocsDir, file.name);
    if (existsSync(target) && !force) {
      skipped += 1;
      continue;
    }
    await writeFile(target, file.content);
    created += 1;
  }
  return { created, skipped, total: files.length };
}
