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
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JanusConfig } from "../config/types.ts";
import { Checkpoint, hasStateDb } from "./checkpoint.ts";
import { readIfExists, roadmapPath } from "./obsidian.ts";
import { relativeVaultPath } from "./vault-path.ts";
import { describeFreeze, readFreezeFlags, readScalar, splitFrontmatter } from "./frontmatter.ts";

export type Column = "now" | "next" | "blocked" | "done";

/** Unrecognized headings land here: visible, never dropped (R8). */
const DEFAULT_COLUMN: Column = "next";

export const COLUMNS: readonly Column[] = ["now", "next", "blocked", "done"];

export type CardProvenance = "reconciled" | "inferred";

export type ProjectOutcome = CardProvenance | "no-mirror" | "unparsed" | "unreadable";

export interface BoardCard {
  /** `<project>/<slug>` — project-scoped, since titles collide across projects. */
  id: string;
  project: string;
  title: string;
  column: Column;
  provenance: CardProvenance;
  /**
   * Where the card's own section lives, when it has one. A card written as a
   * `###` heading under its column carries its rationale in the body, so the
   * canvas can point at it instead of restating a fragment: the ticket is the
   * section, not a copy of it.
   */
  source?: { path: string; anchor: string };
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
  if (/^(active|in progress|doing|current|wip|en curso|en progreso|activo|haciendo|hitos activos)/.test(head)) return "now";
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

const COLUMN_HEADING = /^##\s+(.+?)\s*$/;
const CARD_HEADING = /^###\s+(.+?)\s*$/;

/**
 * Two shapes are cards, and both were needed rather than one replacing the other.
 *
 * A `- [ ]` line under a column heading is the plain shape every project can
 * emit. A `### title` under that same column heading is the enriched shape: it
 * owns a heading, so it can be linked to, and everything under it is the
 * reasoning that made it a card. Without the second, a board cell is a label
 * that leads nowhere and the decision behind the work stays in a file nobody
 * opens from here.
 */
function parseCards(
  body: string,
  project: string,
  provenance: CardProvenance,
  sourcePath: string,
): BoardCard[] {
  const cards: BoardCard[] = [];
  let heading = "";
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const card = line.match(CARD_HEADING);
    if (card) {
      const title = card[1]!;
      cards.push({
        id: `${project}/${slug(title)}`,
        project,
        title,
        column: normalizeColumn(heading),
        provenance,
        source: { path: sourcePath, anchor: title },
      });
      continue;
    }
    const col = line.match(COLUMN_HEADING);
    if (col) {
      heading = col[1]!;
      continue;
    }
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
export function activeBoardProjects(config: JanusConfig): JanusConfig["projects"] {
  return config.projects.filter((p) => (p.status ?? "active") !== "archived");
}

/**
 * Today in LOCAL time. Every caller must inject the same value: the nightly
 * block and `doctor` already derive it locally, so a UTC-derived one would sit
 * a day ahead for part of every evening in a negative offset, changing both
 * `generated_at` and the recency-window cutoff for the same moment.
 */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function collectProjectCards(opts: { config: JanusConfig }): Promise<ProjectCardsResult> {
  const cards: BoardCard[] = [];
  const projects: ProjectState[] = [];

  for (const project of activeBoardProjects(opts.config)) {
    const name = project.name;
    try {
      const content = await readIfExists(roadmapPath(project.obsidianPath));
      if (content === null) {
        projects.push({ project: name, outcome: "no-mirror" });
        continue;
      }
      const { frontmatter, body } = splitFrontmatter(content);
      const source = readScalar(frontmatter, "source");
      if (source !== null && /^pending/.test(source)) {
        projects.push({ project: name, outcome: "no-mirror" });
        continue;
      }
      // Provenance answers "who wrote this", which is not what `needs_review`
      // records — that flag means "Janus still refreshes this file", and the
      // roadmap sync stamps it `true` on a repo mirror too. Reading it alone
      // labelled work the user wrote in their own repo as inferred.
      //
      // So: only a pulse-derived mirror is inferred, and only until the user
      // claims it by setting `needs_review: false`. A mirror of a repo file is
      // authored by definition — the repo is the upstream source of truth.
      const { needsReview } = readFreezeFlags(content);
      const guessed = source !== null && /^pulse-/.test(source);
      const provenance: CardProvenance = guessed && needsReview !== false ? "inferred" : "reconciled";
      const parsed = parseCards(body, name, provenance, relativeVaultPath(opts.config.obsidianVault, roadmapPath(project.obsidianPath)));
      if (parsed.length === 0) {
        projects.push({ project: name, outcome: "unparsed" });
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

/**
 * A single project's board, next to its spine and roadmap where someone looking
 * for that project already goes. Written only when explicitly asked for: the
 * nightly run keeps writing the cross-project board and nothing else.
 */
export function projectBoardPath(obsidianPath: string, project: string): string {
  return join(obsidianPath, `${project}-kanvas.md`);
}

// ─── Blocked lane and model assembly ────────────────────────────────────────

/**
 * The lane is deliberately cross-project. Every row the weekly rollup writes
 * carries one non-project sentinel key, because the weekly is itself
 * cross-project and names the project inline in the blocker prose. Partitioning
 * by project would therefore discard every existing row; labelling the lane for
 * what the data actually is costs nothing and claims nothing false.
 */
export type BlockerSourceOutcome = "ok" | "no-rows-in-window" | "unreachable";

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
const WINDOW_DAYS = 28;

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
  if (!hasStateDb(stateDir)) {
    return { entries: [], outcome: "unreachable", declined: 0 };
  }
  const cutoff = daysBefore(today, windowDays);
  const cp = Checkpoint.open(stateDir!);
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
      outcome: entries.length === 0 ? "no-rows-in-window" : "ok",
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
export async function buildBoardModel(opts: { config: JanusConfig; today: string }): Promise<BoardModel> {
  const { cards, projects } = await collectProjectCards({ config: opts.config });
  const blocked = readBlocked(opts.config.stateDir, opts.today, WINDOW_DAYS);
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
export const TEMP_SUFFIX = ".janus.tmp";

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

/** How much of a card title a cell shows before it becomes unscannable. */
const CELL_CHARS = 88;

/**
 * A card title, reduced to a scannable label.
 *
 * Roadmap items are written as full sentences with their rationale — measured on
 * a real vault, the median cell ran 177 characters and the longest 459, which
 * reads as a dense table rather than a board. The full text is not lost: the
 * project's `_roadmap.md` is the source and still carries it.
 *
 * Inline formatting is stripped rather than preserved, because truncating can
 * cut a code span or a bold run in half and leave the marker unbalanced, which
 * corrupts every cell after it in the row.
 */
function cellLabel(title: string): string {
  const plain = title
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
    .replace(/(^|\s)[_*](\S)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= CELL_CHARS) return escapeCell(plain);
  const cut = plain.slice(0, CELL_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${escapeCell((lastSpace > CELL_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd())}…`;
}

/**
 * A cell is a label, so any `_` or `*` left in it is literal text — an
 * identifier like `SIGNUP_URL`, not emphasis. Stripping the backticks that used
 * to protect it turned the underscore into an italics marker that ran until the
 * next one and swallowed the rest of the cell; escaping is what keeps the label
 * readable as written.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*])/g, "\\$1");
}

function escapeCell(text: string): string {
  return escapeMarkdown(text).replace(/\|/g, "\\|");
}

/**
 * Take `cap` cards, one project at a time in rotation, instead of the first
 * `cap` in iteration order.
 *
 * A straight `slice` truncates by config order, so the projects listed last
 * lose every card the moment a column is over the cap — observed live: a
 * newly registered project's cards were invisible on a board that had room,
 * because eight older projects filled the column first. A board whose whole
 * claim is "everything at once" cannot let position in a config file decide
 * who is visible. Relative order inside each project is preserved, so the
 * render stays deterministic.
 */
function fairSlice(cards: BoardCard[], cap: number): BoardCard[] {
  if (cards.length <= cap) return cards;
  const queues = new Map<string, BoardCard[]>();
  for (const c of cards) {
    const q = queues.get(c.project);
    if (q) q.push(c);
    else queues.set(c.project, [c]);
  }
  const out: BoardCard[] = [];
  while (out.length < cap) {
    let took = false;
    for (const q of queues.values()) {
      if (q.length === 0) continue;
      out.push(q.shift()!);
      took = true;
      if (out.length === cap) break;
    }
    if (!took) break;
  }
  return out;
}

/**
 * Pure function of the model — no clock, no filesystem. That is what makes the
 * byte-stability contract testable without touching a vault.
 */
export function renderBoard(model: BoardModel, scope?: string): RenderResult {
  const byColumn = new Map<Column, BoardCard[]>();
  for (const col of COLUMNS) byColumn.set(col, []);
  for (const card of model.cards) byColumn.get(card.column)!.push(card);

  const shown = new Map<Column, BoardCard[]>();
  const overflow = new Map<Column, number>();
  let rendered = 0;
  let summarized = 0;
  for (const col of COLUMNS) {
    const all = byColumn.get(col)!;
    shown.set(col, fairSlice(all, COLUMN_CAP));
    const extra = Math.max(0, all.length - COLUMN_CAP);
    overflow.set(col, extra);
    rendered += Math.min(all.length, COLUMN_CAP);
    summarized += extra;
  }

  const failed = model.projects.filter((p) => p.outcome === "unreadable").map((p) => p.project);
  const noMirror = model.projects.filter((p) => p.outcome === "no-mirror").map((p) => p.project);
  const unparsed = model.projects.filter((p) => p.outcome === "unparsed").map((p) => p.project);

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

  const out: string[] = [...fm, "", scope ? `# Kanvas — ${scope}` : "# Kanvas", ""];

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
      const who = scope ? "" : ` — ${card.project}`;
      return `${cellLabel(card.title)}${who}${mark}`;
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

  if (scope) {
    out.push(
      "The blocked lane is cross-project — every blocker row is recorded without a project — so it lives on the shared board rather than here.",
      "",
    );
  } else {
  out.push("## Blocked — cross-project", "");
  if (model.blockedOutcome === "unreachable") {
    out.push("State database unreachable, so this lane is **unknown**, not empty.", "");
  } else if (model.blockedOutcome === "no-rows-in-window") {
    out.push(
      "No blocker was recorded inside the window, so this lane is **unknown**, not empty. Either nothing was reported as blocking, or no weekly ran — the lane cannot tell those apart.",
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
  }

  if (noMirror.length > 0) {
    out.push("## No roadmap mirror yet", "");
    for (const p of noMirror) out.push(`- ${p}`);
    out.push("");
  }

  if (unparsed.length > 0) {
    out.push("## Roadmap present, no checkbox work items", "");
    out.push(
      "The board reads `- [ ]` lines. These projects have a roadmap, but it carries prose or tables instead — nothing was dropped, there was nothing in that shape to read.",
      "",
    );
    for (const p of unparsed) out.push(`- ${p}`);
    out.push("");
  }

  if (failed.length > 0) {
    out.push("## Could not read", "");
    for (const p of failed) out.push(`- ${p}`);
    out.push("");
  }

  out.push(
    scope
      ? `Written only when you ask for it: \`janus kanvas --project ${scope}\`. The nightly run refreshes the shared board, not this one. To take this file over, set \`managed_by_janus\` to false in the frontmatter above.`
      : "Janus regenerates this file on every run. To take it over, set `managed_by_janus` to false in the frontmatter above; to hand it back, delete the file and the next run recreates it.",
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
  if (!/^managed_by_janus:\s*true\s*$/m.test(fm[0])) return "output lost the managed_by_janus stamp";
  if (!md.includes("# Kanvas")) return "output lost its board heading";
  return null;
}

/** Narrow the model to one project. The blocked lane is dropped: its rows carry no project. */
function scopeModel(model: BoardModel, project: string): BoardModel {
  return {
    ...model,
    cards: model.cards.filter((c) => c.project === project),
    projects: model.projects.filter((p) => p.project === project),
    blocked: [],
  };
}

/** The canvas equivalent of the four spine checks: parseable, ours, and not empty. */
export function validateCanvas(raw: string): string | null {
  if (raw.length === 0) return "renderer returned empty text";
  let parsed: { nodes?: unknown; janusManaged?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return "output is not valid JSON";
  }
  if (!Array.isArray(parsed.nodes)) return "output has no nodes array";
  if (parsed.janusManaged !== true) return "output lost the janusManaged stamp";
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
  /** Render only this project, into its own folder, leaving the shared board alone. */
  scope?: { project: string; obsidianPath: string };
  /** Emit Obsidian's visual board instead of the markdown table. */
  canvas?: boolean;
}): Promise<WriteResult> {
  const base_path = opts.scope
    ? projectBoardPath(opts.scope.obsidianPath, opts.scope.project)
    : boardPath(opts.vaultPath);
  const path = opts.canvas ? canvasPath(base_path) : base_path;
  const model = opts.scope ? scopeModel(opts.model, opts.scope.project) : opts.model;
  const md = renderBoard(model, opts.scope?.project);
  const output = opts.canvas ? renderCanvas(model, opts.scope?.project) : md.markdown;
  // A canvas is an infinite surface, so it draws every card and the column cap
  // never applies. Reporting the markdown counts for a canvas write would
  // describe a file that was not written.
  const rendered = opts.canvas ? model.cards.length : md.rendered;
  const summarized = opts.canvas ? 0 : md.summarized;
  const base = { path, rendered, summarized, declined: opts.model.declined };
  const file = Bun.file(path);
  const existing = (await file.exists()) ? await file.text() : null;

  if (existing !== null && opts.canvas) {
    // JSON carries no frontmatter, so ownership is the top-level key the
    // renderer stamps. Anything else at that path is someone's own canvas.
    if (!canvasIsOurs(existing)) {
      return { ...base, outcome: "not-ours", detail: "existing canvas is not managed by Janus — rename or delete it" };
    }
  } else if (existing !== null) {
    const freeze = describeFreeze(existing);
    if (freeze) return { ...base, outcome: "frozen", detail: freeze.message };
    const flags = readFreezeFlags(existing);
    // Positive ownership: anything without the key in a closed fence — including
    // a file with no frontmatter at all — is someone else's and is never
    // overwritten, by any flag.
    if (flags.managed !== true) {
      return { ...base, outcome: "not-ours", detail: "existing file is not managed by Janus — rename or delete it" };
    }
  }

  if (existing !== null && isDegenerate(model) && !opts.allowEmpty) {
    return { ...base, outcome: "degenerate", detail: "model is empty — refusing to wipe the board (--allow-empty overrides)" };
  }

  const invalid = opts.canvas ? validateCanvas(output) : validateBoard(output);
  if (invalid) return { ...base, outcome: "invalid", detail: `refusing to write: ${invalid}` };

  if (existing === output) return { ...base, outcome: "unchanged", detail: "already up to date" };

  if (opts.dryRun) return { ...base, outcome: "written", detail: "dry-run — nothing written" };

  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}${TEMP_SUFFIX}`;
  await Bun.write(tmp, output);
  await rename(tmp, path);
  return { ...base, outcome: "written", detail: "board written" };
}

// ─── Command-facing orchestration ───────────────────────────────────────────

/** The guards that end in a refusal, as opposed to a write or a no-op. */
const REFUSALS: readonly WriteOutcome[] = ["frozen", "not-ours", "degenerate", "invalid"];

function verdict(result: WriteResult, dryRun: boolean): string {
  if (REFUSALS.includes(result.outcome)) return `refused (${result.outcome}): ${result.detail}`;
  if (result.outcome === "written") return dryRun ? "would write" : "written";
  return result.outcome;
}

/**
 * One line, always. A run that prints nothing when it declines to write is
 * indistinguishable from a crash, and a refusal is only recoverable if the user
 * is told which guard fired.
 */
export function formatKanvasResult(opts: {
  result: WriteResult;
  dryRun: boolean;
  stateDir: string | undefined;
  blockedOutcome: BlockerSourceOutcome;
}): string {
  const { result } = opts;
  const prefix = opts.dryRun ? "dry-run — " : "";
  // The state dir is named on every run because the blocker lane silently reads
  // as empty when the verb runs from a directory whose state.db is elsewhere.
  const state = opts.stateDir ?? "unset";
  const stateNote = opts.blockedOutcome === "unreachable" ? " (no state.db — blocked lane unknown)" : "";
  return (
    `[kanvas] ${prefix}${verdict(result, opts.dryRun)}` +
    ` · rendered ${result.rendered} · summarized ${result.summarized}` +
    // Named as "older" rather than "declined": the count is every blocker row
    // outside the window, so it grows for the life of the database and would
    // otherwise read as an error total.
    ` · ${result.declined} blocker rows older than the window` +
    ` · state ${state}${stateNote} · board ${result.path}`
  );
}

/** Build, write, and describe in one call — what both the verb and the nightly block need. */
export async function runKanvas(opts: {
  config: JanusConfig;
  today: string;
  dryRun?: boolean;
  allowEmpty?: boolean;
  /** Render only this project into its own folder, leaving the shared board alone. */
  project?: string;
  /** Emit Obsidian's visual board instead of the markdown table. */
  canvas?: boolean;
}): Promise<{ result: WriteResult; line: string }> {
  let scope: { project: string; obsidianPath: string } | undefined;
  if (opts.project) {
    const found = opts.config.projects.find((p) => p.name === opts.project);
    if (!found) throw new Error(`Project not found: ${opts.project}`);
    scope = { project: found.name, obsidianPath: found.obsidianPath };
  }
  const model = await buildBoardModel({ config: opts.config, today: opts.today });
  const result = await writeBoard({
    model,
    vaultPath: opts.config.obsidianVault,
    allowEmpty: opts.allowEmpty,
    dryRun: opts.dryRun,
    scope,
    canvas: opts.canvas,
  });
  return {
    result,
    line: formatKanvasResult({
      result,
      dryRun: opts.dryRun ?? false,
      stateDir: opts.config.stateDir,
      blockedOutcome: model.blockedOutcome,
    }),
  };
}

// ─── Canvas renderer ────────────────────────────────────────────────────────

/**
 * The same model as a JSON Canvas 1.0 file — Obsidian's native visual board.
 *
 * Markdown cannot lay out columns: a generated table is the closest it gets, and
 * it reads as a spreadsheet. Canvas is the only format in this vault that draws
 * a board, which is why the plan recorded it as the thing to revisit the moment
 * the board was wanted as a spatial artifact rather than a status page.
 *
 * Two consequences that come with it, both accepted rather than solved:
 * canvas content is not reachable from Obsidian's search, and a `.canvas` is
 * JSON with no frontmatter, so the ownership stamp every other Janus artifact
 * carries has to live in a top-level key instead. The spec allows extra keys and
 * Obsidian preserves them, which is what makes that possible.
 *
 * The generator owns the layout completely. Group containment in this format is
 * geometric, not declared, so a card belongs to a column only because its box
 * sits inside the column's box — moving one without the other silently breaks it.
 */
const CANVAS_COL_W = 420;
const CANVAS_COL_GAP = 40;
const CANVAS_CARD_H = 110;
const CANVAS_CARD_GAP = 16;
const CANVAS_HEADER_H = 60;

/** Preset colours are 1..6 = red, orange, yellow, green, cyan, purple. */
const CANVAS_COLOR: Record<Column, string> = {
  now: "4",
  next: "5",
  blocked: "1",
  done: "3",
};

/** A stable id per card: the canvas is regenerated, so ids must not wander. */
function canvasId(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, "0")}${seed.length.toString(16).padStart(4, "0")}`;
}

export function renderCanvas(model: BoardModel, scope?: string): string {
  const byColumn = new Map<Column, BoardCard[]>();
  for (const col of COLUMNS) byColumn.set(col, []);
  for (const card of model.cards) byColumn.get(card.column)!.push(card);

  const nodes: Array<Record<string, unknown>> = [];
  const tallest = Math.max(1, ...COLUMNS.map((c) => byColumn.get(c)!.length));
  const groupH = CANVAS_HEADER_H + tallest * (CANVAS_CARD_H + CANVAS_CARD_GAP) + CANVAS_CARD_GAP;

  COLUMNS.forEach((col, i) => {
    const x = i * (CANVAS_COL_W + CANVAS_COL_GAP);
    const cards = byColumn.get(col)!;
    nodes.push({
      id: canvasId(`group:${col}`),
      type: "group",
      label: `${COLUMN_LABEL[col]} (${cards.length})`,
      x: x - CANVAS_CARD_GAP,
      y: -CANVAS_HEADER_H,
      width: CANVAS_COL_W + CANVAS_CARD_GAP * 2,
      height: groupH,
    });
    cards.forEach((card, j) => {
      const box = {
        id: canvasId(card.id),
        x,
        y: j * (CANVAS_CARD_H + CANVAS_CARD_GAP),
        width: CANVAS_COL_W,
        height: CANVAS_CARD_H,
        color: CANVAS_COLOR[col],
      };
      if (card.source) {
        // A file node opens the section on click and — unlike a text node —
        // counts for backlinks and is reachable from search. That is what turns
        // a card from a label into the ticket itself.
        nodes.push({
          ...box,
          type: "file",
          file: card.source.path,
          subpath: `#${card.source.anchor}`,
        });
        return;
      }
      const who = scope ? "" : `\n\n— ${card.project}`;
      const mark = card.provenance === "inferred" ? "\n\n_inferred_" : "";
      nodes.push({ ...box, type: "text", text: `${card.title}${who}${mark}` });
    });
  });

  // No frontmatter in JSON, so ownership lives here. The spec allows extra
  // top-level keys and Obsidian preserves them across its own saves.
  const doc = {
    nodes,
    edges: [],
    janusManaged: true,
    janusGeneratedAt: model.today,
    janusScope: scope ?? "all",
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Ownership for a canvas: the JSON key that replaces the frontmatter stamp. */
export function canvasIsOurs(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { janusManaged?: unknown };
    return parsed.janusManaged === true;
  } catch {
    return false;
  }
}

export function canvasPath(target: string): string {
  return target.replace(/\.md$/, ".canvas");
}
