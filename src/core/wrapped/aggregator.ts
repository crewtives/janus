/**
 * Wrapped data aggregator — Phase 3 U1.
 *
 * Junta TODA la info necesaria para generar un Wrapped (cross-project del año
 * o per-project del proyecto). Solo data — el renderer LLM lo consume.
 *
 * Sources:
 *  - `pulse_state` → métricas: pulses por mes, status, projects activos
 *  - `pulse_index` → TLDRs y secciones por sample
 *  - `track_lineage` → top tracks, ratio open/completed
 *  - `decision_graph` → top decisiones, candidate count
 *  - `project_metadata` → birthdays
 *  - Filesystem `Timeline/Weekly/*.md` + `Timeline/Monthly/*.md` → themes
 */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Checkpoint } from "../checkpoint.ts";
import { getProjectBirthDates } from "../project-metadata.ts";
import type { JanusConfig, ProjectConfig } from "../../config/types.ts";
import { extractTldrFromPulse } from "../reflection/anchors.ts";
import type {
  BiggestWeek,
  ProjectBirthday,
  TopDecision,
  TopTrack,
  WrappedData,
  WrappedMetrics,
  WrappedScope,
} from "./types.ts";

export interface AggregateOptions {
  config: JanusConfig;
  scope: WrappedScope;
  year: number;
  /** Si scope==="project", project name. Ignorado en yearly. */
  project?: string;
  /** Si true, skip lectura de filesystem (themes) — fixture / dry-run rápido. */
  skipFilesystem?: boolean;
}

export async function aggregateWrappedData(opts: AggregateOptions): Promise<WrappedData> {
  if (!opts.config.stateDir) {
    throw new Error("aggregateWrappedData requiere config.stateDir");
  }
  const target = opts.scope === "project" ? (opts.project ?? "_global") : "_global";
  const periodStart = `${opts.year}-01-01`;
  const periodEnd = `${opts.year}-12-31`;

  const cp = Checkpoint.open(opts.config.stateDir);

  const pulses = cp.queryRecent(366 + 31).filter((r) => {
    if (r.date < periodStart || r.date > periodEnd) return false;
    if (opts.scope === "project" && opts.project && r.project !== opts.project) return false;
    return true;
  });

  const metrics = computeMetrics({ cp, pulses, scope: opts.scope, target });

  // Top tracks
  const lineage = cp.listTrackLineage(opts.scope === "project" && opts.project ? { project: opts.project } : undefined);
  const lineageInPeriod = lineage.filter((t) => t.lastMentioned >= periodStart && t.firstSeen <= periodEnd);
  const topTracks: TopTrack[] = lineageInPeriod
    .sort((a, b) => b.mentionsCount - a.mentionsCount)
    .slice(0, 10)
    .map((t) => ({
      slug: t.slug,
      project: t.project,
      mentionsCount: t.mentionsCount,
      firstSeen: t.firstSeen,
      lastMentioned: t.lastMentioned,
      status: t.status,
    }));

  // Top decisions: descartar candidates, agrupar por adrId.
  const refs = cp.listDecisionReferences().filter((r) => {
    if (r.adrId.startsWith("candidate:")) return false;
    if (r.pulseDate < periodStart || r.pulseDate > periodEnd) return false;
    if (opts.scope === "project" && opts.project && r.project !== opts.project) return false;
    return true;
  });
  const decisionCounts = new Map<string, { project: string; count: number }>();
  for (const r of refs) {
    const existing = decisionCounts.get(r.adrId);
    if (existing) existing.count += 1;
    else decisionCounts.set(r.adrId, { project: r.project, count: 1 });
  }
  const topDecisions: TopDecision[] = [...decisionCounts.entries()]
    .map(([adrId, v]) => ({ adrId, project: v.project, references: v.count }))
    .sort((a, b) => b.references - a.references)
    .slice(0, 10);

  // Biggest week — sliding window de 7 días sobre fechas de pulses + ADRs.
  const biggestWeek = computeBiggestWeek({ pulses, refs, periodStart, periodEnd });

  // Birthdays
  const birthdays: ProjectBirthday[] = [];
  if (opts.scope === "yearly") {
    for (const p of opts.config.projects) {
      const bd = await getProjectBirthDates({ project: p, checkpoint: cp });
      if (!bd.earliest) continue;
      const birthYear = parseInt(bd.earliest.slice(0, 4), 10);
      const years = opts.year - birthYear;
      if (years >= 1) {
        birthdays.push({ project: p.name, birthDate: bd.earliest, years });
      }
    }
  } else if (opts.project) {
    const p = opts.config.projects.find((x) => x.name === opts.project);
    if (p) {
      const bd = await getProjectBirthDates({ project: p, checkpoint: cp });
      if (bd.earliest) {
        const birthYear = parseInt(bd.earliest.slice(0, 4), 10);
        const years = opts.year - birthYear;
        if (years >= 1) {
          birthdays.push({ project: p.name, birthDate: bd.earliest, years });
        }
      }
    }
  }

  // Sample TLDRs — los más antiguos, más nuevos, y un medio. Para dar contexto al LLM.
  const sampleTldrs = await sampleTldrsFromPulses({ pulses, scope: opts.scope, project: opts.project, config: opts.config });

  // Themes — extracción simple desde monthlies y yearly.
  const themes = opts.skipFilesystem ? [] : await extractThemes({ vaultPath: opts.config.obsidianVault, year: opts.year, scope: opts.scope, project: opts.project });

  cp.close();

  return {
    scope: opts.scope,
    year: opts.year,
    target,
    periodStart,
    periodEnd,
    metrics,
    topTracks,
    topDecisions,
    biggestWeek,
    birthdays,
    themes,
    sampleTldrs,
    personality: null, // populated por computePersonality (U3)
  };
}

