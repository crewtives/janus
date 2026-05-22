/**
 * Wrapped HTML output — Phase 3 U5.
 *
 * Produce un HTML self-contained (CSS embebido) que Obsidian renderea en
 * reading mode. También sirve como source para el PNG export (U6).
 *
 * NO se llama al LLM: el HTML es 100% derivable de `WrappedData`.
 */
import { join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import type { WrappedData } from "./types.ts";
import type { JanusConfig } from "../../config/types.ts";

const TEMPLATE_DIR = join(import.meta.dir, "..", "..", "templates");

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
  const tpl = await readFile(join(TEMPLATE_DIR, "wrapped.html"), "utf-8");
  const css = await readFile(join(TEMPLATE_DIR, "wrapped.css"), "utf-8");

  const titleSuffix = d.scope === "project" ? ` — ${escapeHtml(d.target)}` : "";
  const subtitle = d.scope === "project"
    ? `${d.target} en ${d.year}`
    : `Tu año como maker — ${d.metrics.projectsActive} proyectos vivos en ${d.metrics.pulsesActive} pulses`;

  const archetype = d.personality?.archetype ?? "—";
  const archetypeSlug = archetype.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const topTracksHtml = d.topTracks
    .slice(0, 5)
    .map((t) => `        <li><strong>${escapeHtml(t.slug)}</strong> · ${escapeHtml(t.project)} · ${t.mentionsCount} menciones</li>`)
    .join("\n");

  const subs: Record<string, string> = {
    css,
    year: String(d.year),
    titleSuffix,
    subtitle: escapeHtml(subtitle),
    personalityArchetype: escapeHtml(archetype),
    personalityArchetypeSlug: archetypeSlug,
    personalityExplanation: escapeHtml(d.personality?.explanation ?? "Sin archetype computado todavía."),
    pulsesActive: String(d.metrics.pulsesActive),
    projectsActive: String(d.metrics.projectsActive),
    tracksCompleted: String(d.metrics.tracksCompleted),
    decisionsCanonical: String(d.metrics.decisionsCanonical),
    topTracksHtml: topTracksHtml || `        <li>No hay tracks registrados todavía.</li>`,
    biggestWeekStart: d.biggestWeek?.startDate ?? "—",
    biggestWeekEnd: d.biggestWeek?.endDate ?? "—",
    biggestWeekDensity: String(d.biggestWeek?.density ?? 0),
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
  };

  let out = tpl;
  for (const [k, v] of Object.entries(subs)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
