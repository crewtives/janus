/**
 * Genera los Dashboards globales en `~/Obsidian/Dashboards/`:
 *  - Janus Pulse.md    — vista global cross-proyecto
 *  - Open Risks.md     — pulses con risks > 0
 *  - Drift.md          — pulses con status = "some-drift"
 *  - Inferring.md      — proyectos sin roadmap (status = "inferring")
 *
 * Son notas markdown puras con dataview queries. Linkean desde los hubs,
 * MOCs y `_index.md` de cada proyecto vía `[[Janus Pulse]]`, `[[Open Risks]]`,
 * etc.
 *
 * Importable in-process desde el orchestrator. El thin wrapper en
 * `scripts/generate-dashboards.ts` mantiene la invocación CLI standalone.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../config/loader.ts";
import type { JanusConfig } from "../../config/types.ts";
import type { ScaffoldSummary } from "./hubs.ts";

export interface GenerateDashboardsOptions {
  force?: boolean;
  config?: JanusConfig;
}

const FILES: Array<{ name: string; content: string }> = [
  {
    name: "Janus Pulse.md",
    content: `---
tags: [dashboard, pulse-dashboard]
aliases: [Daily Pulse Dashboard]
---

> [!summary]+ Daily Pulse — vista global
> Agregador de todos los pulses generados por Janus en los últimos días.
> Click en cualquier celda **Pulse** para abrir la nota correspondiente.

## Últimos 7 días

\`\`\`dataview
TABLE WITHOUT ID
  file.link AS Pulse,
  project,
  status,
  commits,
  risks,
  date
FROM "Projects"
WHERE contains(tags, "pulse") AND date >= date(today) - dur(7 days)
SORT date DESC, project ASC
\`\`\`

## Por proyecto (último pulse de cada uno)

\`\`\`dataview
TABLE WITHOUT ID
  project,
  date,
  status,
  commits,
  risks,
  file.link AS Pulse
FROM "Projects"
WHERE contains(tags, "pulse")
GROUP BY project
SORT project ASC
FLATTEN rows.file.link AS pulse_link
LIMIT 1
\`\`\`

## Histograma de status (últimos 14 días)

\`\`\`dataview
TABLE WITHOUT ID
  status,
  length(rows) AS count
FROM "Projects"
WHERE contains(tags, "pulse") AND date >= date(today) - dur(14 days)
GROUP BY status
SORT count DESC
\`\`\`

## Atajos

- [[Open Risks]] — pulses con \`risks > 0\`
- [[Drift]] — pulses con \`status = some-drift\`
- [[Inferring]] — proyectos sin roadmap (status = inferring)

## MOCs relacionados

- [[Projects MOC]] · [[Decisions MOC]] · [[Risks MOC]] · [[Weekly MOC]]
`,
  },
  {
    name: "Open Risks.md",
    content: `---
tags: [dashboard, pulse-dashboard]
---

> [!danger] Pulses con risks o blockers
> Toda nota tagueada \`pulse\` con \`risks > 0\` aparece acá. Vacío = nada urgente.

## Hoy y ayer

\`\`\`dataview
TABLE WITHOUT ID
  file.link AS Pulse,
  project,
  date,
  status,
  risks,
  commits
FROM "Projects"
WHERE contains(tags, "pulse") AND risks > 0 AND date >= date(today) - dur(1 day)
SORT risks DESC, date DESC
\`\`\`

## Última semana

\`\`\`dataview
TABLE WITHOUT ID
  file.link AS Pulse,
  project,
  date,
  status,
  risks
FROM "Projects"
WHERE contains(tags, "pulse") AND risks > 0 AND date >= date(today) - dur(7 days)
SORT date DESC, risks DESC
\`\`\`

## Status \`stuck\` (cualquier fecha reciente)

\`\`\`dataview
TABLE WITHOUT ID
  file.link AS Pulse,
  project,
  date,
  risks
FROM "Projects"
WHERE contains(tags, "pulse") AND status = "stuck" AND date >= date(today) - dur(14 days)
SORT date DESC
\`\`\`

## Atajos

- [[Janus Pulse|Vista global]] · [[Drift]] · [[Inferring]]
`,
  },
  {
    name: "Drift.md",
    content: `---
tags: [dashboard, pulse-dashboard]
---

> [!warning] Drift detectado
> Pulses con status \`some-drift\` — el código se está moviendo en una dirección que no coincide con docs/roadmap.

\`\`\`dataview
TABLE WITHOUT ID
  file.link AS Pulse,
  project,
  date,
  status,
  commits
FROM "Projects"
WHERE contains(tags, "pulse") AND status = "some-drift" AND date >= date(today) - dur(30 days)
SORT date DESC
\`\`\`

## Atajos

- [[Janus Pulse|Vista global]] · [[Open Risks]] · [[Inferring]]
`,
  },
  {
    name: "Inferring.md",
    content: `---
tags: [dashboard, pulse-dashboard]
---

> [!warning] Proyectos sin roadmap declarado
> Janus infiere roadmap desde commits/README/sesiones cuando no hay \`_roadmap.md\` ni \`STRATEGY.md\`. Estos pulses contienen drafts que vale la pena revisar y promover a \`_roadmap.md\` real.

\`\`\`dataview
TABLE WITHOUT ID
  file.link AS Pulse,
  project,
  date,
  commits
FROM "Projects"
WHERE contains(tags, "pulse") AND status = "inferring"
SORT date DESC
\`\`\`

## Sugerencias

Para cualquier proyecto que aparezca acá, abrí el pulse correspondiente, copiá el bloque "📋 Roadmap inferido (DRAFT)" a \`_roadmap.md\` en la carpeta del proyecto, y editalo. Las próximas corridas lo van a respetar.

## Atajos

- [[Janus Pulse|Vista global]] · [[Open Risks]] · [[Drift]]
`,
  },
];

export async function generateDashboards(opts: GenerateDashboardsOptions = {}): Promise<ScaffoldSummary> {
  const config = opts.config ?? (await loadConfig());
  const force = opts.force ?? false;
  const dashboardsDir = join(config.obsidianVault, "Dashboards");

  await mkdir(dashboardsDir, { recursive: true });

  let created = 0;
  let skipped = 0;
  for (const file of FILES) {
    const target = join(dashboardsDir, file.name);
    if (existsSync(target) && !force) {
      skipped += 1;
      continue;
    }
    await writeFile(target, file.content);
    created += 1;
  }
  return { created, skipped, total: FILES.length };
}
