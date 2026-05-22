/**
 * "This day, last year" anchors — Phase 2 U8 + U9.
 *
 * U8: lookup en `<vault>/Timeline/Daily/<year-1>-MM-DD.md` para el daily rollup.
 * U9: lookup en `<projectObsidianPath>/pulse/<year-1>-MM-DD-<project>.md` para el per-project pulse.
 *
 * Cuando existe, extrae el TL;DR del callout `> [!summary]` y devuelve la
 * fecha + texto + filename (para wiki-link). No-op cuando no hay archivo
 * (proyecto/vault joven).
 *
 * El callout es PASIVO: no fuerza comparación narrativa — solo da ancla
 * histórica. El prompt decide si el TL;DR de hoy lo menciona.
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { DayLastYearAnchor } from "../template.ts";

/** Resta exactamente 1 año a una fecha YYYY-MM-DD. Devuelve null si invalida. */
export function previousYearDate(today: string): string | null {
  const m = today.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1]!, 10) - 1;
  return `${year}-${m[2]}-${m[3]}`;
}

/**
 * Extrae el TL;DR del callout `> [!summary]` de un pulse markdown.
 * Devuelve el primer párrafo del callout sin los prefix `> ` ni el header.
 * Devuelve null si no hay callout summary.
 */
export function extractTldrFromPulse(content: string): string | null {
  // Buscar primero el callout con `[!summary]`. El caret/plus/dash al final
  // del marcador (`[!summary]+`, `[!summary]-`) son opcionales en Obsidian.
  const lines = content.split("\n");
  let inSummary = false;
  const summaryLines: string[] = [];
  for (const raw of lines) {
    const line = raw;
    if (!inSummary && /^>\s*\[!summary\][+\-]?/i.test(line.trim())) {
      inSummary = true;
      continue;
    }
    if (inSummary) {
      // Las líneas del callout empiezan con `>`. Cuando aparece una línea sin
      // `>` o un nuevo callout, terminó.
      if (!line.startsWith(">")) break;
      if (/^>\s*\[!/i.test(line.trim())) break;
      const stripped = line.replace(/^>\s?/, "").trim();
      if (stripped) summaryLines.push(stripped);
    }
  }
  if (summaryLines.length === 0) return null;
  // Devolver primer "párrafo" (líneas hasta línea vacía); ya filtramos vacías
  // arriba, así que joinear todas.
  return summaryLines.join(" ").trim();
}

/**
 * Carga el ancla del pulse per-project del año pasado (U9). Devuelve null si
 * no existe pulse o no se pudo extraer el TL;DR.
 */
export async function loadDayLastYearAnchor(opts: {
  obsidianPath: string;
  project: string;
  today: string;
}): Promise<DayLastYearAnchor | null> {
  const lastYear = previousYearDate(opts.today);
  if (!lastYear) return null;
  const pulseDir = join(opts.obsidianPath, "pulse");
  const filename = `${lastYear}-${opts.project}`;
  const path = join(pulseDir, `${filename}.md`);
  if (!existsSync(path)) {
    // Buscar también en _archive (los pulses se archivan mensualmente).
    const archived = await findArchivedPulse(opts.obsidianPath, lastYear, opts.project);
    if (!archived) return null;
    const content = await readFile(archived.path, "utf-8");
    const tldr = extractTldrFromPulse(content);
    if (!tldr) return null;
    return { date: lastYear, tldr, pulseFilename: archived.filename };
  }
  const content = await readFile(path, "utf-8");
  const tldr = extractTldrFromPulse(content);
  if (!tldr) return null;
  return { date: lastYear, tldr, pulseFilename: filename };
}

/** Busca el pulse archivado del proyecto en `<obsidianPath>/_archive/<YYYY-MM>/`. */
async function findArchivedPulse(
  obsidianPath: string,
  date: string,
  project: string,
): Promise<{ path: string; filename: string } | null> {
  const archiveDir = join(obsidianPath, "_archive");
  if (!existsSync(archiveDir)) return null;
  const monthDir = join(archiveDir, date.slice(0, 7));
  if (!existsSync(monthDir)) return null;
  try {
    const entries = await readdir(monthDir);
    const filename = `${date}-${project}`;
    const found = entries.find((e) => e === `${filename}.md`);
    if (!found) return null;
    return { path: join(monthDir, found), filename };
  } catch {
    return null;
  }
}

/**
 * Carga el ancla del daily consolidado del año pasado (U8).
 * Lee `<vault>/Timeline/Daily/<lastYear>.md` y extrae el TL;DR.
 */
export async function loadDayLastYearDaily(opts: {
  vaultPath: string;
  today: string;
}): Promise<DayLastYearAnchor | null> {
  const lastYear = previousYearDate(opts.today);
  if (!lastYear) return null;
  const path = join(opts.vaultPath, "Timeline", "Daily", `${lastYear}.md`);
  if (!existsSync(path)) return null;
  const content = await readFile(path, "utf-8");
  const tldr = extractTldrFromPulse(content);
  if (!tldr) return null;
  return { date: lastYear, tldr, pulseFilename: lastYear };
}
