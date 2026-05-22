/**
 * Wrapped renderer — Phase 3 U2 + U4.
 *
 * Produce el markdown final del Wrapped (yearly o per-project) llamando al LLM
 * con el prompt + WrappedData + personality. El output va a disco.
 *
 * Fallback determinista si LLM falla: renderiza un Wrapped minimal con la
 * data cruda (template determinista). Esto garantiza que `bun janus wrapped`
 * siempre produzca un archivo, aunque sea básico.
 */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Eta } from "eta";
import { mkdir } from "node:fs/promises";
import type { JanusConfig } from "../../config/types.ts";
import type { LLMRunner } from "../../runners/types.ts";
import type { WrappedData } from "./types.ts";
import { loadVoiceSpec } from "../template.ts";
import wrappedYearlyTemplate from "../../prompts/wrapped-yearly.v2.md" with { type: "text" };
import wrappedProjectTemplate from "../../prompts/wrapped-project.v2.md" with { type: "text" };

const eta = new Eta({ autoEscape: false, rmWhitespace: false });

export interface RenderWrappedOptions {
  config: JanusConfig;
  data: WrappedData;
  runnerOverride?: LLMRunner;
  /** Si true, no llama al LLM — produce el template determinista directo. */
  deterministicOnly?: boolean;
}

export interface RenderWrappedResult {
  /** Path absoluto del archivo escrito. */
  path: string;
  /** True si se generó vía LLM, false si fallback determinista. */
  llmGenerated: boolean;
  markdown: string;
}

