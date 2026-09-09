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
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JanusConfig } from "../config/types.ts";
import { Checkpoint } from "./checkpoint.ts";
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

// ─── Blocked lane and model assembly ────────────────────────────────────────

/**
 * The lane is deliberately cross-project. Every row the weekly rollup writes
 * carries one non-project sentinel key, because the weekly is itself
 * cross-project and names the project inline in the blocker prose. Partitioning
 * by project would therefore discard every existing row; labelling the lane for
 * what the data actually is costs nothing and claims nothing false.
 */
export type BlockerSourceOutcome = "ok" | "no-weekly-in-window" | "unreachable";

export interface BlockedEntry {
  /** The blocker hash. Project-free, because the rows are. */
  id: string;
  text: string;
  /** Weekly end date, not a wall-clock observation. */
  lastSeen: string;
  weeklyCount: number;
}

export interface BoardModel {
  today: string;
  cards: BoardCard[];
  projects: ProjectState[];
  blocked: BlockedEntry[];
  blockedOutcome: BlockerSourceOutcome;
  /** True when any input failed, so the renderer can refuse to claim complete counts. */
  partial: boolean;
  /** Blocker rows outside the window — reported, never folded into the card counts. */
  declined: number;
}

/** Four weekly periods. Below two the lane would flicker empty between rollups. */
const DEFAULT_WINDOW_DAYS = 28;

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function readBlocked(
  stateDir: string | undefined,
  today: string,
  windowDays: number,
): { entries: BlockedEntry[]; outcome: BlockerSourceOutcome; declined: number } {
  // Opening a missing state dir would silently create an empty database, so the
  // file has to be checked before the handle is opened — there is no error to catch.
  if (!stateDir || !existsSync(join(stateDir, "state.db"))) {
    return { entries: [], outcome: "unreachable", declined: 0 };
  }
  const cutoff = daysBefore(today, windowDays);
  const cp = Checkpoint.open(stateDir);
  try {
    const rows = cp.listBlockerHistory();
    const inWindow = rows.filter((r) => r.lastSeen >= cutoff);
    // `weekly_count` only advances when a later weekly restates a blocker in
    // identical normalized text, so in practice every row sits at one. Ordering
    // by it would be ordering by a constant; the hash tie-break is what makes
    // the render byte-stable across a database reopen.
    inWindow.sort((a, b) =>
      a.lastSeen === b.lastSeen ? a.blockerHash.localeCompare(b.blockerHash) : b.lastSeen.localeCompare(a.lastSeen),
    );
    const entries = inWindow.map((r) => ({
      id: r.blockerHash,
      text: r.sampleText,
      lastSeen: r.lastSeen,
      weeklyCount: r.weeklyCount,
    }));
    return {
      entries,
      outcome: entries.length === 0 ? "no-weekly-in-window" : "ok",
      declined: rows.length - inWindow.length,
    };
  } finally {
    cp.close();
  }
}

/**
 * Build the whole board model. Deterministic: `today` is injected, never read
 * from the clock, so the recency window and the rendered bytes are reproducible.
 */
export async function buildBoardModel(opts: {
  config: JanusConfig;
  today: string;
  windowDays?: number;
}): Promise<BoardModel> {
  const { cards, projects } = await collectProjectCards({ config: opts.config });
  const blocked = readBlocked(opts.config.stateDir, opts.today, opts.windowDays ?? DEFAULT_WINDOW_DAYS);
  const partial = projects.some((p) => p.outcome === "unreadable") || blocked.outcome === "unreachable";
  return {
    today: opts.today,
    cards,
    projects,
    blocked: blocked.entries,
    blockedOutcome: blocked.outcome,
    partial,
    declined: blocked.declined,
  };
}

// ─── Renderer and guarded write ─────────────────────────────────────────────

/** Twelve per column. Beyond that the board stops being readable at a glance. */
const COLUMN_CAP = 12;

/** Suffix, not a dot prefix: a crash leftover stays visible to the user in
 *  Obsidian instead of hidden, and it matches neither `Dashboards/ **\/*.md`
 *  nor any `.md` filter. Matches the only temp-then-rename precedent in the repo. */
const TEMP_SUFFIX = ".janus.tmp";

const COLUMN_LABEL: Record<Column, string> = {
  now: "Now",
  next: "Next",
  blocked: "Blocked",
  done: "Done",
};