function computeMetrics(args: {
  cp: Checkpoint;
  pulses: ReturnType<Checkpoint["queryRecent"]>;
  scope: WrappedScope;
  target: string;
}): WrappedMetrics {
  const { cp, pulses } = args;
  const projects = new Set<string>();
  const projectsActive = new Set<string>();
  const pulsesByMonth: Record<string, number> = {};
  let pulsesActive = 0;
  for (const p of pulses) {
    projects.add(p.project);
    if (p.status === "done") {
      const month = p.date.slice(0, 7);
      pulsesByMonth[month] = (pulsesByMonth[month] ?? 0) + 1;
      projectsActive.add(p.project);
      pulsesActive += 1; // contamos done; idle/failed no suman
    }
  }

  const allRefs = cp.listDecisionReferences();
  let decisionsCanonical = 0;
  let decisionsCandidate = 0;
  const seenCanonical = new Set<string>();
  for (const r of allRefs) {
    if (r.adrId.startsWith("candidate:")) {
      decisionsCandidate += 1;
    } else if (!seenCanonical.has(r.adrId)) {
      seenCanonical.add(r.adrId);
      decisionsCanonical += 1;
    }
  }

  const lineage = cp.listTrackLineage();
  let tracksOpen = 0;
  let tracksCompleted = 0;
  let tracksArchived = 0;
  for (const t of lineage) {
    if (t.status === "open") tracksOpen += 1;
    else if (t.status === "completed") tracksCompleted += 1;
    else if (t.status === "archived") tracksArchived += 1;
  }

  return {
    pulses: pulses.length,
    pulsesActive,
    projects: projects.size,
    projectsActive: projectsActive.size,
    decisionsCanonical,
    decisionsCandidate,
    tracksOpen,
    tracksCompleted,
    tracksArchived,
    hoursSessions: null,   // no medimos sesiones todavía en aggregate
    commits: null,         // idem
    pulsesByMonth,
  };
}

function computeBiggestWeek(args: {
  pulses: Array<{ date: string }>;
  refs: Array<{ pulseDate: string }>;
  periodStart: string;
  periodEnd: string;
}): BiggestWeek | null {
  if (args.pulses.length === 0 && args.refs.length === 0) return null;
  // Buckets por día → suma rolling de 7 días.
  const dayDensity = new Map<string, { pulses: number; decisions: number }>();
  for (const p of args.pulses) {
    const d = dayDensity.get(p.date) ?? { pulses: 0, decisions: 0 };
    d.pulses += 1;
    dayDensity.set(p.date, d);
  }
  for (const r of args.refs) {
    const d = dayDensity.get(r.pulseDate) ?? { pulses: 0, decisions: 0 };
    d.decisions += 1;
    dayDensity.set(r.pulseDate, d);
  }
  const days = [...dayDensity.keys()].sort();
  if (days.length === 0) return null;

  let best: BiggestWeek | null = null;
  for (let i = 0; i < days.length; i++) {
    const startDate = days[i]!;
    const endDate = addDays(startDate, 6);
    if (endDate > args.periodEnd) continue;
    let pulsesCount = 0;
    let decisionsCount = 0;
    for (let j = i; j < days.length; j++) {
      const d = days[j]!;
      if (d > endDate) break;
      const v = dayDensity.get(d)!;
      pulsesCount += v.pulses;
      decisionsCount += v.decisions;
    }
    const density = pulsesCount + decisionsCount;
    if (!best || density > best.density) {
      best = { startDate, endDate, density, pulsesCount, decisionsCount };
    }
  }
  return best;
}

function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function sampleTldrsFromPulses(args: {
  pulses: Array<{ project: string; date: string; outputPath: string | null; status: string }>;
  scope: WrappedScope;
  project?: string;
  config: JanusConfig;
}): Promise<Array<{ date: string; project: string; tldr: string }>> {
  const done = args.pulses.filter((p) => p.status === "done" && p.outputPath);
  if (done.length === 0) return [];
  // Tomamos 5 muestras distribuidas: primero, último, percentiles 25/50/75.
  const indices = [0, Math.floor(done.length * 0.25), Math.floor(done.length * 0.5), Math.floor(done.length * 0.75), done.length - 1];
  const uniqueIndices = [...new Set(indices.filter((i) => i < done.length))];
  const out: Array<{ date: string; project: string; tldr: string }> = [];
  for (const i of uniqueIndices) {
    const p = done[i]!;
    try {
      const content = await readFile(p.outputPath!, "utf-8");
      const tldr = extractTldrFromPulse(content);
      if (tldr) out.push({ date: p.date, project: p.project, tldr });
    } catch {
      // tolerante
    }
  }
  return out;
}

async function extractThemes(args: {
  vaultPath: string;
  year: number;
  scope: WrappedScope;
  project?: string;
}): Promise<string[]> {
  const monthlyDir = join(args.vaultPath, "Timeline", "Monthly");
  if (!existsSync(monthlyDir)) return [];
  let entries: string[] = [];
  try {
    entries = await readdir(monthlyDir);
  } catch {
    return [];
  }
  const yearPrefix = `${args.year}-`;
  const themes = new Set<string>();
  for (const name of entries) {
    if (!name.startsWith(yearPrefix) || !name.endsWith(".md")) continue;
    try {
      const content = await readFile(join(monthlyDir, name), "utf-8");
      // Heurística: extraer headings `### <emoji> <track-name>` que el monthly genera.
      for (const line of content.split("\n")) {
        const m = line.match(/^###\s+(\S+)\s+(.+?)$/);
        if (m) {
          themes.add(`${m[1]} ${m[2]}`.trim());
        }
      }
    } catch {
      // skip
    }
  }
  return [...themes].slice(0, 8);
}
