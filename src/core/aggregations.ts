import { mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Eta } from "eta";
import type { JanusConfig } from "../config/types.ts";
import { resolveRunner } from "../runners/registry.ts";
import { stripCodeFenceWrap } from "./daily.ts";
import { materializeTracks } from "./tracks.ts";
import { loadVoiceSpec } from "./template.ts";
import quarterlyRetroTemplate from "../prompts/quarterly-retro.v3.md" with { type: "text" };
import yearlyRetroTemplate from "../prompts/yearly-retro.v3.md" with { type: "text" };

export const QUARTERLY_PROMPT_VERSION = "v3" as const;
export const YEARLY_PROMPT_VERSION = "v3" as const;

const eta = new Eta({ autoEscape: false, rmWhitespace: false });

export interface QuarterlyResult {
  path: string;
  quarter: string;
  monthsCovered: number;
  weekliesUncovered: number;
  tracksMaterialized: number;
}

export interface YearlyResult {
  path: string;
  year: string;
  quartersCovered: number;
  tracksMaterialized: number;
}

/** Parses Q-string "YYYY-QN" → {year, quarter, startDate, endDate, days}. */
export function parseQuarter(q: string): { year: number; quarter: number; startDate: string; endDate: string; days: number } {
  const m = q.match(/^(\d{4})-Q([1-4])$/);
  if (!m) throw new Error(`Quarter invalid: ${q} (expected YYYY-QN)`);
  const year = parseInt(m[1]!, 10);
  const quarter = parseInt(m[2]!, 10);
  const startMonth = (quarter - 1) * 3; // 0,3,6,9
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0); // last day of the last month
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return { year, quarter, startDate: fmt(start), endDate: fmt(end), days };
}