export interface RenderResult {
  markdown: string;
  rendered: number;
  summarized: number;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

/**
 * Pure function of the model — no clock, no filesystem. That is what makes the
 * byte-stability contract testable without touching a vault.
 */
export function renderBoard(model: BoardModel): RenderResult {
  const byColumn = new Map<Column, BoardCard[]>();
  for (const col of COLUMNS) byColumn.set(col, []);
  for (const card of model.cards) byColumn.get(card.column)!.push(card);

  const shown = new Map<Column, BoardCard[]>();
  const overflow = new Map<Column, number>();
  let rendered = 0;
  let summarized = 0;
  for (const col of COLUMNS) {
    const all = byColumn.get(col)!;
    shown.set(col, all.slice(0, COLUMN_CAP));
    const extra = Math.max(0, all.length - COLUMN_CAP);
    overflow.set(col, extra);
    rendered += Math.min(all.length, COLUMN_CAP);
    summarized += extra;
  }

  const failed = model.projects.filter((p) => p.outcome === "unreadable").map((p) => p.project);
  const noSource = model.projects.filter((p) => p.outcome === "no-source").map((p) => p.project);

  const fm = [
    "---",
    "type: dashboard",
    "tags: [type/dashboard]",
    "managed_by_janus: true",
    `generated_at: ${model.today}`,
    `expected_projects: ${model.projects.length}`,
    `failed_projects: [${failed.join(", ")}]`,
    "---",
  ];

  const out: string[] = [...fm, "", "# Kanvas", ""];

  if (model.partial) {
    out.push(
      "> [!warning] Partial run — the counts below are unknown, not zero.",
      `> Could not read: ${failed.length > 0 ? failed.join(", ") : "the blocker source"}.`,
      "",
    );
  }

  const rows = Math.max(...COLUMNS.map((c) => shown.get(c)!.length), 0);
  out.push(`| ${COLUMNS.map((c) => COLUMN_LABEL[c]).join(" | ")} |`);
  out.push(`| ${COLUMNS.map(() => "---").join(" | ")} |`);
  for (let i = 0; i < rows; i++) {
    const cells = COLUMNS.map((c) => {
      const card = shown.get(c)![i];
      if (!card) return "";
      const mark = card.provenance === "inferred" ? " _(inferred)_" : "";
      return `${escapeCell(card.title)} — ${card.project}${mark}`;
    });
    out.push(`| ${cells.join(" | ")} |`);
  }
  if (rows === 0) out.push("| | | | |");
  out.push("");

  for (const col of COLUMNS) {
    const extra = overflow.get(col)!;
    if (extra > 0) out.push(`_${extra} more in ${COLUMN_LABEL[col]}._`);
  }
  if ([...overflow.values()].some((n) => n > 0)) out.push("");

  out.push("## Blocked — cross-project", "");
  if (model.blockedOutcome === "unreachable") {
    out.push("State database unreachable, so this lane is **unknown**, not empty.", "");
  } else if (model.blockedOutcome === "no-weekly-in-window") {
    out.push(
      "No weekly rollup recorded inside the window, so this lane is **unknown**, not empty.",
      "",
    );
  } else {
    out.push(
      "What a weekly last reported, cross-project by construction. Each line carries the date it was last reported, not verified current state.",
      "",
    );
    for (const b of model.blocked) {
      out.push(`- ${escapeCell(b.text)} — last reported ${b.lastSeen}`);
    }
    out.push("");
  }

  if (noSource.length > 0) {
    out.push("## No card source", "");
    for (const p of noSource) {
      out.push(`- ${p} — no roadmap mirror with work items yet.`);
    }
    out.push("");
  }

  if (failed.length > 0) {
    out.push("## Could not read", "");
    for (const p of failed) out.push(`- ${p}`);
    out.push("");
  }

  out.push(
    "Janus regenerates this file on every run. To take it over, set `managed_by_janus` to false in the frontmatter above; to hand it back, delete the file and the next run recreates it.",
    "",
  );

  return { markdown: out.join("\n"), rendered, summarized };
}

export type WriteOutcome = "written" | "unchanged" | "frozen" | "not-ours" | "degenerate" | "invalid";

export interface WriteResult {
  outcome: WriteOutcome;
  path: string;
  detail: string;
  rendered: number;
  summarized: number;
  declined: number;
}

/** The spine writer's four checks, returning rather than throwing so the caller
 *  can report which guard fired. */
export function validateBoard(md: string): string | null {
  if (md.length === 0) return "renderer returned empty text";
  if (!md.startsWith("---\n")) return "does not start with frontmatter";
  const fm = md.match(/^---\n[\s\S]*?\n---\n/);
  if (!fm) return "frontmatter does not close";
  if (md.slice(fm[0].length).trim().length < 100) return "body is too short to be a board";
  return null;
}

function isDegenerate(model: BoardModel): boolean {
  const definite = model.projects.filter((p) => p.outcome !== "unreadable");
  return model.cards.length === 0 || definite.length === 0;
}

/**
 * Five guards, in a pinned order: frozen, not-ours, degenerate, invalid,
 * unchanged. Every refusal is named in the result — the vault is not a git repo
 * and there is no backup, so refusing to write is the only recoverable outcome.
 */
export async function writeBoard(opts: {
  model: BoardModel;
  vaultPath: string;
  allowEmpty?: boolean;
  dryRun?: boolean;
}): Promise<WriteResult> {
  const path = boardPath(opts.vaultPath);
  const { markdown, rendered, summarized } = renderBoard(opts.model);
  const base = { path, rendered, summarized, declined: opts.model.declined };
  const existing = existsSync(path) ? await Bun.file(path).text() : null;

  if (existing !== null) {
    const flags = readFreezeFlags(existing);
    if (flags.managed === false || flags.needsReview === false) {
      const key = flags.managed === false ? "managed_by_janus" : "needs_review";
      return {
        ...base,
        outcome: "frozen",
        detail: `frozen by \`${key}: false\` — delete the file to hand it back to Janus`,
      };
    }
    // Positive ownership: anything without the key in a closed fence — including
    // a file with no frontmatter at all — is someone else's and is never
    // overwritten, by any flag.
    if (flags.managed !== true) {
      return { ...base, outcome: "not-ours", detail: "existing file is not managed by Janus — rename or delete it" };
    }
  }

  if (existing !== null && isDegenerate(opts.model) && !opts.allowEmpty) {
    return { ...base, outcome: "degenerate", detail: "model is empty — refusing to wipe the board (--allow-empty overrides)" };
  }

  const invalid = validateBoard(markdown);
  if (invalid) return { ...base, outcome: "invalid", detail: `refusing to write: ${invalid}` };

  if (existing === markdown) return { ...base, outcome: "unchanged", detail: "already up to date" };

  if (opts.dryRun) return { ...base, outcome: "written", detail: "dry-run — nothing written" };

  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}${TEMP_SUFFIX}`;
  await Bun.write(tmp, markdown);
  await rename(tmp, path);
  return { ...base, outcome: "written", detail: "board written" };
}
