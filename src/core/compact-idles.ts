import { existsSync } from "node:fs";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface PulseHeader {
  filename: string; // sin .md
  date: string;
  filePath: string;
  status: string;
  /** True si el pulse cumple la heurística "boring" (on-track sin shipped/decisions/risks). */
  isBoring: boolean;
  /** Tipo a efectos de compactación: idle | boring | active. */
  quietness: "idle" | "boring" | "active";
}

export interface CompactResult {
  streaksFound: number;
  streaksWritten: number;
  filesDeleted: number;
  streaks: Array<{ start: string; end: string; days: number; project: string; kind: "idle" | "quiet" }>;
}

const MIN_STREAK_LEN = 2;

/**
 * Detecta runs de pulses "quiet" (idle, idle-streak, opcionalmente boring) consecutivos
 * para un proyecto y los reemplaza por UN único pulse rango con frontmatter especial.
 *
 * - Status del pulse compactado:
 *   - `idle-streak` si TODOS los pulses del run son idle/idle-streak (sin actividad).
 *   - `quiet-streak` si al menos uno es boring (on-track sin shipped/decisions/risks).
 * - `includeBoring=false` (default): solo compacta idle. Comportamiento legacy.
 * - `includeBoring=true`: también compacta boring days y mezcla idle+boring.
 * - Solo compacta streaks de ≥ MIN_STREAK_LEN (default 2).
 * - El pulse compactado se escribe en `<startDate>-<project>.md` (mantiene el primer día).
 * - Los pulses de `<startDate+1>` a `<endDate>` se borran (vault + repo).
 * - Idempotente.
 */
export async function compactIdleStreaks(opts: {
  obsidianPath: string;
  repoPath: string;
  project: string;
  dryRun?: boolean;
  minStreakLen?: number;
  /** Si true, también compacta pulses 'boring' (on-track sin shipped/decisions/risks). Default false. */
  includeBoring?: boolean;
}): Promise<CompactResult> {
  const minLen = opts.minStreakLen ?? MIN_STREAK_LEN;
  const includeBoring = opts.includeBoring ?? false;
  const result: CompactResult = {
    streaksFound: 0,
    streaksWritten: 0,
    filesDeleted: 0,
    streaks: [],
  };

  const pulses = await readProjectPulses(opts.obsidianPath, opts.project);
  if (pulses.length < minLen) return result;

  const runs = findStreaks(pulses, minLen, includeBoring);
  result.streaksFound = runs.length;

  for (const run of runs) {
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const hasBoring = run.some((p) => p.quietness === "boring");
    const kind: "idle" | "quiet" = hasBoring ? "quiet" : "idle";

    result.streaks.push({
      start: first.date,
      end: last.date,
      days: run.length,
      project: opts.project,
      kind,
    });

    if (opts.dryRun) continue;

    const content = renderStreakPulse({
      project: opts.project,
      startDate: first.date,
      endDate: last.date,
      days: run.length,
      kind,
    });
    await writeFile(first.filePath, content);
    const repoFirst = join(opts.repoPath, "docs", "pulse", `${first.filename}.md`);
    if (existsSync(repoFirst)) {
      await writeFile(repoFirst, content);
    }
    result.streaksWritten += 1;

    for (const p of run.slice(1)) {
      if (existsSync(p.filePath)) {
        await unlink(p.filePath);
        result.filesDeleted += 1;
      }
      const repoP = join(opts.repoPath, "docs", "pulse", `${p.filename}.md`);
      if (existsSync(repoP)) {
        await unlink(repoP);
        result.filesDeleted += 1;
      }
    }
  }

  return result;
}

async function readProjectPulses(obsidianPath: string, project: string): Promise<PulseHeader[]> {
  const dir = join(obsidianPath, "pulse");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const headers: PulseHeader[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
    if (!m || m[2] !== project) continue;
    const filePath = join(dir, name);
    const content = await readFile(filePath, "utf-8");
    const status = extractStatus(content);
    const isBoring = detectBoring(content, status);
    const quietness: PulseHeader["quietness"] =
      status === "idle" || status === "idle-streak" || status === "quiet-streak" ? "idle" : isBoring ? "boring" : "active";
    headers.push({
      filename: name.replace(/\.md$/, ""),
      date: m[1]!,
      filePath,
      status,
      isBoring,
      quietness,
    });
  }
  headers.sort((a, b) => a.date.localeCompare(b.date));
  return headers;
}

function extractStatus(content: string): string {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return "unknown";
  const m = fm[1]!.match(/^status:\s*(.+)$/m);
  return m?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "unknown";
}

