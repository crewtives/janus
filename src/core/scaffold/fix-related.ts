/**
 * Deterministic post-process for each pulse's structural links (Fase 2 / U3).
 *
 * Two jobs, no LLM, no cost:
 *
 *  1. Canonicalize the single up-link `- Hub: [[<project>]]` in `## Related`
 *     (R11 — every pulse keeps exactly one structural up-link, to its hub).
 *  2. Stamp `prev:`/`next:` chronology into the frontmatter (R10 — order is a
 *     property, NOT a graph edge, so it's a bare filename, never a `[[wikilink]]`).
 *
 * Why this file no longer writes `- Pulse anterior: [[…]]`: that date-chain line
 * was the exact edge R10 removes and the exact thing that re-fused the graph on
 * every `janus run` (orchestrator calls `fixAllRelated`). The chronology it
 * carried now lives in `prev:`/`next:` instead.
 *
 * prev/next authority (OQ5): U4's deterministic pass owns the full live+archive
 * chronology. This writer maintains the LIVE tail (`pulse/*.md`) every run, but
 * computes indices against the full per-project sequence (live + `_archive/**`)
 * so the first live pulse's `prev:` points at the last archived pulse — i.e. it
 * writes the SAME values U4 would, keeping the two idempotent with each other.
 *
 * Importable in-process from the orchestrator. The thin wrapper in
 * `scripts/fix-pulse-anterior-links.ts` keeps the standalone CLI.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../config/loader.ts";
import type { JanusConfig, ProjectConfig } from "../../config/types.ts";
import { joinFrontmatter, removeKey, setKey, splitFrontmatter } from "../frontmatter.ts";

export interface FixResult {
  pulseFile: string;
  changed: boolean;
  reason: string;
}

export interface FixProjectResult {
  scanned: number;
  changed: number;
  results: FixResult[];
}

export interface FixAllOptions {
  dryRun?: boolean;
  config?: JanusConfig;
  projectFilter?: string | null;
}

export interface FixAllResult {
  totalScanned: number;
  totalChanged: number;
  perProject: Array<{ project: string; result: FixProjectResult }>;
}

/**
 * Canonicalize the `- Hub: [[<project>]]` line inside `## Related`. Repairs an
 * existing hub line that drifted (alias/typo); does not insert one when absent
 * (v9 always emits it, and U4 guarantees exactly one). Idempotent.
 */
