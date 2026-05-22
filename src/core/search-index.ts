import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Search index over pulses, dailys, monthlies, quarterlies, weeklies, and yearlies.
 * Uses SQLite's native FTS5 (bundled with bun:sqlite).
 *
 * Doc primitive: each markdown file is 1 document. Table:
 *   pulse_docs (
 *     doc_id TEXT PK,        — vault-relative path (stable, idempotent upsert)
 *     project TEXT,           — project if applicable (null for dailys/weeklies/etc.)
 *     date TEXT,              — primary date (YYYY-MM-DD or YYYY-MM-01, etc.)
 *     kind TEXT,              — 'pulse' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'track' | 'index'
 *     status TEXT,            — from frontmatter if present
 *     title TEXT,             — extracted from the first heading
 *     body TEXT               — full content, without frontmatter
 *   );
 *
 *   pulse_fts (FTS5 virtual table) — over title + body
 */

export type DocKind = "pulse" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "track" | "index" | "adr" | "spine";

export interface IndexedDoc {
  docId: string;
  project: string | null;
  date: string;
  kind: DocKind;
  status: string | null;
  title: string;
  body: string;
}

export interface SearchHit {
  docId: string;
  project: string | null;
  date: string;
  kind: DocKind;
  title: string;
  status: string | null;
  /** Snippet with highlights in the style `[…] **match** […]`. */
  snippet: string;
  /** Raw FTS5 BM25 score (lower = more relevant). */
  score: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pulse_docs (
  doc_id   TEXT PRIMARY KEY,
  project  TEXT,
  date     TEXT NOT NULL,
  kind     TEXT NOT NULL,
  status   TEXT,
  title    TEXT,
  body     TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_docs_date ON pulse_docs(date DESC);
CREATE INDEX IF NOT EXISTS idx_docs_project ON pulse_docs(project, date DESC);
CREATE INDEX IF NOT EXISTS idx_docs_kind ON pulse_docs(kind, date DESC);

-- FTS5 virtual table over title + body
CREATE VIRTUAL TABLE IF NOT EXISTS pulse_fts USING fts5(
  doc_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

export class SearchIndex {
  private constructor(private readonly db: Database) {}

  static open(stateDir: string): SearchIndex {
    mkdirSync(stateDir, { recursive: true });
    const dbPath = join(stateDir, "search.db");
    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA);
    return new SearchIndex(db);
  }

  static openInMemory(): SearchIndex {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    return new SearchIndex(db);
  }

  /** Upsert a document (idempotent by docId). */
  upsert(doc: IndexedDoc): void {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO pulse_docs (doc_id, project, date, kind, status, title, body, indexed_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT(doc_id) DO UPDATE SET
             project = excluded.project,
             date = excluded.date,
             kind = excluded.kind,
             status = excluded.status,
             title = excluded.title,
             body = excluded.body,
             indexed_at = excluded.indexed_at`,
        )
        .run(doc.docId, doc.project, doc.date, doc.kind, doc.status, doc.title, doc.body, now);
      // Refresh FTS row: delete old, insert new
      this.db.query(`DELETE FROM pulse_fts WHERE doc_id = ?1`).run(doc.docId);
      this.db.query(`INSERT INTO pulse_fts (doc_id, title, body) VALUES (?1, ?2, ?3)`).run(doc.docId, doc.title, doc.body);
    });
    tx();
  }

  /** Removes a document from the index. */
  remove(docId: string): void {
    const tx = this.db.transaction(() => {
      this.db.query(`DELETE FROM pulse_docs WHERE doc_id = ?1`).run(docId);
      this.db.query(`DELETE FROM pulse_fts WHERE doc_id = ?1`).run(docId);
    });
    tx();
  }

  /**
   * Full-text search with optional filters.
   * `query` uses FTS5 syntax (space = implicit AND, supports `term OR term`, phrase with quotes, etc.).
   */
  search(opts: {
    query: string;
    project?: string;
    kind?: DocKind | DocKind[];
    since?: string;
    until?: string;
    limit?: number;
  }): SearchHit[] {
    const limit = opts.limit ?? 10;
    const sanitized = sanitizeQuery(opts.query);
    if (!sanitized) return [];

    const where: string[] = ["pulse_fts MATCH ?1"];
    const params: Array<string | number> = [sanitized];
    let p = 2;

    if (opts.project) { where.push(`d.project = ?${p++}`); params.push(opts.project); }
    if (opts.kind) {
      const kinds = Array.isArray(opts.kind) ? opts.kind : [opts.kind];
      const placeholders = kinds.map(() => `?${p++}`).join(",");
      where.push(`d.kind IN (${placeholders})`);
      params.push(...kinds);
    }
    if (opts.since) { where.push(`d.date >= ?${p++}`); params.push(opts.since); }
    if (opts.until) { where.push(`d.date <= ?${p++}`); params.push(opts.until); }

    params.push(limit);
    const sql = `
      SELECT d.doc_id AS docId, d.project, d.date, d.kind, d.status, d.title,
             snippet(pulse_fts, 2, '**', '**', '…', 24) AS snippet,
             bm25(pulse_fts) AS score
      FROM pulse_fts
      JOIN pulse_docs d ON d.doc_id = pulse_fts.doc_id
      WHERE ${where.join(" AND ")}
      ORDER BY score
      LIMIT ?${p}
    `;
    const rows = this.db.query(sql).all(...params) as Array<{
      docId: string; project: string | null; date: string; kind: DocKind; status: string | null;
      title: string; snippet: string; score: number;
    }>;
    return rows;
  }

  /** Document count per kind (useful for verification). */
  stats(): Record<DocKind, number> {
    const rows = this.db.query(`SELECT kind, COUNT(*) as n FROM pulse_docs GROUP BY kind`).all() as Array<{ kind: DocKind; n: number }>;
    const out = { pulse: 0, daily: 0, weekly: 0, monthly: 0, quarterly: 0, yearly: 0, track: 0, index: 0, adr: 0, spine: 0 } as Record<DocKind, number>;
    for (const r of rows) out[r.kind] = r.n;
    return out;
  }

  close(): void {
    this.db.close();
  }
}

/** Strips characters problematic for FTS5 without losing useful semantics. */
export function sanitizeQuery(q: string): string {
  // FTS5 allows: " (phrase), * (prefix), () (group), OR/AND/NOT.
  // We drop:
  //   - control chars (0x00-0x1F + 0x7F)
  //   - `\\` (problematic escape)
  //   - `:` breaks with "no such column: <term>" when the query has a literal `:`
  //   - `\u2019` smart quote (macOS auto-replace)
  //
  // We allow uppercase, digits, parentheses, and asterisk — the original
  // regex `[\x00-\x1f\x7f\\]` did not cover `:`, which broke queries with
  // a literal colon (e.g. "Timeline restructure: foo bar").
  // Conservative strategy: any char that is not alphanumeric, whitespace,
  // double quote (phrase), or asterisk (prefix wildcard) is replaced with
  // a space. This preserves useful tokens and removes problematic FTS5
  // operators (`-`, `+`, `:`, `'`, `\\`, smart quotes, control chars).
  return q
    .replace(/[^a-zA-Z0-9\s"*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- on-disk indexing helpers ----

export interface ScanOptions {
  vaultPath: string;
  /** If true, also scans files under `_archive/` subdirectories. Default: true. */
  includeArchive?: boolean;
}

/**
 * Walks the vault and returns ALL documents to index.
 * Maps path → kind by directory convention.
 */
export async function scanVault(opts: ScanOptions): Promise<IndexedDoc[]> {
  const includeArchive = opts.includeArchive ?? true;
  const docs: IndexedDoc[] = [];

  // Pulses individuales + archive
  const projectsRoot = join(opts.vaultPath, "Projects");
  if (existsSync(projectsRoot)) {
    const glob = new Bun.Glob("**/pulse/*.md");
    for await (const rel of glob.scan({ cwd: projectsRoot, absolute: false })) {
      const abs = join(projectsRoot, rel);
      const doc = await parseDoc(abs, opts.vaultPath, "pulse");
      if (doc) docs.push(doc);
    }
    if (includeArchive) {
      const archiveGlob = new Bun.Glob("**/_archive/**/*.md");
      for await (const rel of archiveGlob.scan({ cwd: projectsRoot, absolute: false })) {
        const abs = join(projectsRoot, rel);
        const doc = await parseDoc(abs, opts.vaultPath, "pulse");
        if (doc) docs.push(doc);
      }
    }
    // Hubs and indexes
    const stableGlob = new Bun.Glob("**/{_index,_roadmap,STRATEGY}.md");
    for await (const rel of stableGlob.scan({ cwd: projectsRoot, absolute: false })) {
      const abs = join(projectsRoot, rel);
      const doc = await parseDoc(abs, opts.vaultPath, "index");
      if (doc) docs.push(doc);
    }
    // Project Spines (continuous narrative)
    const spineGlob = new Bun.Glob("**/*-spine.md");
    for await (const rel of spineGlob.scan({ cwd: projectsRoot, absolute: false })) {
      const abs = join(projectsRoot, rel);
      const doc = await parseDoc(abs, opts.vaultPath, "spine");
      if (doc) docs.push(doc);
    }
  }

  // Dailys
  const dailyDir = join(opts.vaultPath, "Daily");
  if (existsSync(dailyDir)) {
    for (const name of await readdir(dailyDir)) {
      if (name.endsWith(".md")) {
        const doc = await parseDoc(join(dailyDir, name), opts.vaultPath, "daily");
        if (doc) docs.push(doc);
      }
    }
  }
  // Weekly
  const weeklyDir = join(opts.vaultPath, "Daily", "Weekly");
  if (existsSync(weeklyDir)) {
    for (const name of await readdir(weeklyDir)) {
      if (name.endsWith(".md")) {
        const doc = await parseDoc(join(weeklyDir, name), opts.vaultPath, "weekly");
        if (doc) docs.push(doc);
      }
    }
  }
  // Monthly
  const monthlyDir = join(opts.vaultPath, "Daily", "Monthly");
  if (existsSync(monthlyDir)) {
    for (const name of await readdir(monthlyDir)) {
      if (name.endsWith(".md")) {
        const doc = await parseDoc(join(monthlyDir, name), opts.vaultPath, "monthly");
        if (doc) docs.push(doc);
      }
    }
  }
  // Quarterly
  const qDir = join(opts.vaultPath, "Daily", "Quarterly");
  if (existsSync(qDir)) {
    for (const name of await readdir(qDir)) {
      if (name.endsWith(".md")) {
        const doc = await parseDoc(join(qDir, name), opts.vaultPath, "quarterly");
        if (doc) docs.push(doc);
      }
    }
  }
  // Yearly
  const yDir = join(opts.vaultPath, "Daily", "Yearly");
  if (existsSync(yDir)) {
    for (const name of await readdir(yDir)) {
      if (name.endsWith(".md")) {
        const doc = await parseDoc(join(yDir, name), opts.vaultPath, "yearly");
        if (doc) docs.push(doc);
      }
    }
  }
  // Tracks
  const tracksDir = join(opts.vaultPath, "MOCs", "Tracks");
  if (existsSync(tracksDir)) {
    for (const name of await readdir(tracksDir)) {
      if (name.endsWith(".md")) {
        const doc = await parseDoc(join(tracksDir, name), opts.vaultPath, "track");
        if (doc) docs.push(doc);
      }
    }
  }
  // ADRs
  const adrDir = join(opts.vaultPath, "Decisions");
  if (existsSync(adrDir)) {
    for (const name of await readdir(adrDir)) {
      if (name.endsWith(".md")) {
        const doc = await parseDoc(join(adrDir, name), opts.vaultPath, "adr");
        if (doc) docs.push(doc);
      }
    }
  }

  return docs;
}

async function parseDoc(absPath: string, vaultPath: string, kind: DocKind): Promise<IndexedDoc | null> {
  const content = await readFile(absPath, "utf-8");
  const docId = absPath.startsWith(vaultPath) ? absPath.slice(vaultPath.length).replace(/^\/+/, "") : absPath;
  const fm = extractFrontmatter(content);
  const body = stripFrontmatter(content);
  const title = extractTitle(body) || basename(absPath, ".md");

  let date = extractDate(fm, basename(absPath, ".md"));
  if (!date) {
    // For tracks/indexes/spines without an intrinsic date, fall back to mtime.
    if (kind === "track" || kind === "index" || kind === "spine") {
      const { statSync } = await import("node:fs");
      const st = statSync(absPath);
      date = st.mtime.toISOString().slice(0, 10);
    } else {
      return null;
    }
  }

  return {
    docId,
    project: fm.project ?? extractProjectFromPath(docId),
    date,
    kind,
    status: fm.status ?? null,
    title,
    body,
  };
}

function extractFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const lm = line.match(/^([a-z_]+):\s*(.+)$/i);
    if (lm) out[lm[1]!] = lm[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

function extractTitle(body: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim() ?? "";
}

function extractDate(fm: Record<string, string>, filename: string): string | null {
  if (fm.date) return fm.date;
  if (fm.period_end) return fm.period_end;
  if (fm.month) return `${fm.month}-01`;
  if (fm.year) return `${fm.year}-01-01`;
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1]!;
  const mm = filename.match(/^(\d{4}-\d{2})-(monthly|week)/);
  if (mm) return `${mm[1]}-01`;
  const my = filename.match(/^(\d{4})-yearly/);
  if (my) return `${my[1]}-01-01`;
  const mq = filename.match(/^(\d{4})-Q([1-4])/);
  if (mq) return `${mq[1]}-${String((parseInt(mq[2]!, 10) - 1) * 3 + 1).padStart(2, "0")}-01`;
  return null;
}

function extractProjectFromPath(docId: string): string | null {
  // Match the penultimate segment if it is .../pulse/YYYY-MM-DD-<project>.md
  const m = docId.match(/\/pulse\/(?:\d{4}-\d{2}-\d{2})-([a-z][a-z0-9-]+)\.md$/);
  if (m) return m[1]!;
  return null;
}
