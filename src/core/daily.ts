import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Eta } from "eta";
import type { JanusConfig } from "../config/types.ts";
import { resolveRunner } from "../runners/registry.ts";
import type { LLMRunner } from "../runners/types.ts";
import type { ProjectResult } from "./discord.ts";
import { loadVoiceSpec } from "./template.ts";
import dailyRollupTemplate from "../prompts/daily-rollup.v7.md" with { type: "text" };

export const ROLLUP_PROMPT_VERSION = "v7" as const;

export interface DailyWriteResult {
  path: string;
  projectCount: number;
  /** true if the LLM was used, false on fallback */
  llmGenerated: boolean;
}

interface PulseForRollup {
  project: string;
  content: string;
}

// autoTrim defaults to [false, "nl"], which eats the newline after every `%>`.
// The frontmatter example the prompt tells the model to copy is one interpolation
// per line, so the default collapsed it into `pulses_count: 2expected_projects: 3`.
// The gap disclosure rides in those keys; it can't ship glued to its neighbour.
const eta = new Eta({ autoEscape: false, rmWhitespace: false, autoTrim: false });

/**
 * Writes Daily/YYYY-MM-DD.md. Strategy:
 * 1. Read ALL the day's pulses from the filesystem (not the run counter)
 * 2. If there are 1+ ok pulses, invoke claude to generate a cross-project narrative
 * 3. Fallback: if claude fails, generate a minimal daily with embeds (legacy behavior)
 */
export async function writeDailyConsolidated(opts: {
  vaultPath: string;
  date: string;
  results: ProjectResult[];
  dryRun?: boolean;
  config?: JanusConfig;
  runnerOverride?: LLMRunner;
}): Promise<DailyWriteResult | null> {
  const pulses = await collectPulsesForDate(opts.vaultPath, opts.date);
  if (pulses.length === 0) return null;

  const path = join(opts.vaultPath, "Timeline", "Daily", `${opts.date}.md`);
  if (opts.dryRun) return { path, projectCount: pulses.length, llmGenerated: false };

  const failedProjects = deriveFailedProjects(opts.results, pulses);

  let content: string;
  let llmGenerated = false;
  try {
    if (opts.config) {
      content = await renderViaLLM(opts.date, pulses, opts.config, failedProjects, opts.runnerOverride);
      llmGenerated = true;
    } else {
      content = renderFallback(opts.date, pulses, failedProjects);
    }
  } catch (err) {
    console.warn(`[daily ${opts.date}] LLM failed, using fallback: ${err instanceof Error ? err.message : String(err)}`);
    content = renderFallback(opts.date, pulses, failedProjects);
  }

  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
  return { path, projectCount: pulses.length, llmGenerated };
}

/**
 * Projects the run tried and lost. A gap in the daily is a gap in the DATA, not
 * proof of a quiet day — the rollup must say so instead of totalling what's left
 * and calling it the day.
 *
 * A failed project whose pulse is already on disk (written by an earlier run for
 * the same date) is not a gap: the narrative can read it.
 */
function deriveFailedProjects(results: ProjectResult[], pulses: PulseForRollup[]): string[] {
  const present = new Set(pulses.map((p) => p.project));
  const failed = new Set(
    results.filter((r) => r.status === "failed" && !present.has(r.project)).map((r) => r.project),
  );
  return [...failed].sort();
}

async function collectPulsesForDate(vaultPath: string, date: string): Promise<PulseForRollup[]> {
  const projectsDir = join(vaultPath, "Projects");
  if (!existsSync(projectsDir)) return [];
  // Search recursively: the structure can be flat or nested (Projects/crewtives/acme/app/pulse/...)
  const glob = new Bun.Glob(`**/pulse/${date}-*.md`);
  const pulses: PulseForRollup[] = [];
  for await (const relPath of glob.scan({ cwd: projectsDir, absolute: false })) {
    const absPath = join(projectsDir, relPath);
    const fname = relPath.split("/").pop() ?? "";
    const m = fname.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
    if (!m || !m[2]) continue;
    const project = m[2];
    const content = await readFile(absPath, "utf-8");
    pulses.push({ project, content });
  }
  pulses.sort((a, b) => a.project.localeCompare(b.project));
  return pulses;
}

