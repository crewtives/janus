/**
 * Wrapped HTML output — Phase 3 U5.
 *
 * Self-contained HTML (CSS embebido) que Obsidian renderea en reading mode
 * y que sirve también de source para el PNG export (U6). NO se llama al LLM:
 * todo el contenido es derivable de `WrappedData`.
 *
 * Layout: "Maker Framework" fija 1920×1080 — cuatro tiers (header, hero KPI
 * strip, core strategy, execution trinity) sobre un grid editorial blanco
 * con un único acento rojo (#F40009) reservado para Primary Goal, Success
 * Lens, la celda Trending, achievements destacados y el Primary Engine.
 * Inter Tight; cero esquinas redondeadas; cero gradientes; cero sombras.
 */
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type {
  WrappedData,
  TopTrack,
  PersonalityArchetype,
  PersonalitySignals,
} from "./types.ts";
import type { JanusConfig } from "../../config/types.ts";
import wrappedHtmlTemplateRaw from "../../templates/wrapped.html" with { type: "text" };
import wrappedCssRaw from "../../templates/wrapped.css" with { type: "text" };

// Embedded via import attributes (not readFile) so the templates survive
// `bun build --compile`: under --compile the templates/ dir isn't on disk and a
// readFile resolves to /$bunfs/...wrapped.html → ENOENT. Bun types .html/.css
// imports as bundles even with `type: "text"`; the cast reflects that at runtime
// the attribute wins and we get the file contents as a string.
const wrappedHtmlTemplate = wrappedHtmlTemplateRaw as unknown as string;
const wrappedCss = wrappedCssRaw as unknown as string;

export interface RenderHtmlOptions {
  data: WrappedData;
  config: JanusConfig;
}

export async function renderWrappedHtml(opts: RenderHtmlOptions): Promise<{ path: string; html: string }> {
  const html = await renderWrappedHtmlString(opts.data);
  let outputPath: string;
  if (opts.data.scope === "project") {
    const project = opts.config.projects.find((p) => p.name === opts.data.target);
    if (!project) throw new Error(`Wrapped HTML per-project requiere project ${opts.data.target} en config`);
    outputPath = join(project.obsidianPath, `${opts.data.target}-wrapped-${opts.data.year}.html`);
  } else {
    outputPath = join(opts.config.obsidianVault, "Wrapped", `Wrapped-${opts.data.year}.html`);
  }
  await mkdir(join(outputPath, "..").replace(/\/$/, ""), { recursive: true });
  await Bun.write(outputPath, html);
  return { path: outputPath, html };
}