/**
 * Heurística "boring":
 * - status: on-track (no idle, no stuck, no some-drift, no inferring).
 * - SIN callout `> [!success] Shipped`, SIN `> [!quote] Decisions`, SIN `> [!danger] Risks`.
 * - Frontmatter risks = 0.
 *
 * Esto captura días con commits de mantenimiento (chore/docs/style/refactor) que no
 * generan outcome de producto y no aportan información significativa al timeline.
 */
function detectBoring(content: string, status: string): boolean {
  if (status !== "on-track") return false;
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return false;
  const risksM = fm[1]!.match(/^risks:\s*(\d+)$/m);
  const risks = risksM ? parseInt(risksM[1]!, 10) : 0;
  if (risks > 0) return false;

  const hasShipped = /^>\s*\[!success\][^\n]*Shipped/im.test(content);
  const hasDecisions = /^>\s*\[!quote\][^\n]*Decisions/im.test(content);
  const hasRisks = /^>\s*\[!danger\]/m.test(content);
  return !hasShipped && !hasDecisions && !hasRisks;
}

function findStreaks(pulses: PulseHeader[], minLen: number, includeBoring: boolean): PulseHeader[][] {
  const runs: PulseHeader[][] = [];
  let current: PulseHeader[] = [];

  const flush = () => {
    if (current.length >= minLen) runs.push(current);
    current = [];
  };

  const isQuiet = (p: PulseHeader): boolean => {
    if (p.quietness === "idle") return true;
    if (includeBoring && p.quietness === "boring") return true;
    return false;
  };

  for (let i = 0; i < pulses.length; i += 1) {
    const p = pulses[i]!;
    if (!isQuiet(p)) {
      flush();
      continue;
    }
    if (current.length === 0) {
      current.push(p);
      continue;
    }
    const prev = current[current.length - 1]!;
    if (isNextDay(prev.date, p.date)) {
      current.push(p);
    } else {
      flush();
      current.push(p);
    }
  }
  flush();
  return runs;
}

function isNextDay(d1: string, d2: string): boolean {
  const a = new Date(`${d1}T00:00:00`);
  a.setDate(a.getDate() + 1);
  const expected = `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, "0")}-${String(a.getDate()).padStart(2, "0")}`;
  return expected === d2;
}

function renderStreakPulse(opts: {
  project: string;
  startDate: string;
  endDate: string;
  days: number;
  kind: "idle" | "quiet";
}): string {
  const isIdle = opts.kind === "idle";
  const status = isIdle ? "idle-streak" : "quiet-streak";
  const tagsExtra = isIdle ? "idle-streak" : "quiet-streak";
  const title = isIdle ? `No-activity streak — ${opts.days} days` : `Low-signal streak — ${opts.days} days`;
  const summary = isIdle
    ? `From **${opts.startDate}** to **${opts.endDate}** there were no commits or Claude Code sessions in ${opts.project}.`
    : `From **${opts.startDate}** to **${opts.endDate}**: ${opts.days} days with no shipped outcomes, decisions, or notable risks in ${opts.project} (maintenance commits — chore/docs/refactor — and/or idle days).`;
  const detail = isIdle
    ? `This note replaces ${opts.days} consecutive daily pulses in \`status: idle\`.`
    : `This note replaces ${opts.days} consecutive pulses without significant information (idle + boring). The original pulses were discarded; commits remain in git.`;

  return `---
date: ${opts.startDate}
project: ${opts.project}
status: ${status}
streak_start: ${opts.startDate}
streak_end: ${opts.endDate}
streak_days: ${opts.days}
commits: 0
files_changed: 0
sessions_analyzed: 0
insertions: 0
deletions: 0
risks: 0
prompt_version: compact
tags: [pulse, pulse/${opts.project}, ${tagsExtra}]
aliases: ["${opts.project} ${isIdle ? "Idle" : "Quiet"} ${opts.startDate} → ${opts.endDate}"]
---

## TL;DR

> [!summary]+ ${title}
> ${summary}
> Pulse compacted by Janus to reduce graph noise.

## Related
- Hub: [[${opts.project}]]
- MOCs: [[Projects MOC]]

> [!info]- Detail
> ${detail} To recover the per-day detail, delete this file and re-run:
>
> \`\`\`bash
> bun run bin/janus.ts pulse --backfill ${opts.days}d --project ${opts.project}
> \`\`\`

\`\`\`dataview
TABLE date, status, file.link AS Pulse
FROM "Projects"
WHERE contains(tags, "pulse") AND project = "${opts.project}"
SORT date DESC
LIMIT 14
\`\`\`
`;
}
