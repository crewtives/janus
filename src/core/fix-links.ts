import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface LinkFixResult {
  projectsScanned: number;
  pulsesScanned: number;
  pulsesFixed: number;
  brokenLinksRemoved: number;
  fixedLinks: number;
  details: Array<{ pulse: string; from: string; to: string }>;
}

interface PulseFile {
  filename: string; // sin .md
  filePath: string;
  date: string;
  content: string;
  /** Si es un idle-streak, rango de fechas que cubre. */
  streakStart: string | null;
  streakEnd: string | null;
}

// Cualquier wiki-link a un pulse YYYY-MM-DD-<project>, con o sin alias.
const ANY_PULSE_LINK_RE = /\[\[(\d{4}-\d{2}-\d{2}-[a-z][a-z0-9-]+)(\|[^\]]+)?\]\]/g;

/**
 * Higiene de cross-references inline rotos en el body de cada pulse.
 *
 * Desde Fase 2 (R10) esta función YA NO reescribe la línea de date-chain
 * `- Pulse anterior: [[…]]` — ese edge se eliminó del grafo y la cronología
 * vive en `prev:`/`next:` del frontmatter (ver `scaffold/fix-related.ts`).
 * Lo que queda es reparar wiki-links inline (callouts de Risks/Decisions) que
 * apuntan a un pulse inexistente: se redirigen al streak que cubre esa fecha,
 * o se degradan a texto plano para no perder la mención.
 *
 * Tolera duplicados del mismo archivo (writePulse del orchestrator escribe en
 * vault + docs/pulse del repo).
 */
export async function fixBrokenPreviousLinks(opts: {
  obsidianPath: string;
  repoPath?: string;
  project: string;
  dryRun?: boolean;
}): Promise<LinkFixResult> {
  const result: LinkFixResult = {
    projectsScanned: 1,
    pulsesScanned: 0,
    pulsesFixed: 0,
    brokenLinksRemoved: 0,
    fixedLinks: 0,
    details: [],
  };

  const vaultPulses = await readProjectPulses(opts.obsidianPath, opts.project);
  const repoPulses = opts.repoPath ? await readProjectPulses(join(opts.repoPath, "docs"), opts.project) : [];

  // Set de filenames que SÍ existen en el vault — lo usamos para validar links.
  const existingFilenames = new Set(vaultPulses.map((p) => p.filename));

  result.pulsesScanned = vaultPulses.length;

  const allPulses = [...vaultPulses, ...repoPulses];

  // Mapa: cualquier fecha → filename del pulse que la cubre (incluyendo streaks).
  const dateToFilename = new Map<string, string>();
  for (const p of vaultPulses) {
    if (p.streakStart && p.streakEnd) {
      for (const d of datesBetween(p.streakStart, p.streakEnd)) {
        dateToFilename.set(d, p.filename);
      }
    } else {
      dateToFilename.set(p.date, p.filename);
    }
  }

  for (const pulse of allPulses) {
    let newContent = pulse.content;

    // Arreglar cross-references inline en el body
    // (callouts de Risks/Decisions con [[YYYY-MM-DD-project|fecha]]).
    newContent = newContent.replace(ANY_PULSE_LINK_RE, (match, targetFilename: string, alias: string | undefined) => {
      if (existingFilenames.has(targetFilename)) return match; // link válido
      const dateMatch = targetFilename.match(/^(\d{4}-\d{2}-\d{2})-/);
      const originalDate = dateMatch?.[1] ?? "?";
      const aliasText = alias ? alias.slice(1) : originalDate;
      // ¿Hay un streak que cubra esa fecha?
      const streakOwner = dateToFilename.get(originalDate);
      result.brokenLinksRemoved += 1;
      if (streakOwner && streakOwner !== targetFilename) {
        result.fixedLinks += 1;
        result.details.push({ pulse: pulse.filename, from: targetFilename, to: streakOwner });
        return `[[${streakOwner}|${aliasText}]]`;
      }
      // No hay reemplazo: dejar como texto plano para no perder la mención.
      result.details.push({ pulse: pulse.filename, from: targetFilename, to: "(plain text)" });
      return aliasText;
    });

    if (newContent === pulse.content) continue;
    if (!opts.dryRun) {
      await writeFile(pulse.filePath, newContent);
    }
    result.pulsesFixed += 1;
  }

  return result;
}

function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  for (let d = s; d <= e; d.setDate(d.getDate() + 1)) {
    out.push(formatDate(d));
  }
  return out;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function readProjectPulses(rootPath: string, project: string): Promise<PulseFile[]> {
  const dir = join(rootPath, "pulse");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: PulseFile[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
    if (!m || m[2] !== project) continue;
    const filePath = join(dir, name);
    const content = await readFile(filePath, "utf-8");
    const streakStart = content.match(/^streak_start:\s*(\S+)$/m)?.[1] ?? null;
    const streakEnd = content.match(/^streak_end:\s*(\S+)$/m)?.[1] ?? null;
    out.push({
      filename: name.replace(/\.md$/, ""),
      filePath,
      date: m[1]!,
      content,
      streakStart,
      streakEnd,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
