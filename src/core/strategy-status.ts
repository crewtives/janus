import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface StrategyStatus {
  status: "filled" | "draft" | "missing";
  /** Days since the STRATEGY.md template was created (mtime). 0 if filled or missing. */
  daysAsDraft: number;
}

export interface StrategyCandidate {
  path: string;
  content: string;
  /** true when the file still carries `needs_review: true` (the scaffolded template). */
  draft: boolean;
}

/**
 * Resolves the effective STRATEGY.md across the vault and the repo, preferring a
 * FILLED file over a template DRAFT (`needs_review: true`).
 *
 * A project can keep an authored STRATEGY.md in its repo while the vault mirror
 * is still the empty template Janus scaffolds. Reading the first-existing file
 * (vault first) masked the authored one and made reports claim "no north star".
 * Preference: any filled candidate, else the first draft; ties resolved [vault, repo].
 */
export async function pickBestStrategy(
  obsidianPath: string,
  repoPath: string,
): Promise<StrategyCandidate | null> {
  const paths = [join(obsidianPath, "STRATEGY.md"), join(repoPath, "STRATEGY.md")];
  const found: StrategyCandidate[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const content = await readFile(p, "utf-8");
    found.push({ path: p, content, draft: /^needs_review:\s*true\b/m.test(content) });
  }
  if (found.length === 0) return null;
  return found.find((c) => !c.draft) ?? found[0] ?? null;
}

/**
 * Inspects the project's STRATEGY.md and reports whether it is complete,
 * still a template (`needs_review: true`), or missing. Prefers a filled file
 * over a template draft across vault + repo (see `pickBestStrategy`).
 *
 * For drafts, computes how many days have passed since its creation (mtime),
 * so the prompt can escalate the nag.
 */
export async function detectStrategyStatus(opts: {
  obsidianPath: string;
  repoPath: string;
  currentDate: string; // YYYY-MM-DD
}): Promise<StrategyStatus> {
  const best = await pickBestStrategy(opts.obsidianPath, opts.repoPath);
  if (!best) return { status: "missing", daysAsDraft: 0 };
  if (!best.draft) return { status: "filled", daysAsDraft: 0 };
  const st = statSync(best.path);
  return { status: "draft", daysAsDraft: daysBetween(st.mtime, opts.currentDate) };
}

function daysBetween(from: Date, toISO: string): number {
  const to = new Date(`${toISO}T00:00:00`);
  const diffMs = to.getTime() - from.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  return Math.max(0, days);
}