export function fixRelatedSection(
  content: string,
  projectName: string,
): { content: string; changed: boolean; reason: string } {
  const lines = content.split("\n");

  const relatedIdx = lines.findIndex((l) => /^##\s+Related\b/.test(l));
  if (relatedIdx === -1) {
    return { content, changed: false, reason: "sin sección ## Related" };
  }

  let endIdx = lines.length;
  for (let i = relatedIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s+/.test(line) || /^>\s*\[!/.test(line) || /^```/.test(line)) {
      endIdx = i;
      break;
    }
  }

  const canonicalHub = `- Hub: [[${projectName}]]`;

  let hubLineIdx = -1;
  for (let i = relatedIdx + 1; i < endIdx; i++) {
    if (/^[-*]\s*Hub:\s*/i.test(lines[i]!)) hubLineIdx = i;
  }

  if (hubLineIdx !== -1 && lines[hubLineIdx] !== canonicalHub) {
    lines[hubLineIdx] = canonicalHub;
    return { content: lines.join("\n"), changed: true, reason: "hub" };
  }

  return { content, changed: false, reason: "ya canónico" };
}

/**
 * Stamp `prev:`/`next:` scalars into the frontmatter. Bare filenames (no `.md`,
 * no `[[…]]`) so Obsidian never renders a graph edge (R10). Boundary pulses drop
 * the absent side. Idempotent; no-op on notes without frontmatter.
 */
export function writePrevNext(
  content: string,
  prev: string | null,
  next: string | null,
): { content: string; changed: boolean } {
  const split = splitFrontmatter(content);
  if (!split.hadFrontmatter) return { content, changed: false };

  let fm = split.frontmatter;
  fm = prev ? setKey(fm, "prev", prev) : removeKey(fm, "prev");
  fm = next ? setKey(fm, "next", next) : removeKey(fm, "next");

  const updated = joinFrontmatter(fm, split.body);
  return { content: updated, changed: updated !== content };
}

const PULSE_FILENAME = /^\d{4}-\d{2}-\d{2}-.+\.md$/;

export interface PulseSeqEntry {
  filename: string; // without .md
  filePath: string;
  inLive: boolean;
}

/**
 * The full chronological pulse sequence for a project: live `pulse/*.md` plus
 * archived `_archive/YYYY-MM/*.md`. Both dirs are project-scoped, so a
 * date-prefix filter is enough. Sorted ascending by the date-prefixed filename.
 *
 * Shared with U4 (`defuse.ts`) so both write identical prev/next values (OQ5).
 */
export async function buildProjectPulseSequence(project: ProjectConfig): Promise<PulseSeqEntry[]> {
  const out: PulseSeqEntry[] = [];

  const pulseDir = join(project.obsidianPath, "pulse");
  if (existsSync(pulseDir)) {
    for (const f of await readdir(pulseDir)) {
      if (PULSE_FILENAME.test(f)) {
        out.push({ filename: f.replace(/\.md$/, ""), filePath: join(pulseDir, f), inLive: true });
      }
    }
  }

  const archiveDir = join(project.obsidianPath, "_archive");
  if (existsSync(archiveDir)) {
    const glob = new Bun.Glob("*/*.md");
    for await (const rel of glob.scan({ cwd: archiveDir, absolute: false })) {
      const base = rel.slice(rel.lastIndexOf("/") + 1);
      if (PULSE_FILENAME.test(base)) {
        out.push({ filename: base.replace(/\.md$/, ""), filePath: join(archiveDir, rel), inLive: false });
      }
    }
  }

  out.sort((a, b) => a.filename.localeCompare(b.filename));
  return out;
}

export async function fixProject(
  project: ProjectConfig,
  dryRun: boolean,
): Promise<FixProjectResult> {
  const seq = await buildProjectPulseSequence(project);
  const results: FixResult[] = [];
  let changedCount = 0;
  let scanned = 0;

  for (let i = 0; i < seq.length; i++) {
    const entry = seq[i]!;
    // U3 maintains only the live tail; U4 owns archive rewrites.
    if (!entry.inLive) continue;
    scanned += 1;

    const content = await readFile(entry.filePath, "utf-8");
    const prev = i > 0 ? seq[i - 1]!.filename : null;
    const next = i < seq.length - 1 ? seq[i + 1]!.filename : null;

    const hub = fixRelatedSection(content, project.name);
    const pn = writePrevNext(hub.content, prev, next);
    const changed = hub.changed || pn.changed;

    if (changed) {
      changedCount += 1;
      if (!dryRun) await writeFile(entry.filePath, pn.content);
    }

    const reasons = [hub.changed ? hub.reason : null, pn.changed ? "prev/next" : null].filter(Boolean);
    results.push({
      pulseFile: `${entry.filename}.md`,
      changed,
      reason: reasons.join(", ") || "ya canónico",
    });
  }

  return { scanned, changed: changedCount, results };
}

export async function fixAllRelated(opts: FixAllOptions = {}): Promise<FixAllResult> {
  const config = opts.config ?? (await loadConfig());
  const dryRun = opts.dryRun ?? false;
  const projectFilter = opts.projectFilter ?? null;

  const projects = projectFilter
    ? config.projects.filter((p) => p.name === projectFilter)
    : config.projects;

  let totalScanned = 0;
  let totalChanged = 0;
  const perProject: Array<{ project: string; result: FixProjectResult }> = [];

  for (const project of projects) {
    const result = await fixProject(project, dryRun);
    totalScanned += result.scanned;
    totalChanged += result.changed;
    perProject.push({ project: project.name, result });
  }

  return { totalScanned, totalChanged, perProject };
}
