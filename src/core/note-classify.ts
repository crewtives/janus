/**
 * Deterministic note classifier (Fase 2 / U2).
 *
 * Maps a vault-relative path (+ its frontmatter) to a canonical short type and,
 * where meaningful, a project id. Drives the de-fuse pass's type-aware
 * transforms (which edges to strip, which tags to add) and the R12/R13 tags.
 *
 * Type is the SHORT canonical name (pulse, hub, spine, …) used in the
 * `type/<type>` tag — not the scalar `type:` field value (`project-hub`, …),
 * which dashboards already key on and which R12 leaves untouched (KD1).
 */
import type { JanusConfig } from "../config/types.ts";
import { relativeVaultPath } from "./vault-path.ts";

export type NoteType =
  | "pulse"
  | "daily"
  | "weekly"
  | "monthly"
  | "spine"
  | "hub"
  | "roadmap"
  | "index"
  | "strategy"
  | "note"
  | "dashboard"
  | "track"
  | "moc"
  | "wrapped"
  | "unknown";

export interface NoteClass {
  type: NoteType;
  /** null for cross-project notes (daily/weekly/monthly/dashboard/moc/track) and un-attributable notes. */
  projectId: string | null;
}

/** Pulse filename: date-prefixed, single or legacy double dash. */
const PULSE_FILE = /^\d{4}-\d{2}-\d{2}--?.+\.md$/;

export function classifyNote(relPath: string, frontmatter: string, config: JanusConfig): NoteClass {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1);
  const fmProject = frontmatter.match(/^project:\s*(.+?)\s*$/m)?.[1] ?? null;

  // Cross-project / global types — no project id (KD9).
  if (relPath.startsWith("Timeline/Daily/") && /^\d{4}-\d{2}-\d{2}\.md$/.test(base)) return { type: "daily", projectId: null };
  if (relPath.startsWith("Timeline/Weekly/") && /-week\.md$/.test(base)) return { type: "weekly", projectId: null };
  if (relPath.startsWith("Timeline/Monthly/") && /-monthly\.md$/.test(base)) return { type: "monthly", projectId: null };
  if (relPath.startsWith("Dashboards/")) return { type: "dashboard", projectId: null };
  if (relPath.startsWith("MOCs/Tracks/")) return { type: "track", projectId: null };
  if (relPath.startsWith("MOCs/")) return { type: "moc", projectId: null };
  // Notes: project rarely derivable — tag type/note now, defer project (KD5).
  if (relPath.startsWith("Notes/")) return { type: "note", projectId: fmProject };

  if (relPath.startsWith("Projects/")) {
    const projectId = fmProject ?? projectIdFromPath(relPath, config) ?? projectIdFromPulseName(base);
    if (base === "_roadmap.md") return { type: "roadmap", projectId };
    if (base === "_index.md") return { type: "index", projectId };
    if (base === "STRATEGY.md") return { type: "strategy", projectId };
    if (/-spine\.md$/.test(base)) return { type: "spine", projectId };
    if (/-wrapped-\d{4}\.md$/.test(base)) return { type: "wrapped", projectId };
    if (PULSE_FILE.test(base)) return { type: "pulse", projectId };
    if (projectId !== null && base === `${projectId}.md`) return { type: "hub", projectId };
    return { type: "unknown", projectId };
  }

  return { type: "unknown", projectId: fmProject };
}

/** Strip the leading date from a pulse filename → the project id (null if not a pulse name). */
function projectIdFromPulseName(base: string): string | null {
  const m = base.match(/^\d{4}-\d{2}-\d{2}--?(.+)\.md$/);
  return m ? m[1]! : null;
}

/**
 * Longest-prefix match of the note's path against each project's vault-relative
 * path. Longest wins so whet subprojects (Projects/crewtives/whet/app) beat any
 * shorter shared prefix.
 */
function projectIdFromPath(relPath: string, config: JanusConfig): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const p of config.projects) {
    const rel = relativeVaultPath(config.obsidianVault, p.obsidianPath);
    if ((relPath === rel || relPath.startsWith(`${rel}/`)) && rel.length > bestLen) {
      best = p.name;
      bestLen = rel.length;
    }
  }
  return best;
}
