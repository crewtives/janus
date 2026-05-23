import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PLACEHOLDER_ROADMAP_MARKER = "Editá este archivo con los hitos";

// Source candidates in the repo, in order of preference. The first one that
// exists wins. The repo is the source of truth; the vault `_roadmap.md` is a
// mirror Janus refreshes.
const REPO_ROADMAP_CANDIDATES = [
  "ROADMAP.md",
  "docs/ROADMAP.md",
  "docs/roadmap.md",
  "roadmap.md",
];

export type SyncStatus =
  | "synced-from-repo"
  | "synced-from-pulse"
  | "user-edited"
  | "pending-no-source";

export interface SyncDetail {
  project: string;
  status: SyncStatus;
  source?: string;
}

export interface SyncResult {
  projectsScanned: number;
  roadmapsSyncedFromRepo: number;
  roadmapsSyncedFromPulse: number;
  roadmapsSkippedUserEdited: number;
  roadmapsPendingNoSource: number;
  details: SyncDetail[];
}

interface VsRoadmap {
  completed: string[];
  inProgress: string[];
  expected: string[];
  outOfRoadmap: string[];
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

function findRepoRoadmap(repoPath: string): { absPath: string; relPath: string } | null {
  const root = expandHome(repoPath);
  for (const rel of REPO_ROADMAP_CANDIDATES) {
    const abs = join(root, rel);
    if (existsSync(abs)) return { absPath: abs, relPath: rel };
  }
  return null;
}

/**
 * For each project, refresh its `_roadmap.md` in the Obsidian vault using
 * the best available source:
 *
 *   1. `_roadmap.md` is user-edited (`needs_review: false`) → leave it alone.
 *   2. A `ROADMAP.md` (or `docs/ROADMAP.md`) exists in the project repo →
 *      mirror it into the vault. The repo file is the source of truth.
 *   3. Fallback: parse the latest non-idle pulse's `[!check] Vs Roadmap`
 *      callout if it uses the legacy bullet-with-emoji shape
 *      (✅ Completado, 🚧 En curso, ⏸️ Esperado, ❓ Fuera de roadmap).
 *   4. Nothing usable → write a PENDIENTE placeholder pointing the user at
 *      how to seed a real roadmap.
 *
 * The vault file always carries `needs_review: true` after a sync so the
 * user can mark it as canonical (`false`) and stop further auto-refreshes.
 */
export async function syncRoadmaps(opts: {
  projects: Array<{ name: string; obsidianPath: string; repoPath: string }>;
  dryRun?: boolean;
}): Promise<SyncResult> {
  const result: SyncResult = {
    projectsScanned: 0,
    roadmapsSyncedFromRepo: 0,
    roadmapsSyncedFromPulse: 0,
    roadmapsSkippedUserEdited: 0,
    roadmapsPendingNoSource: 0,
    details: [],
  };

  for (const project of opts.projects) {
    result.projectsScanned += 1;
    const vaultDir = expandHome(project.obsidianPath);
    const rdmPath = join(vaultDir, "_roadmap.md");
    const existing = existsSync(rdmPath) ? await readFile(rdmPath, "utf-8") : "";

    // 1. user-edited → skip
    const isDraft =
      /^needs_review:\s*true$/m.test(existing) || existing.includes(PLACEHOLDER_ROADMAP_MARKER);
    if (!isDraft && existing.length > 0) {
      result.roadmapsSkippedUserEdited += 1;
      result.details.push({ project: project.name, status: "user-edited" });
      continue;
    }

    // 2. repo ROADMAP.md → mirror
    const repoRoadmap = findRepoRoadmap(project.repoPath);
    if (repoRoadmap) {
      const body = await readFile(repoRoadmap.absPath, "utf-8");
      const newContent = renderRoadmapFromRepo({
        project: project.name,
        repoFile: repoRoadmap.relPath,
        repoAbsPath: repoRoadmap.absPath,
        body,
      });
      if (!opts.dryRun) await writeFile(rdmPath, newContent);
      result.roadmapsSyncedFromRepo += 1;
      result.details.push({
        project: project.name,
        status: "synced-from-repo",
        source: repoRoadmap.relPath,
      });
      continue;
    }

    // 3. legacy pulse parser
    const pulseSrc = await findLatestNonIdlePulse(vaultDir, project.name);
    if (pulseSrc) {
      const vs = extractVsRoadmap(pulseSrc.content);
      if (
        vs &&
        vs.completed.length + vs.inProgress.length + vs.expected.length + vs.outOfRoadmap.length > 0
      ) {
        const newContent = renderRoadmapFromPulse({
          project: project.name,
          source: pulseSrc.filename,
          vs,
        });
        if (!opts.dryRun) await writeFile(rdmPath, newContent);
        result.roadmapsSyncedFromPulse += 1;
        result.details.push({
          project: project.name,
          status: "synced-from-pulse",
          source: pulseSrc.filename,
        });
        continue;
      }
    }

    // 4. pending placeholder
    const pendingContent = renderRoadmapPending({
      project: project.name,
      repoPath: project.repoPath,
    });
    if (!opts.dryRun) await writeFile(rdmPath, pendingContent);
    result.roadmapsPendingNoSource += 1;
    result.details.push({ project: project.name, status: "pending-no-source" });
  }

  return result;
}

/** Back-compat alias for callers that imported the old name. */
export const syncRoadmapsFromPulses = syncRoadmaps;

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
    const m =
      line.match(
        /^-\s*([^\s]+)\s+(?:Completado|En curso|Esperado y sin tocar|Fuera de roadmap)\s*:?\s*(.+)$/i,
      ) ??
      line.match(
        /^-\s*([✅🚧⏸️❓])\s*(?:Completado|En curso|Esperado y sin tocar|Fuera de roadmap)\s*:?\s*(.+)$/i,
      ) ??
      line.match(/^-\s*([^\s:]+)\s*:?\s*(.+)$/i);
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

function renderRoadmapFromRepo(opts: {
  project: string;
  repoFile: string;
  repoAbsPath: string;
  body: string;
}): string {
  const date = new Date().toISOString().slice(0, 10);
  return `---
type: roadmap
project: ${opts.project}
source: repo:${opts.repoFile}
synced_at: ${new Date().toISOString()}
needs_review: true
---

# Roadmap — ${opts.project}

> [!info] Mirror del roadmap del repo
> Este archivo está sincronizado desde \`${opts.repoFile}\` (\`${opts.repoAbsPath}\`).
> La fuente de verdad vive en el repo. Janus refresca este mirror cuando corres
> \`sync-roadmaps\`. Si quieres que Janus deje de tocarlo y mantener una versión
> distinta en la bóveda, edítalo y pon \`needs_review: false\`.

${opts.body.trim()}

---

_Sincronizado el ${date} desde \`${opts.repoFile}\`._
`;
}

function renderRoadmapFromPulse(opts: {
  project: string;
  source: string;
  vs: VsRoadmap;
}): string {
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

function renderRoadmapPending(opts: { project: string; repoPath: string }): string {
  const candidates = REPO_ROADMAP_CANDIDATES.map((c) => `  - \`${opts.repoPath}/${c}\``).join("\n");
  return `---
type: roadmap
project: ${opts.project}
source: pending
generated_at: ${new Date().toISOString()}
needs_review: true
---

# Roadmap — ${opts.project}

> [!todo] PENDIENTE — Janus no encontró fuente de roadmap
> Buscó dos cosas y no encontró ninguna:
>
> 1. Un archivo de roadmap en el repo (\`${opts.repoPath}\`). Probó, en orden:
${candidates}
> 2. Un pulse no-idle reciente con un callout \`[!check] Vs Roadmap\` parseable en bullets-con-emoji (✅ 🚧 ⏸️ ❓).
>
> Para que Janus pueda emparejar este proyecto, crea **uno** de los archivos del repo de arriba. La estructura del contenido es libre — Janus lo refleja tal cual en este mirror.

## Mientras tanto

- Los pulses de \`${opts.project}\` seguirán generándose, pero en modo \`inferring\` para la sección "Vs Strategic North Star" hasta que haya un roadmap declarado.
- Si prefieres mantener una versión propia de este archivo en la bóveda sin tocar el repo, edítalo y pon \`needs_review: false\` — Janus dejará de tocarlo.
`;
}
