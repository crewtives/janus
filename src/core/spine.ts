import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Eta } from "eta";
import type { JanusConfig, ProjectConfig } from "../config/types.ts";
import { resolveRunner } from "../runners/registry.ts";
import { stripCodeFenceWrap } from "./daily.ts";
import { readStrategy } from "./obsidian.ts";
import { detectStrategyStatus } from "./strategy-status.ts";
import { loadActiveTracks } from "./active-tracks.ts";
import { listAdrs } from "./adr.ts";
import { loadVoiceSpec } from "./template.ts";
import projectSpineTemplate from "../prompts/project-spine.v4.md" with { type: "text" };

export const SPINE_PROMPT_VERSION = "v4" as const;
const SPINE_RECENT_WEEKLIES = 3;
const SPINE_RECENT_PULSES_DAYS = 14;

const eta = new Eta({ autoEscape: false, rmWhitespace: false });

export interface SpineWriteResult {
  path: string;
  project: string;
  hadPreviousSpine: boolean;
  weekliesIncluded: number;
  pulsesIncluded: number;
  tracksIncluded: number;
  adrsIncluded: number;
}

interface WeeklyForSpine {
  date: string;
  content: string;
}

interface PulseForSpine {
  date: string;
  status: string;
  tldr: string;
}

/**
 * Generates/regenerates a project's Spine: a continuous narrative note that
 * serves as the primary document for understanding the project.
 *
 * Path: `<obsidianPath>/<project>-spine.md`. Overwrites the previous version
 * but PASSES the old content to the LLM to maintain continuity.
 */
