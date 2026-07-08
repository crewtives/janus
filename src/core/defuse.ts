/**
 * Deterministic, no-LLM graph de-fuse pass over ALL existing vault notes
 * (Fase 2 / U4). This is the one-time historical backfill that turns Fase 1's
 * color separation into real topological separation, and the authoritative
 * producer of pulse `prev:`/`next:` chronology (live + `_archive`).
 *
 * Per note, by type (classifier from U2):
 *  - pulse    → strip the `- MOCs:` footer (R8) and the `## Related` date-chain
 *               line (R10), delink pulse→pulse wiki-links in prose to plain text
 *               (OQ1), keep exactly one `- Hub:` up-link (R11), stamp
 *               `prev:`/`next:` from the full per-project sequence, add additive
 *               canonical tags keeping bare `pulse` (R12/KD1).
 *  - index/hub→ additive tags only; the MOC footer stays (KD3 — they are the
 *               MOC graph tier).
 *  - spine/roadmap/strategy/wrapped → additive tags; STRATEGY also gains a hub
 *               backlink (R13).
 *  - note     → prepend a minimal `type/note` block (R12); project + backlink
 *               deferred (OQ2/KD5); body prose is never edited.
 *  - daily/weekly/monthly/dashboard/moc/track → `type/<type>` tag only, no
 *               project (KD9). Timeline is already out of the graph (R6 filter),
 *               so aggregator bodies are NOT rewritten (R18 — R9 is forward-only).
 *
 * Freeze (R19): a note whose FRONTMATTER block carries `managed_by_janus: false`
 * or `needs_review: false` is left byte-for-byte untouched.
 *
 * Idempotency is the contract: running the pass twice is a byte-for-byte no-op.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JanusConfig } from "../config/types.ts";
import { classifyNote, type NoteType } from "./note-classify.ts";
import {
  addTags,
  isFrozen,
  joinFrontmatter,
  prependFrontmatter,
  removeKey,
  setKey,
  splitFrontmatter,
} from "./frontmatter.ts";
import { buildProjectPulseSequence } from "./scaffold/fix-related.ts";
import { relativeVaultPath } from "./vault-path.ts";

export interface DefuseOptions {
  vaultPath: string;
  config: JanusConfig;
  dryRun?: boolean;
  /** Only this project (by name/id). Global notes are still processed unless set. */
  projectFilter?: string | null;
}

export interface DefuseResult {
  scanned: number;
  changed: number;
  skipped: number; // frozen (R19)
  perType: Record<string, { scanned: number; changed: number }>;
  /** Up to a few changed relPaths, for the dry-run sample. */
  samples: string[];
}

// A wiki-link to a pulse note: `[[YYYY-MM-DD-<slug>]]` or `[[…|alias]]`. Matches
// only date-prefixed pulse targets, so hub/track/ADR/index links are untouched.
const PULSE_WIKILINK = /\[\[(\d{4}-\d{2}-\d{2}-[a-z][a-z0-9-]+)(?:\|([^\]]+))?\]\]/g;

/** Additive canonical tags to add for each note type. */
function canonicalTags(type: NoteType, projectId: string | null): string[] {
  const t = `type/${type}`;
  // Cross-project / global notes: type only (KD9). Notes defer project (OQ2/KD5).
  const projectless: NoteType[] = ["daily", "weekly", "monthly", "dashboard", "moc", "track", "note"];
  if (projectless.includes(type) || projectId === null) return [t];
  return [t, `project/${projectId}`];
}

/**
 * Line-level de-fuse of a pulse body: drop the MOC footer (R8) and the
 * `## Related` date-chain line in every EN/ES variant + both fallbacks (R10),
 * keep exactly one canonical `- Hub:` up-link (R11).
 */
