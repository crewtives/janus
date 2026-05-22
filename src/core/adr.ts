import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type AdrStatus = "proposed" | "accepted" | "deprecated" | "superseded";

export interface Adr {
  number: number;
  slug: string;
  title: string;
  status: AdrStatus;
  date: string; // YYYY-MM-DD
  project: string | null;
  supersededBy: number | null;
  tags: string[];
  filename: string; // ADR-NNN-<slug>.md
}

export interface CreateAdrInput {
  vaultPath: string;
  title: string;
  project?: string | undefined;
  context?: string | undefined;
  decision?: string | undefined;
  consequences?: string | undefined;
  alternatives?: string | undefined;
  status?: AdrStatus;
  /** If provided, use this date; default = today. */
  date?: string;
  /** If provided, force this number; default = next available. */
  number?: number;
}

export interface CreateAdrResult {
  path: string;
  number: number;
  slug: string;
  filename: string;
}

const ADR_DIR_NAME = "Decisions";

/**
 * Creates a new ADR at `<vault>/Decisions/ADR-NNN-<slug>.md`.
 * Auto-assigns the next available number unless one is specified.
 */
export async function createAdr(input: CreateAdrInput): Promise<CreateAdrResult> {
  const dir = join(input.vaultPath, ADR_DIR_NAME);
  await mkdir(dir, { recursive: true });

  const number = input.number ?? (await nextAdrNumber(dir));
  const slug = slugifyTitle(input.title);
  const filename = `ADR-${pad3(number)}-${slug}.md`;
  const path = join(dir, filename);
  if (existsSync(path)) {
    throw new Error(`ADR already exists: ${path}`);
  }

  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const status: AdrStatus = input.status ?? "accepted";
  const project = input.project ?? null;

  const tags = ["adr", "decision"];
  if (project) tags.push(`project/${project}`);

  const content = `---
type: adr
number: ${number}
title: ${JSON.stringify(input.title)}
status: ${status}
date: ${date}
project: ${project ? JSON.stringify(project) : "null"}
superseded_by: null
tags: [${tags.map((t) => JSON.stringify(t)).join(", ")}]
aliases: [${JSON.stringify(`ADR-${pad3(number)}`)}, ${JSON.stringify(input.title)}]
---

# ADR-${pad3(number)}: ${input.title}

> [!info]+ Status: \`${status}\` · ${date}${project ? ` · project: [[${project}]]` : ""}
> Architecture Decision Record — captures the context, the decision, and its consequences.

## Context

${input.context ?? "(what problem or question motivates this decision)"}

## Decision

${input.decision ?? "(what was decided, in 1-3 clear sentences)"}

## Consequences

${input.consequences ?? `**Positive:**
- ...

**Negative / trade-offs:**
- ...

**Neutral:**
- ...`}

## Alternatives considered

${input.alternatives ?? "(other options evaluated and why they were rejected)"}

## References

- (links to pulses, sessions, commits, weeklies that led to this decision)

## Notes

- If this decision is modified in the future, create a new ADR and mark this one as \`superseded\` with \`superseded_by: <new number>\`.
- If it becomes obsolete with no replacement, mark it as \`deprecated\`.
`;

  await writeFile(path, content);
  return { path, number, slug, filename: filename.replace(/\.md$/, "") };
}

/**
 * Promotes a specific decision from a pulse (block ID `^decision-N`) to a new ADR.
 * Reads the pulse, extracts the bullet from the Decisions section, and creates
 * the ADR pre-filling the `decision` field and adding a reference to the pulse.
 */
