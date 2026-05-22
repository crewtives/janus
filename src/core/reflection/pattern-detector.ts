/**
 * Pattern detection — Phase 2 U4.
 *
 * Pre-step del weekly: LLM pass sobre los últimos K pulses cross-proyecto
 * que busca patterns repetidos, contradicciones y deudas implícitas.
 * El output JSON se inyecta al prompt del weekly como contexto adicional.
 *
 * Usa el mismo runner que el resto del pipeline (resolveRunner). Es
 * best-effort — si el LLM falla o devuelve JSON inválido, el weekly sigue
 * sin patterns.
 */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Eta } from "eta";
import type { JanusConfig } from "../../config/types.ts";
import patternDetectionTemplate from "../../prompts/pattern-detection.v2.md" with { type: "text" };
import type { LLMRunner } from "../../runners/types.ts";
import { Checkpoint } from "../checkpoint.ts";

export interface DetectedPattern {
  type: "repeated" | "contradiction" | "implicit-debt";
  pattern: string;
  evidence: string[];
  confidence: number;
}

export interface PatternDetectorOptions {
  config: JanusConfig;
  startDate: string;
  endDate: string;
  /** Override para testing — runner mock. */
  runnerOverride?: LLMRunner;
  /** Min confidence threshold para incluir el pattern. Default 0.6. */
  minConfidence?: number;
}

const PROMPT_VERSION = "v2" as const;
const eta = new Eta({ autoEscape: false, rmWhitespace: false });