export async function writeProjectSpine(opts: {
  vaultPath: string;
  project: ProjectConfig;
  config: JanusConfig;
  /** Reference date for "today". Default: today. */
  today?: string;
}): Promise<SpineWriteResult | null> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const spinePath = join(opts.project.obsidianPath, `${opts.project.name}-spine.md`);
  const previousSpine = existsSync(spinePath) ? await readFile(spinePath, "utf-8") : null;

  const [strategyMd, roadmap, strategyStatus, activeTracks, projectAdrs] = await Promise.all([
    readStrategy(opts.project.obsidianPath, opts.project.repoPath),
    existsSync(join(opts.project.obsidianPath, "_roadmap.md"))
      ? readFile(join(opts.project.obsidianPath, "_roadmap.md"), "utf-8")
      : Promise.resolve<string | null>(null),
    detectStrategyStatus({ obsidianPath: opts.project.obsidianPath, repoPath: opts.project.repoPath, currentDate: today }),
    loadActiveTracks({ vaultPath: opts.vaultPath, project: opts.project.name }),
    listAdrs(opts.vaultPath).then((all) => all.filter((a) => a.project === opts.project.name)),
  ]);

  const recentWeeklies = await collectRecentWeeklies(opts.vaultPath, SPINE_RECENT_WEEKLIES);
  const recentPulses = await collectRecentNonIdlePulses(opts.project, today, SPINE_RECENT_PULSES_DAYS);

  // If there is NOTHING significant (no previous spine, no weeklies, no pulses, no tracks), skip.
  if (!previousSpine && recentWeeklies.length === 0 && recentPulses.length === 0 && activeTracks.length === 0) {
    return null;
  }

  const template = projectSpineTemplate;
  const voice = await loadVoiceSpec();
  const prompt = eta.renderString(template, {
    project: opts.project.name,
    generatedAt: today,
    previousSpine: previousSpine?.trim() ?? null,
    strategyMd: strategyMd ?? "",
    strategyStatus: strategyStatus.status,
    roadmap: roadmap ?? "",
    recentWeeklies,
    recentPulses,
    activeTracks: activeTracks.map((t) => ({ slug: t.slug, name: t.name, status: t.status })),
    projectAdrs: projectAdrs.map((a) => ({ filename: a.filename, number: a.number, status: a.status, title: a.title })),
    voice,
    promptVersion: SPINE_PROMPT_VERSION,
  });
  if (typeof prompt !== "string") throw new Error("spine template render fail");

  const result = await resolveRunner(opts.config).run({
    prompt,
    cwd: opts.vaultPath,
    model: opts.config.model!,
    effort: opts.config.effort!,
    fallbackModel: opts.config.fallbackModel,
    sessionId: randomUUID(),
    maxTurns: 5,
    timeoutMs: 15 * 60_000,
    logTag: `spine/${opts.project.name}`,
  });

  await mkdir(dirname(spinePath), { recursive: true });
  const spineMd = stripCodeFenceWrap(result.resultText.trim());
  await Bun.write(spinePath, spineMd);

  // Index the spine in FTS5 (best-effort, non-fatal).
  try {
    const { SearchIndex } = await import("./search-index.ts");
    const idx = SearchIndex.open(opts.config.stateDir!);
    const docId = spinePath.startsWith(opts.vaultPath)
      ? spinePath.slice(opts.vaultPath.length).replace(/^\/+/, "")
      : spinePath;
    const body = spineMd.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    const titleM = body.match(/^#\s+(.+)$/m);
    const title = titleM?.[1]?.trim() ?? `${opts.project.name} Spine`;
    idx.upsert({
      docId,
      project: opts.project.name,
      date: today,
      kind: "spine",
      status: null,
      title,
      body,
    });
    idx.close();
  } catch (err) {
    console.warn(`[spine] index FTS5 failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    path: spinePath,
    project: opts.project.name,
    hadPreviousSpine: previousSpine !== null,
    weekliesIncluded: recentWeeklies.length,
    pulsesIncluded: recentPulses.length,
    tracksIncluded: activeTracks.length,
    adrsIncluded: projectAdrs.length,
  };
}

async function collectRecentWeeklies(vaultPath: string, limit: number): Promise<WeeklyForSpine[]> {
  const dir = join(vaultPath, "Timeline", "Weekly");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const weeklies: WeeklyForSpine[] = [];
  for (const name of entries) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-week\.md$/);
    if (!m) continue;
    const content = await readFile(join(dir, name), "utf-8");
    weeklies.push({ date: m[1]!, content });
  }
  weeklies.sort((a, b) => b.date.localeCompare(a.date));
  return weeklies.slice(0, limit);
}

async function collectRecentNonIdlePulses(
  project: ProjectConfig,
  today: string,
  daysBack: number,
): Promise<PulseForSpine[]> {
  const dir = join(project.obsidianPath, "pulse");
  if (!existsSync(dir)) return [];
  const cutoff = new Date(`${today}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  const entries = await readdir(dir);
  const out: PulseForSpine[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-/);
    if (!m) continue;
    const date = m[1]!;
    if (date < cutoffISO || date > today) continue;
    const content = await readFile(join(dir, name), "utf-8");
    const statusM = content.match(/^status:\s*(.+)$/m);
    const status = statusM?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "?";
    if (status === "idle" || status === "idle-streak" || status === "quiet-streak") continue;
    // Extract only the TL;DR to keep the prompt short.
    const tldr = extractTldr(content);
    out.push({ date, status, tldr });
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

function extractTldr(content: string): string {
  const tldrMatch = content.match(/##\s+TL;DR\n([\s\S]*?)(?=\n##\s+|\n>\s*\[!|\n```dataview|$)/);
  return tldrMatch?.[1]?.trim() ?? "(no TL;DR)";
}

/**
 * Regenerates the spine for every active/paused project (not archived).
 * Useful as an auto-trigger at the end of the weekly.
 */
export async function writeAllProjectSpines(opts: {
  config: JanusConfig;
  today?: string;
}): Promise<Array<SpineWriteResult | null>> {
  const results: Array<SpineWriteResult | null> = [];
  for (const project of opts.config.projects) {
    if (project.status === "archived") continue;
    try {
      const r = await writeProjectSpine({
        vaultPath: opts.config.obsidianVault,
        project,
        config: opts.config,
        today: opts.today,
      });
      results.push(r);
    } catch (err) {
      console.warn(`[spine] ${project.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      results.push(null);
    }
  }
  return results;
}
