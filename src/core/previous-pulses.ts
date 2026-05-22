import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { PreviousPulseSection } from "./template.ts";

export interface PreviousPulses {
  risks: PreviousPulseSection[];
  decisions: PreviousPulseSection[];
  /** Pulse immediately before currentDate (may not be yesterday if there were gaps). Null if none. */
  immediatePrevious: { date: string; filename: string; status: string } | null;
  /** Number of consecutive idle pulses immediately before currentDate. */
  idleStreakBefore: number;
}

interface ParsedHeader {
  date: string;
  filename: string;
  status: string;
}

const STATUS_RE = /^status:\s*(.+)$/m;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/**
 * Reads previous pulses (on disk) for the same project and extracts:
 * - Risks / Decisions callouts (to detect recurrences).
 * - the immediately previous pulse (filename + status) for the "Previous day" wiki-link.
 * - the streak of consecutive idle pulses before the current day.
 */
export async function loadPreviousPulses(opts: {
  obsidianPath: string;
  currentDate: string;
  daysBack: number;
}): Promise<PreviousPulses> {
  const dir = join(opts.obsidianPath, "pulse");
  if (!existsSync(dir)) {
    return { risks: [], decisions: [], immediatePrevious: null, idleStreakBefore: 0 };
  }

  const entries = await readdir(dir);
  const previous = entries
    .filter((f) => f.endsWith(".md") && f < `${opts.currentDate}--`)
    .sort()
    .reverse();

  const window = previous.slice(0, opts.daysBack);

  const risks: PreviousPulseSection[] = [];
  const decisions: PreviousPulseSection[] = [];

  let immediatePrevious: ParsedHeader | null = null;
  let idleStreakBefore = 0;
  let countingStreak = true;

  for (const [idx, name] of window.entries()) {
    const filePath = join(dir, name);
    const content = await readFile(filePath, "utf-8");
    const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})-/);
    const date = dateMatch?.[1] ?? "?";
    const pulsePath = basename(name, ".md");

    const status = extractStatus(content);

    if (idx === 0) {
      immediatePrevious = { date, filename: pulsePath, status };
    }
    if (countingStreak) {
      if (status === "idle") idleStreakBefore += 1;
      else countingStreak = false;
    }

    const risksText = extractCallout(content, /^>\s*\[!danger\][^\n]*Risks/i);
    if (risksText) risks.push({ date, pulsePath, text: risksText });

    const decisionsText = extractCallout(content, /^>\s*\[!quote\][^\n]*Decisions/i);
    if (decisionsText) decisions.push({ date, pulsePath, text: decisionsText });
  }

  return { risks, decisions, immediatePrevious, idleStreakBefore };
}

function extractStatus(content: string): string {
  const fm = content.match(FRONTMATTER_RE);
  if (!fm) return "unknown";
  const sm = fm[1]!.match(STATUS_RE);
  return sm?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "unknown";
}

function extractCallout(content: string, headerRegex: RegExp): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (headerRegex.test(line)) {
      inside = true;
      continue;
    }
    if (inside) {
      if (!line.startsWith(">")) break;
      const cleaned = line.replace(/^>\s?/, "").trim();
      if (cleaned) out.push(cleaned);
    }
  }
  return out.join("\n").trim();
}
