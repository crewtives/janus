import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Checkpoint, TrackStatus } from "./checkpoint.ts";

/**
 * Maps the weekly's free-text "Status at close" (e.g. "completado — sin
 * STRATEGY.md formal", "on-track — blocker puntual en X", "con blockers — …")
 * to the `track_lineage` enum. Reads only the label before the first dash/colon
 * separator, so a gloss like "on-track — falta completar X" is not misread as
 * completed. Anything not clearly completed/archived stays `open`. Without this,
 * the prose was persisted verbatim and `detectOpenTrackLoops` (which matches
 * `status === "open"`) never fired — open-loop detection was dead in production.
 */
export function normalizeTrackStatus(raw: string | undefined): TrackStatus {
  const head = (raw ?? "")
    .split(/[—–:]|--| - /)[0]!            // status label before any gloss
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")    // strip emoji/punctuation
    .trim();
  if (head === "archived" || /^(archiv|abandon|descartad|dropped|wontfix)/.test(head)) return "archived";
  if (head === "completed" || /^(complet|done|shipped|cerrad|closed|finished|resuelto|entregad)/.test(head)) return "completed";
  return "open";
}

export interface TrackSpec {
  emoji: string;
  name: string;
  slug: string;
  projects: string[];
  body: string;
  status: string;
}

export interface MaterializeResult {
  tracksFound: number;
  tracksWritten: number;
  trackFiles: string[];
}

/**
 * Parses the "## Dominant tracks" block (legacy: "Tracks dominantes") from
 * the weekly rollup and returns one track per `### <emoji> <name>` heading.
 * Tolerates variations:
 * - optional emoji
 * - bullets in any order
 */