export async function detectPatterns(opts: PatternDetectorOptions): Promise<DetectedPattern[]> {
  const minConfidence = opts.minConfidence ?? 0.6;
  if (!opts.config.stateDir) return [];

  const pulsesJson = await loadPulsesAsJson({
    config: opts.config,
    startDate: opts.startDate,
    endDate: opts.endDate,
  });
  if (pulsesJson.length === 0) return [];

  const template = patternDetectionTemplate;
  const daysBack = daysBetweenInclusive(opts.startDate, opts.endDate);
  const prompt = eta.renderString(template, {
    startDate: opts.startDate,
    endDate: opts.endDate,
    daysBack,
    pulsesJson: JSON.stringify(pulsesJson, null, 2),
  });
  if (typeof prompt !== "string") return [];

  let runner: LLMRunner;
  if (opts.runnerOverride) {
    runner = opts.runnerOverride;
  } else {
    const { resolveRunner } = await import("../../runners/registry.ts");
    runner = resolveRunner(opts.config);
  }

  let resultText: string;
  try {
    const r = await runner.run({
      prompt,
      cwd: opts.config.obsidianVault,
      model: opts.config.model ?? "claude-sonnet-4-6",
      effort: opts.config.effort ?? "medium",
      fallbackModel: opts.config.fallbackModel,
      sessionId: randomUUID(),
      maxTurns: 3,
      timeoutMs: 5 * 60_000,
      logTag: `pattern-detect/${opts.endDate}`,
    });
    resultText = r.resultText.trim();
  } catch (err) {
    console.warn(`[pattern-detector] LLM failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  const parsed = parsePatternsJson(resultText);
  return parsed.filter((p) => p.confidence >= minConfidence);
}

/**
 * Parse robusto del JSON devuelto por el LLM. Si el modelo agregó preámbulo
 * o code fences, los pelamos.
 */
export function parsePatternsJson(text: string): DetectedPattern[] {
  let payload = text.trim();
  // Pelar code fence ``` o ```json
  const fenceMatch = payload.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) payload = fenceMatch[1]!.trim();
  // Pelar cualquier preámbulo antes del primer `{`
  const firstBrace = payload.indexOf("{");
  if (firstBrace > 0) payload = payload.slice(firstBrace);

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const arr = (parsed as { patterns?: unknown }).patterns;
  if (!Array.isArray(arr)) return [];
  const out: DetectedPattern[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.pattern !== "string") continue;
    if (typeof o.confidence !== "number") continue;
    if (!["repeated", "contradiction", "implicit-debt"].includes(o.type as string)) continue;
    const evidence = Array.isArray(o.evidence) ? (o.evidence as unknown[]).filter((e): e is string => typeof e === "string") : [];
    out.push({
      type: o.type as DetectedPattern["type"],
      pattern: o.pattern,
      evidence,
      confidence: o.confidence,
    });
  }
  return out;
}

/** Renderiza patterns como callout para el weekly prompt. Vacío si lista vacía. */
export function renderPatternsCallout(patterns: DetectedPattern[]): string {
  if (patterns.length === 0) return "";
  const lines: string[] = ["> [!info] Patterns detectados (auto)"];
  lines.push(">");
  for (const p of patterns) {
    const typeLabel =
      p.type === "repeated" ? "🔁 Repetido" :
      p.type === "contradiction" ? "⚡ Contradicción" :
      "💧 Deuda implícita";
    lines.push(`> - **${typeLabel}** (${(p.confidence * 100).toFixed(0)}%): ${p.pattern} · evidencia: ${p.evidence.slice(0, 5).join(", ")}`);
  }
  return lines.join("\n");
}

interface PulseRow {
  date: string;
  project: string;
  status: string | null;
  tldr: string | null;
  decisions: string[];
  risks: string[];
  tracks: string[];
}

async function loadPulsesAsJson(opts: {
  config: JanusConfig;
  startDate: string;
  endDate: string;
}): Promise<PulseRow[]> {
  if (!opts.config.stateDir) return [];
  // Leer de pulse_state los pulses done del período + extraer TLDR del archivo.
  const cp = Checkpoint.open(opts.config.stateDir);
  const records = cp.queryRecent(60).filter(
    (r) => r.status === "done" && r.date >= opts.startDate && r.date <= opts.endDate && r.outputPath,
  );
  const rows: PulseRow[] = [];
  for (const rec of records) {
    if (!rec.outputPath) continue;
    try {
      const content = await Bun.file(rec.outputPath).text();
      rows.push(extractPulseSummary(content, rec.project, rec.date));
    } catch {
      // tolerante: pulse archivado / movido
      continue;
    }
  }
  cp.close();
  return rows;
}

export function extractPulseSummary(content: string, project: string, date: string): PulseRow {
  const status = matchField(content, /^status:\s*(.+)$/m);
  const tldr = extractCallout(content, /\[!summary\][+\-]?/i);
  const tracks = extractFrontmatterList(content, "tracks");
  const decisions = extractCalloutBullets(content, /\[!quote\]/i);
  const risks = extractCalloutBullets(content, /\[!danger\]/i);
  return { date, project, status, tldr, decisions, risks, tracks };
}

function matchField(content: string, re: RegExp): string | null {
  const m = content.match(re);
  return m ? m[1]!.trim() : null;
}

function extractCallout(content: string, headerRe: RegExp): string | null {
  const lines = content.split("\n");
  let inBlock = false;
  const out: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!inBlock && /^>\s*\[!/i.test(trimmed) && headerRe.test(trimmed)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (!raw.startsWith(">")) break;
      if (/^>\s*\[!/i.test(trimmed)) break;
      const stripped = raw.replace(/^>\s?/, "").trim();
      if (stripped) out.push(stripped);
    }
  }
  return out.length ? out.join(" ") : null;
}

function extractCalloutBullets(content: string, headerRe: RegExp): string[] {
  const lines = content.split("\n");
  let inBlock = false;
  const out: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!inBlock && /^>\s*\[!/i.test(trimmed) && headerRe.test(trimmed)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (!raw.startsWith(">")) break;
      if (/^>\s*\[!/i.test(trimmed)) break;
      const m = trimmed.match(/^>\s*-\s+(.+)$/);
      if (m) out.push(m[1]!.trim());
    }
  }
  return out;
}

function extractFrontmatterList(content: string, key: string): string[] {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return [];
  const re = new RegExp(`^${key}:\\s*\\[(.*?)\\]\\s*$`, "m");
  const m = fm[1]!.match(re);
  if (!m) return [];
  return m[1]!.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

function daysBetweenInclusive(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  return Math.round((e - s) / 86_400_000) + 1;
}