export async function writeQuarterlyRetro(opts: {
  vaultPath: string;
  quarter: string; // YYYY-QN
  config: JanusConfig;
}): Promise<QuarterlyResult | null> {
  const { startDate, endDate, days } = parseQuarter(opts.quarter);

  const monthlies = await collectMonthlies(opts.vaultPath, startDate, endDate);
  const weeklies = await collectWeeklies(opts.vaultPath, startDate, endDate);

  if (monthlies.length === 0 && weeklies.length === 0) {
    console.warn(`[quarterly] no data in ${opts.quarter}`);
    return null;
  }

  // Weeklies "not covered" by any monthly of the quarter
  const monthsCovered = new Set(monthlies.map((m) => m.month));
  const uncoveredWeeklies = weeklies.filter((w) => !monthsCovered.has(w.endDate.slice(0, 7)));

  const template = quarterlyRetroTemplate;
  const voice = await loadVoiceSpec();
  const prompt = eta.renderString(template, {
    quarter: opts.quarter,
    startDate,
    endDate,
    days,
    projects: opts.config.projects.map((p) => p.name),
    monthlies,
    uncoveredWeeklies,
    voice,
    promptVersion: QUARTERLY_PROMPT_VERSION,
  });
  if (typeof prompt !== "string") throw new Error("quarterly template render fail");

  const result = await resolveRunner(opts.config).run({
    prompt,
    cwd: opts.vaultPath,
    model: opts.config.model!,
    effort: opts.config.effort!,
    fallbackModel: opts.config.fallbackModel,
    sessionId: randomUUID(),
    maxTurns: 5,
    timeoutMs: 25 * 60_000,
    logTag: `quarterly/${opts.quarter}`,
  });

  const path = join(opts.vaultPath, "Timeline", "Quarterly", `${opts.quarter}.md`);
  await mkdir(dirname(path), { recursive: true });
  const md = stripCodeFenceWrap(result.resultText.trim());
  await Bun.write(path, md);

  let tracksMaterialized = 0;
  try {
    const mr = await materializeTracks({
      vaultPath: opts.vaultPath,
      weeklyFilename: basename(path, ".md"),
      weeklyMarkdown: md,
    });
    tracksMaterialized = mr.tracksWritten;
  } catch (err) {
    console.warn(`[quarterly] materializeTracks failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { path, quarter: opts.quarter, monthsCovered: monthlies.length, weekliesUncovered: uncoveredWeeklies.length, tracksMaterialized };
}

export async function writeYearlyRetro(opts: {
  vaultPath: string;
  year: string; // YYYY
  config: JanusConfig;
}): Promise<YearlyResult | null> {
  const startDate = `${opts.year}-01-01`;
  const endDate = `${opts.year}-12-31`;

  const quarterlies = await collectQuarterlies(opts.vaultPath, opts.year);
  if (quarterlies.length === 0) {
    console.warn(`[yearly] no quarterlies in ${opts.year}`);
    return null;
  }

  const template = yearlyRetroTemplate;
  const voice = await loadVoiceSpec();
  const prompt = eta.renderString(template, {
    year: opts.year,
    startDate,
    endDate,
    projects: opts.config.projects.map((p) => p.name),
    quarterlies,
    voice,
    promptVersion: YEARLY_PROMPT_VERSION,
  });
  if (typeof prompt !== "string") throw new Error("yearly template render fail");

  const result = await resolveRunner(opts.config).run({
    prompt,
    cwd: opts.vaultPath,
    model: opts.config.model!,
    effort: opts.config.effort!,
    fallbackModel: opts.config.fallbackModel,
    sessionId: randomUUID(),
    maxTurns: 5,
    timeoutMs: 30 * 60_000,
    logTag: `yearly/${opts.year}`,
  });

  const path = join(opts.vaultPath, "Timeline", "Yearly", `${opts.year}-yearly.md`);
  await mkdir(dirname(path), { recursive: true });
  const md = stripCodeFenceWrap(result.resultText.trim());
  await Bun.write(path, md);

  let tracksMaterialized = 0;
  try {
    const mr = await materializeTracks({
      vaultPath: opts.vaultPath,
      weeklyFilename: basename(path, ".md"),
      weeklyMarkdown: md,
    });
    tracksMaterialized = mr.tracksWritten;
  } catch (err) {
    console.warn(`[yearly] materializeTracks failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { path, year: opts.year, quartersCovered: quarterlies.length, tracksMaterialized };
}

async function collectMonthlies(vaultPath: string, startDate: string, endDate: string): Promise<Array<{ month: string; content: string }>> {
  const dir = join(vaultPath, "Timeline", "Monthly");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: Array<{ month: string; content: string }> = [];
  for (const name of entries) {
    const m = name.match(/^(\d{4}-\d{2})-monthly\.md$/);
    if (!m) continue;
    const monthStr = m[1]!;
    const monthStart = `${monthStr}-01`;
    if (monthStart < startDate || monthStart > endDate) continue;
    const content = await readFile(join(dir, name), "utf-8");
    out.push({ month: monthStr, content });
  }
  out.sort((a, b) => a.month.localeCompare(b.month));
  return out;
}

async function collectWeeklies(vaultPath: string, startDate: string, endDate: string): Promise<Array<{ date: string; endDate: string; content: string }>> {
  const dir = join(vaultPath, "Timeline", "Weekly");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: Array<{ date: string; endDate: string; content: string }> = [];
  for (const name of entries) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-week\.md$/);
    if (!m) continue;
    const endD = m[1]!;
    if (endD < startDate || endD > endDate) continue;
    const content = await readFile(join(dir, name), "utf-8");
    out.push({ date: endD, endDate: endD, content });
  }
  out.sort((a, b) => a.endDate.localeCompare(b.endDate));
  return out;
}

async function collectQuarterlies(vaultPath: string, year: string): Promise<Array<{ quarter: string; content: string }>> {
  const dir = join(vaultPath, "Timeline", "Quarterly");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: Array<{ quarter: string; content: string }> = [];
  for (const name of entries) {
    const m = name.match(/^(\d{4})-Q([1-4])\.md$/);
    if (!m || m[1] !== year) continue;
    const content = await readFile(join(dir, name), "utf-8");
    out.push({ quarter: `${m[1]}-Q${m[2]}`, content });
  }
  out.sort((a, b) => a.quarter.localeCompare(b.quarter));
  return out;
}

export function currentQuarterOf(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})/);
  if (!m) throw new Error(`invalid date: ${date}`);
  const month = parseInt(m[2]!, 10);
  const q = Math.ceil(month / 3);
  return `${m[1]}-Q${q}`;
}

export function previousQuarter(quarter: string): string {
  const { year, quarter: q } = parseQuarter(quarter);
  if (q === 1) return `${year - 1}-Q4`;
  return `${year}-Q${q - 1}`;
}