async function renderViaLLM(
  date: string,
  pulses: PulseForRollup[],
  config: JanusConfig,
  failedProjects: string[],
  runnerOverride?: LLMRunner,
): Promise<string> {
  const template = dailyRollupTemplate;
  const voice = await loadVoiceSpec();

  // Phase 2 U8 — "this day, last year" anchor for the consolidated daily.
  let dayLastYear: { date: string; tldr: string; pulseFilename: string } | null = null;
  try {
    const { loadDayLastYearDaily } = await import("./reflection/anchors.ts");
    dayLastYear = await loadDayLastYearDaily({ vaultPath: config.obsidianVault, today: date });
  } catch {
    // tolerant
  }

  // Phase 3 U7 — Wrapped trickle release. Only applies in the last 7 days of the year.
  let trickleSnippet = "";
  try {
    const { getTrickleSnippetForDate } = await import("./wrapped/trickle.ts");
    const snippet = await getTrickleSnippetForDate({
      config,
      date,
      loadWrappedData: async () => {
        const { aggregateWrappedData } = await import("./wrapped/aggregator.ts");
        const { computePersonality } = await import("./wrapped/personality.ts");
        const data = await aggregateWrappedData({
          config,
          scope: "yearly",
          year: parseInt(date.slice(0, 4), 10),
        });
        try {
          data.personality = await computePersonality({ config, data, deterministicOnly: true });
        } catch {
          // tolerant
        }
        return data;
      },
    });
    if (snippet) trickleSnippet = snippet.text;
  } catch {
    // tolerant
  }

  const prompt = eta.renderString(template, {
    date,
    pulses,
    voice,
    promptVersion: ROLLUP_PROMPT_VERSION,
    dayLastYear,
    trickleSnippet,
    failedProjects,
    expectedProjects: pulses.length + failedProjects.length,
  });
  if (typeof prompt !== "string") throw new Error("daily-rollup template renderer returned non-string");

  const result = await (runnerOverride ?? resolveRunner(config)).run({
    prompt,
    cwd: config.obsidianVault,
    model: config.model!,
    effort: config.effort!,
    fallbackModel: config.fallbackModel,
    sessionId: randomUUID(),
    maxTurns: 5,
    timeoutMs: 10 * 60_000,
    logTag: `daily/${date}`,
  });
  return stripCodeFenceWrap(result.resultText.trim());
}

/**
 * If the LLM wrapped the output in ```markdown ... ```, return the bare
 * content. Idempotent: if there's no wrap, returns as-is.
 */
export function stripCodeFenceWrap(content: string): string {
  const m = content.match(/^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```\s*$/);
  return m ? m[1]! : content;
}

/**
 * Deterministic fallback — plain-text roster + dataview only.
 *
 * Parity with daily-rollup.v6 (R9): NO per-pulse `![[…#TL;DR]]` transclusions,
 * NO `[[…|See full pulse]]` wiki-links, NO Previous/Next date-chain — those
 * bridged the Timeline into every project cluster. Per-project navigation is
 * carried by the dataview (dataview links are not graph edges) and the single
 * dashboard entry point.
 */
export function renderFallback(date: string, pulses: PulseForRollup[], failedProjects: string[] = []): string {
  const monthTag = date.slice(0, 7);
  const expected = pulses.length + failedProjects.length;
  const lines: string[] = [];
  lines.push("---");
  lines.push(`date: ${date}`);
  lines.push(`tags: [daily, daily/${monthTag}, type/daily]`);
  lines.push(`aliases: ["Daily ${date}"]`);
  lines.push(`pulses_count: ${pulses.length}`);
  lines.push(`expected_projects: ${expected}`);
  lines.push(`failed_projects: [${failedProjects.join(", ")}]`);
  lines.push(`fallback_render: true`);
  lines.push("---");
  lines.push("");
  lines.push(`> [!summary]+ Daily ${date}`);
  lines.push(`> ${pulses.length} pulses generated — see the dataview below (deterministic fallback).`);
  lines.push("");
  if (failedProjects.length > 0) {
    lines.push(`> [!warning] Incomplete day`);
    lines.push(`> No pulse for ${failedProjects.join(", ")} — this daily covers ${pulses.length} of ${expected} projects. The day's totals are unknown, not zero.`);
    lines.push("");
  }

  for (const p of pulses) {
    lines.push(`## ${p.project}`);
    lines.push("");
  }

  for (const project of failedProjects) {
    lines.push(`## ${project}`);
    lines.push("");
    lines.push("No pulse generated. Its activity today is unknown.");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("```dataview");
  lines.push("TABLE WITHOUT ID file.link AS Pulse, project, status, commits, risks");
  lines.push(`FROM "Projects"`);
  lines.push(`WHERE contains(tags, "pulse") AND date = date("${date}")`);
  lines.push("SORT project ASC");
  lines.push("```");
  lines.push("");

  lines.push("## Navigation");
  lines.push("");
  lines.push(`- [[Janus Pulse|Global dashboard]]`);
  lines.push("");

  return lines.join("\n");
}

// Compatibility: the legacy daily.test.ts imported renderDailyContent
export function renderDailyContent(date: string, results: ProjectResult[]): string {
  const pulses: PulseForRollup[] = results
    .filter((r) => r.status === "ok")
    .sort((a, b) => a.project.localeCompare(b.project))
    .map((r) => ({ project: r.project, content: r.contentPreview ?? "" }));
  return renderFallback(date, pulses);
}