export function defusePulseBody(body: string, project: string): string {
  const canonicalHub = `- Hub: [[${project}]]`;
  const out: string[] = [];
  let hubWritten = false;

  for (const line of body.split("\n")) {
    // MOC footer on a pulse (R8) — never on hub/index (those aren't pulses).
    if (/^[-*]\s*MOCs:\s*\[\[/i.test(line)) continue;
    // Date-chain line (R10): EN/ES wiki-link forms + both "(no previous…)" fallbacks.
    if (/^[-*]\s*(?:Previous pulse|Pulse anterior|D[ií]a anterior):\s*/i.test(line)) continue;
    if (/^[-*]\s*\(\s*(?:no previous pulse|sin pulse anterior)/i.test(line)) continue;
    // Collapse the hub up-link to exactly one canonical line (R11).
    if (/^[-*]\s*Hub:\s*/i.test(line)) {
      if (hubWritten) continue;
      hubWritten = true;
      out.push(canonicalHub);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * OQ1: delink pulse→pulse wiki-links that live in prose (Recurring,
 * this-day-last-year callout, Modifies/reverts) to plain text — keep the alias
 * if present, else the date. The hub `[[<project>]]` and track/ADR/index links
 * don't match the date-prefixed pulse pattern, so they survive.
 */
export function delinkPulseWikilinks(body: string): string {
  return body.replace(PULSE_WIKILINK, (_m, target: string, alias?: string) => {
    if (alias) return alias;
    const date = target.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1];
    return date ?? target;
  });
}

/** Full pulse transform (idempotent). */
export function defusePulseContent(
  content: string,
  opts: { project: string; projectId: string | null; prev: string | null; next: string | null },
): string {
  const split = splitFrontmatter(content);
  if (!split.hadFrontmatter) return content; // a pulse always has frontmatter

  let fm = addTags(split.frontmatter, canonicalTags("pulse", opts.projectId));
  fm = opts.prev ? setKey(fm, "prev", opts.prev) : removeKey(fm, "prev");
  fm = opts.next ? setKey(fm, "next", opts.next) : removeKey(fm, "next");

  let body = defusePulseBody(split.body, opts.project);
  body = delinkPulseWikilinks(body);

  return joinFrontmatter(fm, body);
}

/** Add canonical tags to a note that already has frontmatter (index/hub/spine/…). */
function defuseTagOnly(content: string, tags: string[]): string {
  const split = splitFrontmatter(content);
  if (!split.hadFrontmatter) return content;
  return joinFrontmatter(addTags(split.frontmatter, tags), split.body);
}

/** STRATEGY: tags + a hub backlink appended once (R13). */
function defuseStrategy(content: string, projectId: string | null): string {
  let out = defuseTagOnly(content, canonicalTags("strategy", projectId));
  if (projectId && !new RegExp(`^[-*]\\s*Hub:\\s*\\[\\[${projectId}\\]\\]`, "m").test(out)) {
    out = `${out.replace(/\n+$/, "")}\n\n## Related\n\n- Hub: [[${projectId}]]\n`;
  }
  return out;
}

/** Note: prepend a `type/note` block, or merge tags if one already exists (KD5). */
function defuseNote(content: string): string {
  const split = splitFrontmatter(content);
  if (split.hadFrontmatter) {
    return joinFrontmatter(addTags(split.frontmatter, ["type/note"]), split.body);
  }
  return prependFrontmatter(["type: note", "tags: [type/note]"], content);
}

/** Transform a single note by its classified type. Returns null when unchanged. */
export function defuseNonPulse(
  relPath: string,
  content: string,
  config: JanusConfig,
): string | null {
  const { frontmatter } = splitFrontmatter(content);
  const { type, projectId } = classifyNote(relPath, frontmatter, config);

  let out: string;
  switch (type) {
    case "index":
    case "hub":
    case "spine":
    case "roadmap":
    case "wrapped":
      out = defuseTagOnly(content, canonicalTags(type, projectId));
      break;
    case "strategy":
      out = defuseStrategy(content, projectId);
      break;
    case "note":
      out = defuseNote(content);
      break;
    case "daily":
    case "weekly":
    case "monthly":
    case "dashboard":
    case "moc":
    case "track":
      out = defuseTagOnly(content, canonicalTags(type, projectId));
      break;
    default:
      return null; // unknown / pulse (handled in the per-project pass)
  }
  return out === content ? null : out;
}

const TARGET_GLOBS = ["Timeline/**/*.md", "Notes/*.md", "Dashboards/**/*.md", "MOCs/**/*.md"];

export async function defuseVault(opts: DefuseOptions): Promise<DefuseResult> {
  const dryRun = opts.dryRun ?? false;
  const filter = opts.projectFilter ?? null;
  const result: DefuseResult = { scanned: 0, changed: 0, skipped: 0, perType: {}, samples: [] };

  const bump = (type: string, changed: boolean) => {
    result.scanned += 1;
    const pt = (result.perType[type] ??= { scanned: 0, changed: 0 });
    pt.scanned += 1;
    if (changed) {
      result.changed += 1;
      pt.changed += 1;
    }
  };
  const record = async (path: string, relPath: string, current: string, next: string | null, type: string) => {
    const changed = next !== null && next !== current;
    if (changed) {
      if (!dryRun) await writeFile(path, next!);
      if (result.samples.length < 8) result.samples.push(relPath);
    }
    bump(type, changed);
  };

  const projects = filter ? opts.config.projects.filter((p) => p.name === filter) : opts.config.projects;
  const handledPulses = new Set<string>();

  // Pass A — pulses, per project, authoritative prev/next over the full sequence.
  for (const project of projects) {
    const seq = await buildProjectPulseSequence(project);
    for (let i = 0; i < seq.length; i++) {
      const entry = seq[i]!;
      handledPulses.add(entry.filePath);
      const content = await readFile(entry.filePath, "utf-8");
      const relPath = relativeVaultPath(opts.config.obsidianVault, entry.filePath);
      if (isFrozen(content)) {
        result.skipped += 1;
        bump("pulse", false);
        continue;
      }
      const { frontmatter } = splitFrontmatter(content);
      const { projectId } = classifyNote(relPath, frontmatter, opts.config);
      const next = defusePulseContent(content, {
        project: project.name,
        projectId,
        prev: i > 0 ? seq[i - 1]!.filename : null,
        next: i < seq.length - 1 ? seq[i + 1]!.filename : null,
      });
      await record(entry.filePath, relPath, content, next, "pulse");
    }
  }

  // Pass B — everything else (project non-pulse files + global notes).
  const projectGlobs = projects.map((p) => {
    const rel = relativeVaultPath(opts.config.obsidianVault, p.obsidianPath);
    return `${rel}/**/*.md`;
  });
  const globs = filter ? projectGlobs : [...projectGlobs, ...TARGET_GLOBS];
  const seen = new Set<string>();

  for (const pattern of globs) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: opts.vaultPath, absolute: false })) {
      const abs = join(opts.vaultPath, rel);
      if (handledPulses.has(abs) || seen.has(abs)) continue;
      seen.add(abs);
      const content = await readFile(abs, "utf-8");
      const { frontmatter } = splitFrontmatter(content);
      const { type } = classifyNote(rel, frontmatter, opts.config);
      if (type === "pulse" || type === "unknown") continue; // pulses done in Pass A
      if (isFrozen(content)) {
        result.skipped += 1;
        bump(type, false);
        continue;
      }
      const next = defuseNonPulse(rel, content, opts.config);
      await record(abs, rel, content, next, type);
    }
  }

  return result;
}