export async function renderWrappedHtmlString(d: WrappedData): Promise<string> {
  const tpl = wrappedHtmlTemplate;
  const css = wrappedCss;

  const titleSuffix = d.scope === "project" ? ` — ${escapeHtml(d.target)}` : "";
  const archetype = d.personality?.archetype ?? "Unclassified";
  const archetypeSlug = slugify(archetype);

  const thesis = thesisFor(d.personality);
  const ambition = ambitionFor(d);
  const heroCellsHtml = renderHeroCells(d);
  const activity = renderActivity(d);
  const cardsHtml = renderProjectCards(d);
  const badgesHtml = renderTrackBadges(d.topTracks);
  const signalsHtml = renderSignalBars(d.personality?.signals ?? null);
  const themesHtml = renderThemes(d);
  const achievementsHtml = renderAchievements(d);
  const birthdaysHtml = renderBirthdays(d);
  const week = d.biggestWeek;

  const confidence = d.personality?.confidence ?? 0;

  const subs: Record<string, string> = {
    css,
    year: String(d.year),
    titleSuffix,
    personalityArchetype: escapeHtml(archetype),
    personalityArchetypeSlug: archetypeSlug,
    personalityExplanationHtml: emphasizeFirstSentence(d.personality?.explanation ?? "No archetype computed for this period."),
    personalityEvidence: escapeHtml(d.personality?.evidence?.[0] ?? "Signals are too thin to argue otherwise."),

    confidencePct: String(Math.round(clamp(confidence, 0, 1) * 100)),
    confidenceLabel: confidence > 0 ? `${Math.round(confidence * 100)}%` : "—",

    primaryGoalHtml: thesis.primaryGoalHtml,
    primaryGoalSub: thesis.primaryGoalSub,
    successLensHtml: thesis.successLensHtml,
    successLensSub: thesis.successLensSub,
    strategicAssetHeadline: thesis.strategicAsset,

    ambitionHtml: ambition.html,

    heroCellsHtml,

    peakMonth: activity.peakMonth,
    peakValue: formatInt(activity.peakValue),
    activityBarsHtml: activity.barsHtml,

    pulsesActive: formatInt(d.metrics.pulsesActive),
    projectsActive: formatInt(d.metrics.projectsActive),
    projectsTotal: formatInt(d.metrics.projects),
    tracksCompleted: formatInt(d.metrics.tracksCompleted),
    decisionsCanonical: formatInt(d.metrics.decisionsCanonical),

    cardsHtml,
    badgesHtml,
    signalsHtml,
    themesHtml,
    achievementsHtml,
    birthdaysHtml,

    biggestWeekStart: week?.startDate ?? "—",
    biggestWeekEnd: week?.endDate ?? "—",
    biggestWeekDensity: formatInt(week?.density ?? 0),
    biggestWeekBreakdown: week
      ? `${week.pulsesCount} pulses · ${week.decisionsCount} ADR refs`
      : "No densest week recorded",

    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
  };

  let out = tpl;
  for (const [k, v] of Object.entries(subs)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

/* ── Thesis (archetype → header thesis blocks) ────────────────── */

interface Thesis {
  primaryGoalHtml: string;
  primaryGoalSub: string;
  successLensHtml: string;
  successLensSub: string;
  strategicAsset: string;
}

function thesisFor(p: PersonalityArchetype | null): Thesis {
  const base = baseThesis(p?.archetype ?? null);
  return {
    primaryGoalHtml: `<span class="accent">${escapeHtml(base.goalAccent)}</span> ${escapeHtml(base.goalTail)}`,
    primaryGoalSub: base.goalSub,
    successLensHtml: `${escapeHtml(base.lensHead)} <span class="accent">${escapeHtml(base.lensAccent)}</span>`,
    successLensSub: base.lensSub,
    strategicAsset: base.strategicAsset,
  };
}

function baseThesis(archetype: string | null): {
  goalAccent: string; goalTail: string; goalSub: string;
  lensHead: string; lensAccent: string; lensSub: string;
  strategicAsset: string;
} {
  const primary = (archetype ?? "").replace(/^Hybrid:\s*/i, "").split(/\s*\+\s*/)[0]?.trim() ?? "";
  switch (primary) {
    case "The Shipper":
      return {
        goalAccent: "Compound Velocity.",
        goalTail: "Close more than you open.",
        goalSub: "Ship Ratio + Decision Density",
        lensHead: "Tracks Closed",
        lensAccent: "& Canonical ADRs",
        lensSub: "Quantitative + Architectural",
        strategicAsset: "The Decision Graph",
      };
    case "The Refactorer":
      return {
        goalAccent: "Internal Compounding.",
        goalTail: "Sharpen the surface.",
        goalSub: "Cleanup Cadence + Surface Stability",
        lensHead: "Refactor Ratio",
        lensAccent: "& Quiet Wins",
        lensSub: "Code Health + Decision Memory",
        strategicAsset: "The Stable Spine",
      };
    case "The Explorer":
      return {
        goalAccent: "Surface Area.",
        goalTail: "Try more shapes.",
        goalSub: "Project Breadth + Track Diversity",
        lensHead: "Active Projects",
        lensAccent: "& Distinct Tracks",
        lensSub: "Breadth + Coverage",
        strategicAsset: "The Portfolio Frontier",
      };
    case "The Connector":
      return {
        goalAccent: "Cross-Project Signal.",
        goalTail: "Make patterns travel.",
        goalSub: "Track Lineage + ADR Reach",
        lensHead: "Shared Tracks",
        lensAccent: "& Referenced ADRs",
        lensSub: "Lineage + Reuse",
        strategicAsset: "The Shared Vocabulary",
      };
    case "The Marathonner":
      return {
        goalAccent: "Sustained Cadence.",
        goalTail: "Show up daily.",
        goalSub: "Pulse Continuity + Idle Compression",
        lensHead: "Active Days",
        lensAccent: "& Streak Density",
        lensSub: "Rhythm + Persistence",
        strategicAsset: "The Continuous Narrative",
      };
    case "The Conductor":
      return {
        goalAccent: "Orchestration.",
        goalTail: "Route the work.",
        goalSub: "Session Depth + Routing Confidence",
        lensHead: "Multi-Project Days",
        lensAccent: "& Session Density",
        lensSub: "Switching Cost + Cohesion",
        strategicAsset: "The Routing Layer",
      };
    default:
      return {
        goalAccent: "Continuous Narrative.",
        goalTail: "Remember everything.",
        goalSub: "Pulse Continuity + Decision Memory",
        lensHead: "Active Days",
        lensAccent: "& Closed Tracks",
        lensSub: "Rhythm + Resolution",
        strategicAsset: "The Vault",
      };
  }
}

/* ── Overarching ambition ────────────────────────────────────── */

interface Ambition { html: string; }

function ambitionFor(d: WrappedData): Ambition {
  const archetype = d.personality?.archetype ?? "";
  const lines = ambitionLines(archetype.replace(/^Hybrid:\s*/i, "").split(/\s*\+\s*/)[0]?.trim() ?? "");
  const html =
    `<span>${escapeHtml(lines.lead)}</span> ` +
    `<span class="muted">${escapeHtml(lines.tail)}</span>`;
  return { html };
}

function ambitionLines(primary: string): { lead: string; tail: string } {
  switch (primary) {
    case "The Shipper":
      return { lead: "Decide once. Close the loop.", tail: "Don't revisit decisions that are already made." };
    case "The Refactorer":
      return { lead: "Sharpen what already exists.", tail: "Most of the value compounds inside the work, not on top of it." };
    case "The Explorer":
      return { lead: "Open new shapes deliberately.", tail: "Most experiments don't ship — that's the point of running them." };
    case "The Connector":
      return { lead: "Make patterns travel.", tail: "A decision in one project is a draft for the next." };
    case "The Marathonner":
      return { lead: "Show up where the work lives.", tail: "Cadence beats intensity over a full year." };
    case "The Conductor":
      return { lead: "Route attention, not just work.", tail: "What you choose to ignore shapes the rest." };
    default:
      return { lead: "Compound the narrative.", tail: "What was decided, attempted, and abandoned is the engineering memory." };
  }
}

/* ── Hero KPI strip ──────────────────────────────────────────── */

function renderHeroCells(d: WrappedData): string {
  const ship = d.personality?.signals.shipRatio;
  const sessions = d.personality?.signals.sessionsCount ?? null;
  const avgLen = d.personality?.signals.avgSessionLength ?? null;
  const cells: Array<{ num: string; sub?: string; label: string; muted?: boolean }> = [
    { num: formatInt(d.metrics.pulsesActive), sub: `of ${formatInt(d.metrics.pulses)}`, label: "Active Pulses" },
    { num: formatInt(d.metrics.projectsActive), sub: `of ${formatInt(d.metrics.projects)}`, label: "Projects Live" },
    { num: formatInt(d.metrics.tracksCompleted), sub: `+${formatInt(d.metrics.tracksOpen)} open`, label: "Tracks Closed" },
    { num: formatInt(d.metrics.decisionsCanonical), sub: `+${formatInt(d.metrics.decisionsCandidate)} cand.`, label: "Canonical ADRs" },
    d.metrics.commits != null
      ? { num: formatInt(d.metrics.commits), label: "Commits" }
      : { num: "—", label: "Commits", muted: true },
    sessions != null
      ? { num: formatInt(sessions), label: "Sessions" }
      : { num: "—", label: "Sessions", muted: true },
    d.metrics.hoursSessions != null
      ? { num: formatDecimal(d.metrics.hoursSessions, 0), sub: "hrs", label: "Time at Keys" }
      : avgLen != null
        ? { num: formatDecimal(avgLen, 1), sub: "min·avg", label: "Session Length" }
        : { num: "—", label: "Session Length", muted: true },
    ship != null
      ? { num: formatPct(ship), label: "Ship Ratio" }
      : { num: "—", label: "Ship Ratio", muted: true },
  ];

  return cells
    .map((c) => {
      const subHtml = c.sub ? ` <span class="hero-num-sub">${escapeHtml(c.sub)}</span>` : "";
      return `      <div class="hero-cell">
        <div class="hero-num${c.muted ? " muted-num" : ""}">${escapeHtml(c.num)}${subHtml}</div>
        <div class="hero-label">${escapeHtml(c.label)}</div>
      </div>`;
    })
    .join("\n");
}

/* ── Activity monthly chart ──────────────────────────────────── */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function renderActivity(d: WrappedData): { barsHtml: string; peakMonth: string; peakValue: number } {
  const counts = Array.from({ length: 12 }, (_, i) => {
    const key = `${d.year}-${String(i + 1).padStart(2, "0")}`;
    return d.metrics.pulsesByMonth[key] ?? 0;
  });
  const max = Math.max(1, ...counts);
  let peakIdx = 0;
  for (let i = 1; i < 12; i++) if (counts[i]! > counts[peakIdx]!) peakIdx = i;
  const peakValue = counts[peakIdx]!;

  const bars = counts
    .map((v, i) => {
      const pct = Math.round((v / max) * 100);
      const isPeak = i === peakIdx && peakValue > 0;
      return `            <div class="bar${isPeak ? " peak" : ""}" style="height: ${pct}%" title="${MONTHS_SHORT[i]} · ${v}"></div>`;
    })
    .join("\n");

  return {
    barsHtml: bars,
    peakMonth: MONTHS_SHORT[peakIdx]!,
    peakValue,
  };
}

/* ── Project portfolio cards ─────────────────────────────────── */

function renderProjectCards(d: WrappedData): string {
  const tags = ["LEADS", "FOLLOWS", "PUNCTUATE"];
  const ranking = topProjects(d.topTracks).slice(0, 3);

  const cards: string[] = [];

  for (let i = 0; i < 3; i++) {
    const row = ranking[i];
    if (!row) {
      cards.push(`          <div class="card">
            <div class="card-head">
              <div class="card-name muted">—</div>
              <span class="status-tag soft">RESERVED</span>
            </div>
            <div class="card-body">Slot open for the next active project.</div>
            <div class="card-stats">
              <div><div class="card-stat-num muted">—</div><div class="card-stat-label">Mentions</div></div>
              <div><div class="card-stat-num muted">—</div><div class="card-stat-label">Tracks</div></div>
            </div>
          </div>`);
      continue;
    }
    const tag = tags[i]!;
    const tagClass = i === 0 ? "" : "soft";
    const lead = row.topTrack;
    const body = lead
      ? `Leading thread: <strong>${escapeHtml(lead.slug)}</strong> — ${lead.status} as of ${escapeHtml(lead.lastMentioned)}.`
      : `No active track recorded this year.`;
    cards.push(`          <div class="card">
            <div class="card-head">
              <div class="card-name">${escapeHtml(row.project)}</div>
              <span class="status-tag ${tagClass}">${tag}</span>
            </div>
            <div class="card-body">${body}</div>
            <div class="card-stats">
              <div><div class="card-stat-num">${formatInt(row.totalMentions)}</div><div class="card-stat-label">Mentions</div></div>
              <div><div class="card-stat-num">${formatInt(row.tracksInProject)}</div><div class="card-stat-label">Tracks</div></div>
            </div>
          </div>`);
  }

  return cards.join("\n");
}

interface ProjectRow { project: string; totalMentions: number; tracksInProject: number; topTrack: TopTrack | null; }

function topProjects(tracks: TopTrack[]): ProjectRow[] {
  const map = new Map<string, { mentions: number; trackCount: number; lead: TopTrack | null }>();
  for (const t of tracks) {
    const cur = map.get(t.project) ?? { mentions: 0, trackCount: 0, lead: null };
    cur.mentions += t.mentionsCount;
    cur.trackCount += 1;
    if (!cur.lead || t.mentionsCount > cur.lead.mentionsCount) cur.lead = t;
    map.set(t.project, cur);
  }
  return [...map.entries()]
    .map(([project, v]) => ({ project, totalMentions: v.mentions, tracksInProject: v.trackCount, topTrack: v.lead }))
    .sort((a, b) => b.totalMentions - a.totalMentions);
}

/* ── Track badges row ────────────────────────────────────────── */

function renderTrackBadges(tracks: TopTrack[]): string {
  const top = tracks.slice(0, 5);
  if (top.length === 0) {
    return `            <div class="output-badge"><span class="output-badge-text" style="color: var(--zinc-400);">No tracks recorded</span></div>`;
  }
  return top
    .map((t) => `            <div class="output-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
              <span class="output-badge-text">${escapeHtml(t.slug)}</span>
              <span class="output-badge-meta">${formatInt(t.mentionsCount)}×</span>
            </div>`)
    .join("\n");
}

/* ── Signal bars (personality.signals) ──────────────────────── */

function renderSignalBars(signals: PersonalitySignals | null): string {
  if (!signals) {
    return Array.from({ length: 6 })
      .map(() => `          <div class="signal-row"><div class="signal-label muted">—</div><div class="signal-track"></div><div class="signal-value dim">—</div></div>`)
      .join("\n");
  }

  const rows: Array<{ label: string; ratio: number | null; display: string }> = [
    { label: "Ship", ratio: signals.shipRatio, display: formatPct(signals.shipRatio) },
    { label: "Refactor", ratio: signals.refactorRatio ?? null, display: signals.refactorRatio == null ? "—" : formatPct(signals.refactorRatio) },
    { label: "Explore", ratio: signals.exploreSpread, display: formatPct(signals.exploreSpread) },
    { label: "Connector", ratio: signals.connectorRatio, display: formatPct(signals.connectorRatio) },
    { label: "Session·Len", ratio: normalize(signals.avgSessionLength, 60), display: signals.avgSessionLength == null ? "—" : `${formatDecimal(signals.avgSessionLength, 0)}m` },
    { label: "Session·#", ratio: normalize(signals.sessionsCount, 300), display: formatInt(signals.sessionsCount) },
  ];

  return rows.map(renderSignalRow).join("\n");
}

function renderSignalRow(r: { label: string; ratio: number | null; display: string }): string {
  const filled = r.ratio == null ? 0 : Math.round(clamp(r.ratio, 0, 1) * 10);
  const cells = Array.from({ length: 10 })
    .map((_, i) => `<div class="signal-cell${i < filled ? " on" : ""}"></div>`)
    .join("");
  const valueClass = r.ratio == null ? "dim" : "";
  return `          <div class="signal-row"><div class="signal-label">${escapeHtml(r.label)}</div><div class="signal-track">${cells}</div><div class="signal-value ${valueClass}">${escapeHtml(r.display)}</div></div>`;
}

/* ── Themes ──────────────────────────────────────────────────── */

function renderThemes(d: WrappedData): string {
  const themes = d.themes.slice(0, 3);
  if (themes.length === 0) {
    return `          <div class="theme-row"><div class="theme-marker">·</div><div class="muted">No themes extracted from monthlies.</div></div>`;
  }
  return themes
    .map((t, i) => {
      const marker = String(i + 1).padStart(2, "0");
      return `          <div class="theme-row"><div class="theme-marker">${marker}</div><div>${escapeHtml(t)}</div></div>`;
    })
    .join("\n");
}

/* ── Achievements ────────────────────────────────────────────── */

interface Achievement { key: string; name: string; meta: string; iconPath: string; featured?: boolean; }

function renderAchievements(d: WrappedData): string {
  const list = computeAchievements(d);
  const top = list.slice(0, 6);
  while (top.length < 6) {
    top.push({ key: "locked", name: "Locked", meta: "—", iconPath: ICONS.lock, featured: false });
  }

  return top
    .map((a) => {
      const isLocked = a.key === "locked";
      const classes = ["ach-card"];
      if (isLocked) classes.push("locked");
      if (a.featured) classes.push("featured");
      return `          <div class="${classes.join(" ")}">
            <svg class="ach-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${a.iconPath}</svg>
            <div>
              <div class="ach-name">${escapeHtml(a.name)}</div>
              <div class="ach-meta">${escapeHtml(a.meta)}</div>
            </div>
          </div>`;
    })
    .join("\n");
}

function computeAchievements(d: WrappedData): Achievement[] {
  const m = d.metrics;
  const s = d.personality?.signals;
  const week = d.biggestWeek;
  const out: Achievement[] = [];

  if (m.pulsesActive >= 250) out.push({ key: "marathon", name: "Marathon", meta: `${formatInt(m.pulsesActive)} active days`, iconPath: ICONS.flame, featured: true });
  else if (m.pulsesActive >= 100) out.push({ key: "centurion", name: "Centurion", meta: `${formatInt(m.pulsesActive)} active days`, iconPath: ICONS.flame });

  if (m.tracksCompleted > 0 && m.tracksCompleted >= m.tracksOpen) {
    out.push({
      key: "closer",
      name: "Closer",
      meta: `${formatInt(m.tracksCompleted)} closed · ${formatInt(m.tracksOpen)} open`,
      iconPath: ICONS.check,
      featured: m.tracksCompleted >= m.tracksOpen * 2,
    });
  }

  if (m.projectsActive >= 4) out.push({ key: "polymath", name: "Polymath", meta: `${formatInt(m.projectsActive)} living projects`, iconPath: ICONS.layers });
  if (m.decisionsCanonical >= 10) out.push({ key: "decider", name: "Decider", meta: `${formatInt(m.decisionsCanonical)} canonical ADRs`, iconPath: ICONS.target });

  if (week && week.density >= 30) out.push({ key: "hotweek", name: "Hot Week", meta: `${formatInt(week.density)} events · ${week.startDate.slice(5)}`, iconPath: ICONS.bolt });

  if (s) {
    if (s.connectorRatio >= 0.25) out.push({ key: "spread", name: "Spread", meta: `${formatPct(s.connectorRatio)} cross-project tracks`, iconPath: ICONS.link });
    if (s.refactorRatio != null && s.refactorRatio >= 0.25) out.push({ key: "sharpener", name: "Sharpener", meta: `${formatPct(s.refactorRatio)} refactor ratio`, iconPath: ICONS.wrench });
    if (s.avgSessionLength != null && s.avgSessionLength >= 30) out.push({ key: "deepwork", name: "Deep Work", meta: `${formatDecimal(s.avgSessionLength, 0)}m avg session`, iconPath: ICONS.clock });
    if (s.sessionsCount >= 200) out.push({ key: "compounder", name: "Compounder", meta: `${formatInt(s.sessionsCount)} sessions`, iconPath: ICONS.box });
    if (s.exploreSpread >= 0.6) out.push({ key: "scout", name: "Scout", meta: `${formatPct(s.exploreSpread)} project spread`, iconPath: ICONS.compass });
  }

  // Decision promotion ratio
  const totalDecisions = m.decisionsCanonical + m.decisionsCandidate;
  if (totalDecisions >= 10) {
    const ratio = m.decisionsCanonical / totalDecisions;
    if (ratio >= 0.4) out.push({ key: "promoter", name: "Promoter", meta: `${formatPct(ratio)} ADR promotion`, iconPath: ICONS.arrowUp });
  }

  if (d.birthdays.length > 0) {
    const total = d.birthdays.reduce((a, b) => a + b.years, 0);
    out.push({ key: "anniversary", name: "Anniversary", meta: `${formatInt(total)} project-years`, iconPath: ICONS.gift });
  }

  // Empty fallback
  if (out.length === 0) {
    out.push({ key: "year-one", name: "Year One", meta: "First wrapped on record", iconPath: ICONS.crown });
  }

  return out;
}

/* ── Birthdays ───────────────────────────────────────────────── */

function renderBirthdays(d: WrappedData): string {
  if (d.birthdays.length === 0) return "";
  return d.birthdays
    .slice(0, 4)
    .map((b) => `            <div class="birthday-pill">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${ICONS.gift}</svg>
              <span>${escapeHtml(b.project)} · YR ${b.years}</span>
            </div>`)
    .join("\n");
}

/* ── Lucide SVG paths ────────────────────────────────────────── */

const ICONS = {
  check: `<path d="M20 6 9 17l-5-5"/>`,
  flame: `<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>`,
  layers: `<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="M2 12 11.18 16.18a2 2 0 0 0 1.66 0L22 12"/><path d="M2 17 11.18 21.18a2 2 0 0 0 1.66 0L22 17"/>`,
  target: `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`,
  bolt: `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  link: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  wrench: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>`,
  clock: `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  box: `<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>`,
  compass: `<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>`,
  arrowUp: `<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>`,
  gift: `<rect x="3" y="8" width="18" height="4"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C9 3 12 8 12 8s3-5 4.5-5a2.5 2.5 0 0 1 0 5"/>`,
  crown: `<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.733H5.81a1 1 0 0 1-.957-.733L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>`,
  lock: `<rect x="3" y="11" width="18" height="11"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
};

/* ── Helpers ──────────────────────────────────────────────────── */

function emphasizeFirstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^([^.!?]+[.!?])\s*(.*)$/s);
  if (!match) return `<strong>${escapeHtml(trimmed)}</strong>`;
  const [, head, tail] = match;
  if (!tail) return `<strong>${escapeHtml(head!)}</strong>`;
  return `<strong>${escapeHtml(head!)}</strong> ${escapeHtml(tail)}`;
}

function formatInt(n: number): string { return new Intl.NumberFormat("en-US").format(n); }
function formatDecimal(n: number, decimals: number): string { return n.toFixed(decimals); }
function formatPct(n: number): string { return `${Math.round(clamp(n, 0, 1) * 100)}%`; }

function clamp(n: number, min: number, max: number): number { return Math.min(max, Math.max(min, n)); }

function normalize(n: number | null, max: number): number | null {
  if (n == null) return null;
  return clamp(n / max, 0, 1);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
