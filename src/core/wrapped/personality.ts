/**
 * Personality archetypes — Phase 3 U3.
 *
 * 2-step:
 *  1. Compute signals deterministicamente desde state + sessions.
 *  2. LLM call con signals + sample TLDRs → JSON {archetype, explanation, evidence, confidence}.
 *
 * Si el LLM falla o devuelve JSON inválido, devolvemos un archetype computado
 * por regla determinista sobre las señales. El Wrapped siempre tiene un valor.
 */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Eta } from "eta";
import type { JanusConfig } from "../../config/types.ts";
import type { LLMRunner } from "../../runners/types.ts";
import type { PersonalityArchetype, PersonalitySignals, WrappedData } from "./types.ts";
import { Checkpoint } from "../checkpoint.ts";
import { getActivity } from "../git.ts";
import { findSessionsForDate, summarizeSession } from "../sessions.ts";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import wrappedPersonalityTemplate from "../../prompts/wrapped-personality.v2.md" with { type: "text" };

const eta = new Eta({ autoEscape: false, rmWhitespace: false });

export interface ComputePersonalityOptions {
  config: JanusConfig;
  data: WrappedData;
  runnerOverride?: LLMRunner;
  /** Si true, no llama al LLM — usa la regla determinista. */
  deterministicOnly?: boolean;
}

export async function computePersonality(
  opts: ComputePersonalityOptions,
): Promise<PersonalityArchetype> {
  const signals = await computeSignals(opts.config, opts.data);

  if (opts.deterministicOnly) {
    return deterministicArchetype(signals);
  }

  // LLM pass (best-effort).
  try {
    const prompt = eta.renderString(wrappedPersonalityTemplate, {
      year: opts.data.year,
      signalsJson: JSON.stringify(signals, null, 2),
      sampleTldrsJson: JSON.stringify(opts.data.sampleTldrs, null, 2),
    });
    if (typeof prompt !== "string") return deterministicArchetype(signals);

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
      effort: opts.config.effort ?? "medium",
      fallbackModel: opts.config.fallbackModel,
      sessionId: randomUUID(),
      maxTurns: 3,
      timeoutMs: 5 * 60_000,
      logTag: `wrapped-personality/${opts.data.year}`,
    });
    const parsed = parsePersonalityJson(r.resultText, signals);
    if (parsed) return parsed;
  } catch (err) {
    console.warn(`[wrapped] personality LLM failed, falling back to deterministic: ${err instanceof Error ? err.message : String(err)}`);
  }
  return deterministicArchetype(signals);
}

export function parsePersonalityJson(
  text: string,
  signals: PersonalitySignals,
): PersonalityArchetype | null {
  let payload = text.trim();
  const fence = payload.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) payload = fence[1]!.trim();
  const firstBrace = payload.indexOf("{");
  if (firstBrace > 0) payload = payload.slice(firstBrace);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.archetype !== "string") return null;
  if (typeof o.explanation !== "string") return null;
  const evidence = Array.isArray(o.evidence)
    ? (o.evidence as unknown[]).filter((e): e is string => typeof e === "string")
    : [];
  const confidence = typeof o.confidence === "number" ? o.confidence : 0.5;
  return {
    archetype: o.archetype,
    explanation: o.explanation,
    evidence,
    confidence,
    signals,
  };
}