export function parseTracks(weeklyMarkdown: string): TrackSpec[] {
  const lines = weeklyMarkdown.split("\n");
  const isTracksHeader = (l: string) => /^##\s+(Tracks dominantes|Dominant tracks)/i.test(l);
  const tracksHeaderIdx = lines.findIndex(isTracksHeader);
  if (tracksHeaderIdx === -1) return [];

  const tracks: TrackSpec[] = [];
  let i = tracksHeaderIdx + 1;
  while (i < lines.length) {
    const line = lines[i]!;
    // next h2 → end of the tracks block
    if (/^##\s+/.test(line) && !isTracksHeader(line)) break;

    const h3Match = line.match(/^###\s+(\S+)?\s*(.+?)\s*$/);
    if (h3Match) {
      const emoji = (h3Match[1] && /^[^a-zA-Z0-9]/.test(h3Match[1])) ? h3Match[1] : "";
      const name = emoji ? (h3Match[2] ?? "").trim() : `${h3Match[1] ?? ""} ${h3Match[2] ?? ""}`.trim();

      // capture bullets until the next h3 or h2
      const bodyLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j]!;
        if (/^###?\s+/.test(next)) break;
        bodyLines.push(next);
        j += 1;
      }
      const body = bodyLines.join("\n").trim();
      if (name && body) {
        tracks.push({
          emoji,
          name,
          slug: slugify(name),
          projects: extractProjects(body),
          status: extractField(body, "Status at close") || extractField(body, "Estado al cierre") || "—",
          body,
        });
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return tracks;
}

function extractProjects(body: string): string[] {
  const m = body.match(/^-\s*\*\*(?:Projects|Proyectos)\*\*:\s*(.+)$/im);
  if (!m) return [];
  // Capture wiki-links [[...]] or plain comma-separated names
  const text = m[1] ?? "";
  const wikiLinks = [...text.matchAll(/\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g)].map((x) => x[1]!);
  if (wikiLinks.length > 0) return wikiLinks;
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

function extractField(body: string, label: string): string {
  const re = new RegExp(`^-\\s*\\*\\*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*:\\s*(.+)$`, "im");
  const m = body.match(re);
  return m?.[1]?.trim() ?? "";
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * For each track parsed from the weekly, writes (idempotently) a note at
 * `<vault>/MOCs/Tracks/<slug>.md`. If the note already exists, appends the
 * mention of the new weekly (does not overwrite manual content).
 */
export async function materializeTracks(opts: {
  vaultPath: string;
  weeklyFilename: string; // ej. "2026-05-19-week"
  weeklyMarkdown: string;
}): Promise<MaterializeResult> {
  const tracks = parseTracks(opts.weeklyMarkdown);
  const tracksDir = join(opts.vaultPath, "MOCs", "Tracks");
  await mkdir(tracksDir, { recursive: true });

  const written: string[] = [];
  for (const t of tracks) {
    const filePath = join(tracksDir, `${t.slug}.md`);
    if (existsSync(filePath)) {
      // Append a mention of the new weekly if not already there.
      const existing = await readFile(filePath, "utf-8");
      const mention = `[[${opts.weeklyFilename}|${opts.weeklyFilename}]]`;
      if (existing.includes(mention)) continue;
      const updated = appendWeeklyMention(existing, mention, t);
      await writeFile(filePath, updated);
      written.push(filePath);
      continue;
    }

    const content = renderTrackNote(t, opts.weeklyFilename);
    await writeFile(filePath, content);
    written.push(filePath);
  }

  return { tracksFound: tracks.length, tracksWritten: written.length, trackFiles: written };
}

/**
 * Phase 1C — records parsed tracks into `track_lineage`. The date is
 * derived from the weekly/monthly filename (format: `YYYY-MM-DD-week` or
 * `YYYY-MM-monthly`). Idempotent: if the track already has
 * `last_mentioned` >= the derived date, the count is not duplicated.
 *
 * Call from the weekly/monthly flow AFTER materializeTracks().
 */
export function recordTrackLineage(opts: {
  checkpoint: Checkpoint;
  tracks: TrackSpec[];
  /** Filename sin extensión: `2026-05-19-week` o `2026-05-monthly`. */
  sourceFilename: string;
}): { recorded: number } {
  const date = dateFromSourceFilename(opts.sourceFilename);
  if (!date) return { recorded: 0 };
  let recorded = 0;
  for (const t of opts.tracks) {
    const project = t.projects[0] ?? "_cross-project_";
    // Record once per (slug, project) — if the track lists multiple
    // projects, record one entry per project.
    const status = normalizeTrackStatus(t.status);
    if (t.projects.length === 0) {
      opts.checkpoint.recordTrackMention({ slug: t.slug, project, date, status });
      recorded += 1;
      continue;
    }
    for (const p of t.projects) {
      opts.checkpoint.recordTrackMention({ slug: t.slug, project: p, date, status });
      recorded += 1;
    }
  }
  return { recorded };
}

/** Derives YYYY-MM-DD from a filename. weekly: `2026-05-19-week` → "2026-05-19". monthly: `2026-05-monthly` → "2026-05-01" (first day of the month). */
export function dateFromSourceFilename(filename: string): string | null {
  const weeklyM = filename.match(/^(\d{4}-\d{2}-\d{2})-week$/);
  if (weeklyM) return weeklyM[1]!;
  const monthlyM = filename.match(/^(\d{4}-\d{2})-monthly$/);
  if (monthlyM) return `${monthlyM[1]!}-01`;
  const quarterlyM = filename.match(/^(\d{4})-Q([1-4])$/);
  if (quarterlyM) {
    const y = quarterlyM[1]!;
    const q = parseInt(quarterlyM[2]!, 10);
    const month = String((q - 1) * 3 + 1).padStart(2, "0");
    return `${y}-${month}-01`;
  }
  const yearlyM = filename.match(/^(\d{4})-yearly$/);
  if (yearlyM) return `${yearlyM[1]!}-01-01`;
  return null;
}

function renderTrackNote(t: TrackSpec, weeklyFilename: string): string {
  const projectsList = t.projects.length > 0
    ? t.projects.map((p) => `- [[${p}]]`).join("\n")
    : "- (no projects identified)";

  return `---
type: track
name: ${JSON.stringify(t.name)}
status: ${JSON.stringify(t.status)}
projects: [${t.projects.map((p) => JSON.stringify(p)).join(", ")}]
tags: [track]
aliases: [${JSON.stringify(t.name)}]
---

# ${t.emoji ? `${t.emoji} ` : ""}${t.name}

> [!info]+ Cross-project track
> Materialized from [[${weeklyFilename}|${weeklyFilename}]].

## Projects involved

${projectsList}

## Status at close of last weekly

${t.status || "(no status recorded)"}

## Weekly mention history

- [[${weeklyFilename}|${weeklyFilename}]]

## Notes

(Space for manual notes about the track. Janus does not overwrite this section — it only appends weekly mentions to the list above.)
`;
}

function appendWeeklyMention(existing: string, mention: string, t: TrackSpec): string {
  // Insert the bullet in the "Weekly mention history" section.
  const lines = existing.split("\n");
  const isHistoryHeader = (l: string) =>
    /^##\s+(Weekly mention history|Historia de menciones en weeklies)/i.test(l);
  const sectionIdx = lines.findIndex(isHistoryHeader);
  if (sectionIdx === -1) {
    // Section doesn't exist — append at the end.
    return existing + `\n\n## Weekly mention history\n\n- ${mention}\n`;
  }
  // Insert after the first blank line following the heading
  let insertAt = sectionIdx + 1;
  while (insertAt < lines.length && lines[insertAt]!.trim() === "") insertAt += 1;
  lines.splice(insertAt, 0, `- ${mention}`);
  // And update status if a different one came in
  if (t.status) {
    const statusIdx = lines.findIndex((l) => /^##\s+(Status at close|Estado al cierre)/i.test(l));
    if (statusIdx !== -1) {
      let bodyIdx = statusIdx + 1;
      while (bodyIdx < lines.length && lines[bodyIdx]!.trim() === "") bodyIdx += 1;
      if (bodyIdx < lines.length && !lines[bodyIdx]!.startsWith("#")) {
        lines[bodyIdx] = t.status;
      }
    }
  }
  return lines.join("\n");
}
