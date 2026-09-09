/**
 * Kanvas — the cross-project board.
 *
 * Reads the per-project `_roadmap.md` mirror the roadmap sync already maintains
 * and turns its checkbox lines into cards. The repo stays the upstream source of
 * truth: the mirror is produced *from* it, and aggregating one Janus artifact
 * into another is what the spine and the rollups already do.
 *
 * The mirror was chosen over probing each repo directly on evidence: the repos
 * express work as prose headings and status tables, not checkbox lines, so a
 * repo-side board renders empty. The mirror also already carries the provenance
 * this module would otherwise have to invent — `needs_review` and `source` say
 * whether a roadmap was reconciled against the repo or inferred from a pulse.
 */
import { join } from "node:path";
import type { JanusConfig } from "../config/types.ts";
import { readIfExists, roadmapPath } from "./obsidian.ts";
import { readFreezeFlags, splitFrontmatter } from "./frontmatter.ts";

export type Column = "now" | "next" | "blocked" | "done";

/** Unrecognized headings land here: visible, never dropped (R8). */
const DEFAULT_COLUMN: Column = "next";

export const COLUMNS: readonly Column[] = ["now", "next", "blocked", "done"];

export type CardProvenance = "reconciled" | "inferred";

export type ProjectOutcome = CardProvenance | "no-source" | "unreadable";

export interface BoardCard {
  /** `<project>/<slug>` — project-scoped, since titles collide across projects. */
  id: string;
  project: string;
  title: string;
  column: Column;
  provenance: CardProvenance;
}

export interface ProjectState {
  project: string;
  outcome: ProjectOutcome;
}

export interface ProjectCardsResult {
  cards: BoardCard[];
  projects: ProjectState[];
}

/**
 * Heading text to column. Mirrors `normalizeTrackStatus` in `tracks.ts`: drop any
 * gloss after a separator, lowercase, strip emoji and punctuation, then prefix
 * match. Bilingual on purpose — the mirrors in a real vault carry both languages.
 */
export function normalizeColumn(raw: string | undefined): Column {
  const head = (raw ?? "")
    .split(/[—–:(]|--| - /)[0]!
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim();
  if (/^(blocked|blocker|stuck|waiting|bloquead|trabad|esperando)/.test(head)) return "blocked";
  if (/^(shipped|done|complet|released|closed|cerrad|entregad|termin|hecho)/.test(head)) return "done";
  if (/^(active|in progress|doing|current|wip|en curso|en progreso|activo|haciendo)/.test(head)) return "now";
  if (/^(next|near backlog|backlog|upcoming|planned|later|pr[oó]xim|siguiente|pendiente)/.test(head)) return "next";
  return DEFAULT_COLUMN;
}

const HEADING = /^#{1,6}\s+(.+?)\s*$/;
const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/;

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Read one scalar out of an already-split frontmatter block. */
function readScalar(frontmatter: string, key: string): string | null {
  const m = frontmatter.match(new RegExp(`^${key}:\\s*(\\S.*?)\\s*$`, "m"));
  return m ? m[1]! : null;
}

function parseCards(body: string, project: string, provenance: CardProvenance): BoardCard[] {
  const cards: BoardCard[] = [];
  let heading = "";
  for (const line of body.split("\n")) {
    const h = line.match(HEADING);
    if (h) {
      heading = h[1]!;
      continue;
    }
    const c = line.match(CHECKBOX);
    if (!c) continue;
    const checked = c[1] !== " ";
    const title = c[2]!;
    cards.push({
      id: `${project}/${slug(title)}`,
      project,
      title,
      column: checked ? "done" : normalizeColumn(heading),
      provenance,
    });
  }
  return cards;
}

/**
 * Collect every active project's cards plus its outcome.
 *
 * Each project is wrapped individually and its failure is *classified*, not
 * discarded: the board has to tell "this project has nothing open" apart from
 * "this project could not be read" (R6). One bad mirror costs that project's
 * cards and nothing else.
 */
export async function collectProjectCards(opts: { config: JanusConfig }): Promise<ProjectCardsResult> {
  const cards: BoardCard[] = [];
  const projects: ProjectState[] = [];

  for (const project of opts.config.projects) {
    if ((project.status ?? "active") === "archived") continue;
    const name = project.name;
    try {
      const content = await readIfExists(roadmapPath(project.obsidianPath));
      if (content === null) {
        projects.push({ project: name, outcome: "no-source" });
        continue;
      }
      const { frontmatter, body } = splitFrontmatter(content);
      const source = readScalar(frontmatter, "source");
      if (source !== null && /^pending/.test(source)) {
        projects.push({ project: name, outcome: "no-source" });
        continue;
      }
      const { needsReview } = readFreezeFlags(content);
      const inferredSource = source !== null && /^pulse-inference/.test(source);
      const provenance: CardProvenance = needsReview === false && !inferredSource ? "reconciled" : "inferred";
      const parsed = parseCards(body, name, provenance);
      if (parsed.length === 0) {
        projects.push({ project: name, outcome: "no-source" });
        continue;
      }
      cards.push(...parsed);
      projects.push({ project: name, outcome: provenance });
    } catch {
      // A mirror that exists but cannot be read — a directory at that path, a
      // permission error. Distinct from "no source" so the board can say so.
      projects.push({ project: name, outcome: "unreadable" });
    }
  }

  return { cards, projects };
}

/** Vault-relative location of the board. `Dashboards/` is already graph-filtered. */
export function boardPath(vaultPath: string): string {
  return join(vaultPath, "Dashboards", "Kanvas.md");
}
