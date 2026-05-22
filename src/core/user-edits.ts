import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Checkpoint } from "./checkpoint.ts";
import { obsidianPulsePath } from "./obsidian.ts";

export interface UserEdit {
  date: string;
  /** Unified diff summary: only the lines that changed, capped. */
  diff: string;
}

const MAX_EDITS_TO_INJECT = 3;
const MAX_DIFF_LINES = 25;
const MAX_DIFF_CHARS = 1500;

/**
 * Detects manual user edits in the project's last N pulses.
 *
 * Algorithm:
 * 1. Read the last N baselines (LLM-generated content) from SQLite.
 * 2. For each, compare to the current on-disk file.
 * 3. If content changed, compute a per-line diff and return a summary.
 *
 * Only real edits are returned — no diff, no entry.
 */
export async function loadUserEdits(opts: {
  checkpoint: Checkpoint;
  project: string;
  obsidianPath: string;
  currentDate: string;
  maxEdits?: number;
}): Promise<UserEdit[]> {
  const limit = opts.maxEdits ?? MAX_EDITS_TO_INJECT;
  // Take a larger buffer to drop unchanged pulses without losing slots.
  const baselines = opts.checkpoint.listBaselines(opts.project, limit * 3);

  const edits: UserEdit[] = [];
  for (const baseline of baselines) {
    if (edits.length >= limit) break;
    if (baseline.date >= opts.currentDate) continue; // only earlier pulses
    const filePath = obsidianPulsePath(opts.obsidianPath, opts.project, baseline.date);
    if (!existsSync(filePath)) continue;
    const current = await readFile(filePath, "utf-8");
    if (current.trim() === baseline.content.trim()) continue;

    const diff = unifiedDiff(baseline.content, current);
    if (!diff) continue;
    edits.push({ date: baseline.date, diff });
  }
  return edits;
}

/**
 * Simple per-line diff. Not git-quality, but enough for the LLM to
 * understand what the user replaced. Capped at MAX_DIFF_LINES and
 * MAX_DIFF_CHARS to keep the prompt small.
 */
function unifiedDiff(a: string, b: string): string {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const aSet = new Set(aLines);
  const bSet = new Set(bLines);

  const removed = aLines.filter((l) => l.trim() && !bSet.has(l)).slice(0, MAX_DIFF_LINES / 2);
  const added = bLines.filter((l) => l.trim() && !aSet.has(l)).slice(0, MAX_DIFF_LINES / 2);

  if (removed.length === 0 && added.length === 0) return "";

  const lines: string[] = [];
  for (const r of removed) lines.push(`- ${r.slice(0, 200)}`);
  for (const a of added) lines.push(`+ ${a.slice(0, 200)}`);
  let out = lines.join("\n");
  if (out.length > MAX_DIFF_CHARS) out = out.slice(0, MAX_DIFF_CHARS) + "\n[...truncated...]";
  return out;
}