export async function renderWrapped(opts: RenderWrappedOptions): Promise<RenderWrappedResult> {
  const data = opts.data;
  const isProject = data.scope === "project";

  // Path target.
  let outputPath: string;
  if (isProject) {
    const project = opts.config.projects.find((p) => p.name === data.target);
    if (!project) {
      throw new Error(`Wrapped per-project requiere config.projects con ${data.target}`);
    }
    outputPath = join(project.obsidianPath, `${data.target}-wrapped-${data.year}.md`);
  } else {
    outputPath = join(opts.config.obsidianVault, "Wrapped", `Wrapped-${data.year}.md`);
  }

  // LLM path.
  if (!opts.deterministicOnly) {
    try {
      const tpl = isProject ? wrappedProjectTemplate : wrappedYearlyTemplate;
      const voice = await loadVoiceSpec();
      const prompt = renderTemplate(tpl, { voice, data });

      let runner: LLMRunner;
      if (opts.runnerOverride) {
        runner = opts.runnerOverride;
      } else {
        const { resolveRunner } = await import("../../runners/registry.ts");
        runner = resolveRunner(opts.config);
      }
      const r = await runner.run({
        prompt,
        cwd: opts.config.obsidianVault,
        model: opts.config.model ?? "claude-sonnet-4-6",
        effort: opts.config.effort ?? "high",
        fallbackModel: opts.config.fallbackModel,
        sessionId: randomUUID(),
        maxTurns: 3,
        timeoutMs: 10 * 60_000,
        logTag: `wrapped-${data.scope}/${data.year}`,
      });
      let md = r.resultText.trim();
      // Pelar code fence si el modelo se equivoca.
      const fence = md.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/);
      if (fence) md = fence[1]!.trim();
      if (md.startsWith("---")) {
        await mkdir(join(outputPath, "..").replace(/\/$/, ""), { recursive: true });
        await Bun.write(outputPath, md);
        return { path: outputPath, llmGenerated: true, markdown: md };
      }
      console.warn(`[wrapped] output del LLM no empieza con ---, fallback determinista`);
    } catch (err) {
      console.warn(`[wrapped] LLM failed, falling back to deterministic: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Fallback determinista.
  const md = renderDeterministic(data);
  await mkdir(join(outputPath, "..").replace(/\/$/, ""), { recursive: true });
  await Bun.write(outputPath, md);
  return { path: outputPath, llmGenerated: false, markdown: md };
}

function renderTemplate(tpl: string, ctx: { voice: string; data: WrappedData }): string {
  const d = ctx.data;
  const personality = d.personality;
  // Eta usa <%= it.x %>; pero los prompts usan {{...}} placeholders simples para
  // legibilidad. Hacemos sustitución manual con un mapa.
  const substitutions: Record<string, string> = {
    voice: ctx.voice,
    year: String(d.year),
    project: d.target,
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    pulsesActive: String(d.metrics.pulsesActive),
    projectsActive: String(d.metrics.projectsActive),
    projects: String(d.metrics.projects),
    tracksCompleted: String(d.metrics.tracksCompleted),
    tracksOpen: String(d.metrics.tracksOpen),
    decisionsCanonical: String(d.metrics.decisionsCanonical),
    decisionsCandidate: String(d.metrics.decisionsCandidate),
    personalityArchetype: personality?.archetype ?? "—",
    personalityExplanation: personality?.explanation ?? "—",
    evidence: (personality?.evidence ?? []).join("; "),
    biggestWeekStart: d.biggestWeek?.startDate ?? "—",
    biggestWeekEnd: d.biggestWeek?.endDate ?? "—",
    biggestWeekDensity: String(d.biggestWeek?.density ?? 0),
    topDecisionAdr: d.topDecisions[0]?.adrId ?? "—",
    topDecisionRefs: String(d.topDecisions[0]?.references ?? 0),
    anniversaryYears: String(d.birthdays.find((b) => b.project === d.target)?.years ?? 0),
    birthDate: d.birthdays.find((b) => b.project === d.target)?.birthDate ?? "—",
    dataJson: JSON.stringify(d, null, 2),
  };

  let out = tpl;
  for (const [k, v] of Object.entries(substitutions)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

export function renderDeterministic(d: WrappedData): string {
  const isProject = d.scope === "project";
  const titleSuffix = isProject ? ` — ${d.target}` : "";
  const lines: string[] = [];
  lines.push("---");
  lines.push(`type: ${isProject ? "wrapped-project" : "wrapped-yearly"}`);
  if (isProject) lines.push(`project: ${d.target}`);
  lines.push(`year: ${d.year}`);
  lines.push(`period_start: ${d.periodStart}`);
  lines.push(`period_end: ${d.periodEnd}`);
  lines.push(`pulses: ${d.metrics.pulsesActive}`);
  lines.push(`projects: ${d.metrics.projectsActive}`);
  lines.push(`tracks_completed: ${d.metrics.tracksCompleted}`);
  lines.push(`decisions: ${d.metrics.decisionsCanonical}`);
  if (d.personality) lines.push(`personality: "${d.personality.archetype}"`);
  const tags = isProject
    ? `[wrapped, wrapped/project, wrapped/${d.target}, wrapped/${d.year}]`
    : `[wrapped, wrapped/yearly, wrapped/${d.year}]`;
  lines.push(`tags: ${tags}`);
  lines.push(`aliases: ["Janus Wrapped ${d.year}${titleSuffix}"]`);
  lines.push(`prompt_version: deterministic-fallback`);
  lines.push("---");
  lines.push("");
  lines.push(`# Janus Wrapped ${d.year}${titleSuffix}`);
  lines.push("");
  lines.push(`> [!warning]- Wrapped generated in deterministic mode (LLM unavailable).`);
  lines.push(`> Re-run \`bun janus wrapped --year ${d.year}${isProject ? ` --project ${d.target}` : ""}\` once the provider is back online.`);
  lines.push("");

  lines.push("## Your year in numbers");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Active pulses | ${d.metrics.pulsesActive} |`);
  if (!isProject) lines.push(`| Living projects | ${d.metrics.projectsActive} / ${d.metrics.projects} |`);
  lines.push(`| Closed tracks | ${d.metrics.tracksCompleted} |`);
  lines.push(`| Open tracks at close | ${d.metrics.tracksOpen} |`);
  lines.push(`| Canonical decisions | ${d.metrics.decisionsCanonical} |`);
  lines.push(`| Candidate decisions | ${d.metrics.decisionsCandidate} |`);
  lines.push("");

  if (d.personality) {
    lines.push(`## Your maker personality: ${d.personality.archetype}`);
    lines.push("");
    lines.push(`> [!important] ${d.personality.archetype}`);
    lines.push(`> ${d.personality.explanation}`);
    if (d.personality.evidence.length > 0) {
      lines.push(">");
      lines.push("> Evidence:");
      for (const e of d.personality.evidence) lines.push(`> - ${e}`);
    }
    lines.push("");
  }

  if (d.topTracks.length > 0) {
    lines.push("## Top tracks of the year");
    lines.push("");
    for (let i = 0; i < Math.min(d.topTracks.length, 5); i++) {
      const t = d.topTracks[i]!;
      lines.push(`${i + 1}. **${t.slug}** (${t.project}) — ${t.mentionsCount} mentions · status: ${t.status}`);
    }
    lines.push("");
  }

  if (d.biggestWeek) {
    lines.push(`## Densest week: ${d.biggestWeek.startDate} → ${d.biggestWeek.endDate}`);
    lines.push("");
    lines.push(`${d.biggestWeek.density} events: ${d.biggestWeek.pulsesCount} pulses + ${d.biggestWeek.decisionsCount} decisions.`);
    lines.push("");
  }

  if (d.topDecisions.length > 0) {
    const top = d.topDecisions[0]!;
    lines.push(`## Biggest decision: ${top.adrId}`);
    lines.push("");
    lines.push(`> [!quote] ${top.adrId}`);
    lines.push(`> Referenced in ${top.references} pulses across the year (project: ${top.project}).`);
    lines.push("");
  }

  if (d.birthdays.length > 0) {
    lines.push("## Project birthdays");
    lines.push("");
    lines.push("> [!info] Anniversaries this year");
    for (const b of d.birthdays) {
      lines.push(`> - ${b.project} turned **${b.years} years** old since ${b.birthDate}`);
    }
    lines.push("");
  }

  if (d.themes.length > 0) {
    lines.push("## Themes");
    lines.push("");
    for (const t of d.themes) lines.push(`- ${t}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(`_Generated by Janus on ${new Date().toISOString().slice(0, 10)}._`);
  return lines.join("\n");
}