export async function promoteDecisionToAdr(opts: {
  vaultPath: string;
  pulsePath: string; // absolute path al pulse .md
  decisionId: string; // ej. "decision-1" (sin el ^)
  title: string;
  project?: string;
  status?: AdrStatus;
}): Promise<CreateAdrResult> {
  if (!existsSync(opts.pulsePath)) throw new Error(`Pulse does not exist: ${opts.pulsePath}`);
  const content = await readFile(opts.pulsePath, "utf-8");

  const decisionText = extractDecision(content, opts.decisionId);
  if (!decisionText) {
    throw new Error(`Block ID '^${opts.decisionId}' not found in ${opts.pulsePath}`);
  }

  const pulseFilename = opts.pulsePath.split("/").pop()!.replace(/\.md$/, "");
  const pulseDateMatch = pulseFilename.match(/^(\d{4}-\d{2}-\d{2})/);
  const projectMatch = pulseFilename.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);

  const project = opts.project ?? projectMatch?.[1] ?? undefined;

  // Create the ADR with an explicit reference to the source pulse.
  const result = await createAdr({
    vaultPath: opts.vaultPath,
    title: opts.title,
    project,
    decision: decisionText,
    context: `Promoted from decision \`^${opts.decisionId}\` in pulse [[${pulseFilename}]] from ${pulseDateMatch?.[1] ?? "?"}.`,
    status: opts.status ?? "accepted",
  });

  // Annotate in the pulse that this decision was promoted.
  await annotatePulseWithAdrLink({
    pulsePath: opts.pulsePath,
    decisionId: opts.decisionId,
    adrFilename: result.filename,
  });

  return result;
}

async function annotatePulseWithAdrLink(opts: {
  pulsePath: string;
  decisionId: string;
  adrFilename: string;
}): Promise<void> {
  const content = await readFile(opts.pulsePath, "utf-8");
  const marker = `^${opts.decisionId}`;
  // If it already has the ADR link, don't duplicate.
  if (content.includes(`→ [[${opts.adrFilename}]]`)) return;
  const updated = content.replace(
    new RegExp(`(\\^${escapeRegex(opts.decisionId)})`),
    `$1 → [[${opts.adrFilename}]]`,
  );
  if (updated !== content) await writeFile(opts.pulsePath, updated);
}

function extractDecision(pulseContent: string, decisionId: string): string | null {
  // Find the line containing `^decision-N` inside the Decisions callout.
  const lines = pulseContent.split("\n");
  for (const line of lines) {
    if (line.includes(`^${decisionId}`)) {
      // Strip the `> - ` prefix and the `^decision-N` block id.
      const cleaned = line
        .replace(/^>\s*-\s*/, "")
        .replace(/\s*\^\S+\s*$/, "")
        .trim();
      return cleaned || null;
    }
  }
  return null;
}

async function nextAdrNumber(dir: string): Promise<number> {
  if (!existsSync(dir)) return 1;
  const entries = await readdir(dir);
  let max = 0;
  for (const name of entries) {
    const m = name.match(/^ADR-(\d{3,})-/);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

export async function listAdrs(vaultPath: string): Promise<Adr[]> {
  const dir = join(vaultPath, ADR_DIR_NAME);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const adrs: Adr[] = [];
  for (const name of entries) {
    const m = name.match(/^ADR-(\d{3,})-(.+)\.md$/);
    if (!m) continue;
    const filePath = join(dir, name);
    const content = await readFile(filePath, "utf-8");
    const fm = extractFrontmatter(content);
    adrs.push({
      number: parseInt(m[1]!, 10),
      slug: m[2]!,
      title: fm.title ?? m[2]!,
      status: (fm.status as AdrStatus) ?? "proposed",
      date: fm.date ?? "?",
      project: fm.project === "null" || !fm.project ? null : fm.project,
      supersededBy: fm.superseded_by && fm.superseded_by !== "null" ? parseInt(fm.superseded_by, 10) : null,
      tags: fm.tags ? parseList(fm.tags) : [],
      filename: name.replace(/\.md$/, ""),
    });
  }
  adrs.sort((a, b) => a.number - b.number);
  return adrs;
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

function parseList(raw: string): string[] {
  const m = raw.match(/^\[(.+)\]$/);
  if (!m) return [];
  return m[1]!.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

function slugifyTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
