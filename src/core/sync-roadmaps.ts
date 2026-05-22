import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PLACEHOLDER_ROADMAP_MARKER = "Editá este archivo con los hitos";

export interface SyncResult {
  projectsScanned: number;
  roadmapsSynced: number;
  roadmapsSkippedUserEdited: number;
  roadmapsSkippedNoSource: number;
  details: Array<{ project: string; status: "synced" | "user-edited" | "no-source" | "no-vs-roadmap"; source?: string }>;
}

interface VsRoadmap {
  completed: string[];
  inProgress: string[];
  expected: string[];
  outOfRoadmap: string[];
}

/**
 * Para cada proyecto con _roadmap.md como draft (needs_review: true) o placeholder,
 * busca el pulse no-idle más reciente y extrae su sección "Vs Roadmap".
 * Si la encuentra, regenera el _roadmap.md materializando:
 *   - "Hecho": items ✅ Completado
 *   - "Hitos activos": 🚧 En curso + ⏸️ Esperado
 *   - "Backlog cercano": ❓ Fuera de roadmap (cosas detectadas que valen la pena trackear)
 *
 * Mantiene `needs_review: true` para que el usuario revise.
 * NO toca user-editados.
 */
export async function syncRoadmapsFromPulses(opts: {
  projects: Array<{ name: string; obsidianPath: string }>;
  dryRun?: boolean;
}): Promise<SyncResult> {
  const result: SyncResult = {
    projectsScanned: 0,
    roadmapsSynced: 0,
    roadmapsSkippedUserEdited: 0,
    roadmapsSkippedNoSource: 0,
    details: [],
  };

  for (const project of opts.projects) {
    result.projectsScanned += 1;
    const rdmPath = join(project.obsidianPath, "_roadmap.md");
    const existing = existsSync(rdmPath) ? await readFile(rdmPath, "utf-8") : "";

    const isDraft = /^needs_review:\s*true$/m.test(existing) || existing.includes(PLACEHOLDER_ROADMAP_MARKER);
    if (!isDraft && existing.length > 0) {
      result.roadmapsSkippedUserEdited += 1;
      result.details.push({ project: project.name, status: "user-edited" });
      continue;
    }

    const source = await findLatestNonIdlePulse(project.obsidianPath, project.name);
    if (!source) {
      result.roadmapsSkippedNoSource += 1;
      result.details.push({ project: project.name, status: "no-source" });
      continue;
    }

    const vs = extractVsRoadmap(source.content);
    if (!vs || (vs.completed.length === 0 && vs.inProgress.length === 0 && vs.expected.length === 0)) {
      result.details.push({ project: project.name, status: "no-vs-roadmap", source: source.filename });
      continue;
    }

    const newContent = renderRoadmap({ project: project.name, source: source.filename, vs });
    if (!opts.dryRun) {
      await writeFile(rdmPath, newContent);
    }
    result.roadmapsSynced += 1;
    result.details.push({ project: project.name, status: "synced", source: source.filename });
  }

  return result;
}

async function findLatestNonIdlePulse(
  obsidianPath: string,
  project: string,
): Promise<{ filename: string; content: string } | null> {
  const dir = join(obsidianPath, "pulse");
  if (!existsSync(dir)) return null;
  const entries = (await readdir(dir))
    .filter((n) => n.endsWith(".md") && n.endsWith(`-${project}.md`))
    .sort()
    .reverse();
  for (const name of entries) {
    const content = await readFile(join(dir, name), "utf-8");
    const m = content.match(/^status:\s*(.+)$/m);
    const status = m?.[1]?.trim() ?? "";
    if (status === "idle" || status === "idle-streak") continue;
    return { filename: name.replace(/\.md$/, ""), content };
  }
  return null;
}

function extractVsRoadmap(content: string): VsRoadmap | null {
  // Buscar el callout `> [!check] Vs Roadmap`
  const startIdx = content.search(/^>\s*\[!check\][^\n]*Vs Roadmap/im);
  if (startIdx === -1) return null;
  const lines = content.slice(startIdx).split("\n");
  const calloutLines: string[] = [];
  for (const line of lines) {
    if (!line.startsWith(">")) break;
    calloutLines.push(line.replace(/^>\s?/, ""));
  }
  const text = calloutLines.join("\n");

  const completed: string[] = [];
  const inProgress: string[] = [];
  const expected: string[] = [];
  const outOfRoadmap: string[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("-")) continue;
    const m = line.match(/^-\s*([^\s]+)\s+(?:Completado|En curso|Esperado y sin tocar|Fuera de roadmap)\s*:?\s*(.+)$/i)
      ?? line.match(/^-\s*([✅🚧⏸️❓])\s*(?:Completado|En curso|Esperado y sin tocar|Fuera de roadmap)\s*:?\s*(.+)$/i)
      ?? line.match(/^-\s*([^\s:]+)\s*:?\s*(.+)$/i);
    if (!m) continue;
    const emoji = (m[1] ?? "").trim();
    const item = (m[2] ?? "").trim().replace(/\*+/g, "").trim();
    if (!item) continue;
    if (emoji.includes("✅")) completed.push(item);
    else if (emoji.includes("🚧")) inProgress.push(item);
    else if (emoji.includes("⏸")) expected.push(item);
    else if (emoji.includes("❓")) outOfRoadmap.push(item);
  }

  if (completed.length + inProgress.length + expected.length + outOfRoadmap.length === 0) {
    return null;
  }
  return { completed, inProgress, expected, outOfRoadmap };
}

function renderRoadmap(opts: { project: string; source: string; vs: VsRoadmap }): string {
  const { vs, project, source } = opts;
  const renderList = (items: string[], prefix: string, fallback = "(sin items)") =>
    items.length > 0 ? items.map((i) => `${prefix}${i}`).join("\n") : `- ${fallback}`;

  const activeItems: string[] = [
    ...vs.inProgress.map((i) => `- [ ] 🚧 ${i}`),
    ...vs.expected.map((i) => `- [ ] ⏸️ ${i}`),
  ];
  const activeBlock = activeItems.length > 0 ? activeItems.join("\n") : "- (sin items)";

  return `---
type: roadmap
project: ${project}
generated_at: ${new Date().toISOString()}
source: pulse-sync
needs_review: true
---

# Roadmap — ${project}

> [!warning] DRAFT sincronizado desde pulse \`${source}\`
> Este roadmap fue derivado del callout "Vs Roadmap" del pulse más reciente con actividad. Revisalo, ajustá hitos/prioridades, y cuando esté listo dejá \`needs_review: false\` en el frontmatter. Los pulses futuros van a respetar el contenido editado.

## Hitos activos esta semana

${activeBlock}

## Backlog cercano (detectado fuera de roadmap declarado)

${renderList(vs.outOfRoadmap, "- [ ] ❓ ")}

## Hecho

${renderList(vs.completed, "- [x] ✅ ")}

## Notas

- Sincronizado el ${new Date().toISOString().slice(0, 10)} desde [[${source}|${source}]].
- "Hitos activos" combina 🚧 "En curso" y ⏸️ "Esperado y sin tocar" del pulse.
- "Backlog cercano" lista commits/cambios detectados fuera del roadmap previo — candidatos a formalizar o descartar.
- Para que Janus vuelva a sincronizar después de editar, dejá \`needs_review: true\`.
`;
}
