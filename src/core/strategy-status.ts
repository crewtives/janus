import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface StrategyStatus {
  status: "filled" | "draft" | "missing";
  /** Days since the STRATEGY.md template was created (mtime). 0 if filled or missing. */
  daysAsDraft: number;
}

/**
 * Inspects the project's STRATEGY.md and reports whether it is complete,
 * still a template (`needs_review: true`), or missing.
 *
 * For drafts, computes how many days have passed since its creation (mtime),
 * so the prompt can escalate the nag.
 */
export async function detectStrategyStatus(opts: {
  obsidianPath: string;
  repoPath: string;
  currentDate: string; // YYYY-MM-DD
}): Promise<StrategyStatus> {
  const candidates = [join(opts.obsidianPath, "STRATEGY.md"), join(opts.repoPath, "STRATEGY.md")];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const content = await readFile(p, "utf-8");
    const needsReview = /^needs_review:\s*true\b/m.test(content);
    if (!needsReview) {
      return { status: "filled", daysAsDraft: 0 };
    }
    const st = statSync(p);
    const days = daysBetween(st.mtime, opts.currentDate);
    return { status: "draft", daysAsDraft: days };
  }
  return { status: "missing", daysAsDraft: 0 };
}

function daysBetween(from: Date, toISO: string): number {
  const to = new Date(`${toISO}T00:00:00`);
  const diffMs = to.getTime() - from.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  return Math.max(0, days);
}