/** Heurística sin LLM: aplica las reglas del prompt directamente sobre las signals. */
export function deterministicArchetype(signals: PersonalitySignals): PersonalityArchetype {
  const candidates: Array<{ name: string; score: number; reason: string }> = [];

  if (signals.shipRatio > 0.6) {
    candidates.push({ name: "The Shipper", score: signals.shipRatio, reason: `ship ratio ${(signals.shipRatio * 100).toFixed(0)}%` });
  }
  if (signals.refactorRatio !== null && signals.refactorRatio > 0.4) {
    candidates.push({ name: "The Refactorer", score: signals.refactorRatio, reason: `refactor ratio ${(signals.refactorRatio * 100).toFixed(0)}%` });
  }
  if (signals.exploreSpread > 0.7 && signals.shipRatio < 0.5) {
    candidates.push({ name: "The Explorer", score: signals.exploreSpread, reason: `${(signals.exploreSpread * 100).toFixed(0)}% projects activos sin convergencia` });
  }
  if (signals.connectorRatio > 0.3) {
    candidates.push({ name: "The Connector", score: signals.connectorRatio, reason: `${(signals.connectorRatio * 100).toFixed(0)}% de tracks cruzan proyectos` });
  }
  if (signals.avgSessionLength !== null && signals.avgSessionLength > 80) {
    candidates.push({ name: "The Marathonner", score: Math.min(signals.avgSessionLength / 100, 1), reason: `sesiones promedio de ${signals.avgSessionLength.toFixed(0)} mensajes` });
  }
  if (signals.avgSessionLength !== null && signals.avgSessionLength < 30 && signals.sessionsCount > 200) {
    candidates.push({ name: "The Sprinter", score: 1 - (signals.avgSessionLength / 30), reason: `${signals.sessionsCount} sesiones cortas (${signals.avgSessionLength.toFixed(0)} msgs)` });
  }

  if (candidates.length === 0) {
    return {
      archetype: "Hybrid: undefined",
      explanation: "Las señales del año no se separaron lo suficiente como para definir un archetype dominante.",
      evidence: [],
      confidence: 0.3,
      signals,
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0]!;
  const second = candidates[1];

  // Hybrid si están muy cerca.
  if (second && (winner.score - second.score) < 0.15) {
    return {
      archetype: `Hybrid: ${winner.name} + ${second.name}`,
      explanation: `Dos perfiles dominaron en paralelo: ${winner.reason}; ${second.reason}.`,
      evidence: [winner.reason, second.reason],
      confidence: 0.6,
      signals,
    };
  }

  return {
    archetype: winner.name,
    explanation: `${winner.name}: ${winner.reason}.`,
    evidence: [winner.reason],
    confidence: Math.min(0.5 + (winner.score - (second?.score ?? 0)), 0.95),
    signals,
  };
}

export async function computeSignals(config: JanusConfig, data: WrappedData): Promise<PersonalitySignals> {
  const ship = data.metrics.tracksCompleted + data.metrics.tracksOpen;
  const shipRatio = ship === 0 ? 0 : data.metrics.tracksCompleted / ship;

  // Refactor ratio: requiere git stats. Best-effort por proyecto.
  let totalCommits = 0;
  let chore = 0;
  for (const project of config.projects) {
    if (!existsSync(project.repoPath)) continue;
    try {
      const act = await getActivity(project.repoPath, `${data.periodStart}T00:00:00Z`, `${data.periodEnd}T23:59:59Z`);
      totalCommits += act.commits.length;
      chore += (act.commitTypes["chore"] ?? 0) + (act.commitTypes["refactor"] ?? 0);
    } catch {
      // tolerante
    }
  }
  const refactorRatio = totalCommits === 0 ? null : chore / totalCommits;

  const exploreSpread = data.metrics.projects === 0 ? 0 : data.metrics.projectsActive / data.metrics.projects;

  // Connector ratio: tracks con > 1 proyecto distinto en lineage.
  if (!config.stateDir) {
    return {
      shipRatio,
      refactorRatio,
      exploreSpread,
      connectorRatio: 0,
      avgSessionLength: null,
      sessionsCount: 0,
    };
  }
  const cp = Checkpoint.open(config.stateDir);
  const lineage = cp.listTrackLineage();
  cp.close();
  const lineageInYear = lineage.filter((t) => t.lastMentioned >= data.periodStart && t.firstSeen <= data.periodEnd);
  const projectsBySlug = new Map<string, Set<string>>();
  for (const t of lineageInYear) {
    const set = projectsBySlug.get(t.slug) ?? new Set<string>();
    set.add(t.project);
    projectsBySlug.set(t.slug, set);
  }
  const crossProjectTracks = [...projectsBySlug.values()].filter((s) => s.size >= 2).length;
  const totalTracks = projectsBySlug.size;
  const connectorRatio = totalTracks === 0 ? 0 : crossProjectTracks / totalTracks;

  // Sessions stats — sample por proyecto y mes (no exhaustivo, evita escanear todo el año).
  let sessionsCount = 0;
  let totalMsgs = 0;
  // Tomamos una fecha por mes representativa.
  const monthSamples: string[] = [];
  for (let m = 1; m <= 12; m++) monthSamples.push(`${data.year}-${String(m).padStart(2, "0")}-15`);
  for (const project of config.projects) {
    if (!existsSync(project.repoPath)) continue;
    for (const date of monthSamples) {
      try {
        const files = await findSessionsForDate(project.repoPath, date);
        for (const f of files) {
          const s = await summarizeSession(f);
          sessionsCount += 1;
          totalMsgs += s.messageCount;
        }
      } catch {
        // tolerante
      }
    }
  }
  const avgSessionLength = sessionsCount === 0 ? null : totalMsgs / sessionsCount;

  return {
    shipRatio,
    refactorRatio,
    exploreSpread,
    connectorRatio,
    avgSessionLength,
    sessionsCount,
  };
}
