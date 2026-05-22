/**
 * Stuck patterns — Phase 2 U3.
 *
 * Blockers que aparecen en 2+ weeklies consecutivos sin resolverse.
 *
 * Pipeline:
 *  1. Parse del weekly markdown → blockers (callouts `[!danger]` + listas de
 *     "Riesgos persistentes").
 *  2. Hash determinista del texto (normalizado).
 *  3. Upsert en `blocker_history` con weekly_count incrementado.
 *  4. Antes del próximo weekly: listar blockers con count >= 2 → flag al
 *     prompt para que el LLM agregue callout "Stuck pattern" escalado.
 */
import { createHash } from "node:crypto";
import type { Checkpoint } from "../checkpoint.ts";

export interface StuckBlocker {
  text: string;
  weeklyCount: number;
  firstSeen: string;
}

const STUCK_THRESHOLD = 2;

/** Extrae líneas de blocker/risk del weekly. Tolera variantes de callout. */
export function parseBlockersFromWeekly(weeklyMarkdown: string): string[] {
  const lines = weeklyMarkdown.split("\n");
  const blockers: string[] = [];
  let inRisksBlock = false;
  for (const raw of lines) {
    const trimmed = raw.trim();
    // Inicio de bloque "Riesgos persistentes" o callout danger.
    if (/^>\s*\[!danger\]/i.test(trimmed)) {
      inRisksBlock = true;
      continue;
    }
    // Heading "Riesgos persistentes" en h3/h4 sin callout → también aplica.
    if (/^###?\s+(Riesgos persistentes|Risks)/i.test(trimmed)) {
      inRisksBlock = true;
      continue;
    }
    if (inRisksBlock) {
      if (/^>\s*\[!/i.test(trimmed)) {
        inRisksBlock = false;
        // re-eval, might be another danger callout abajo
        if (/^>\s*\[!danger\]/i.test(trimmed)) inRisksBlock = true;
        continue;
      }
      if (/^##\s+/.test(trimmed)) {
        inRisksBlock = false;
        continue;
      }
      // Bullet dentro del callout o lista
      const m = trimmed.match(/^(?:>\s*)?-\s+(.+)$/);
      if (m) blockers.push(m[1]!.trim());
    }
  }
  return blockers;
}

/** Normaliza un blocker antes de hashearlo: lowercase, sin puntuación, espacios colapsados. */
export function normalizeBlockerText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[\[[^\]]+\]\]/g, "")   // remueve wiki-links
    .replace(/`[^`]*`/g, "")           // remueve code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // remueve bold
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // saca puntuación
    .replace(/\s+/g, " ")
    .trim();
}

export function hashBlocker(text: string): string {
  const normalized = normalizeBlockerText(text);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Registra los blockers extraídos del weekly recién generado.
 * Se llama POST-write — los blockers de este weekly suman 1 a su count.
 */
export function recordWeeklyBlockers(opts: {
  checkpoint: Checkpoint;
  weeklyMarkdown: string;
  weeklyEndDate: string;
  /** Si el weekly es cross-proyecto, project="_global"; si es per-project, el slug. */
  project: string;
}): { recorded: number } {
  const blockers = parseBlockersFromWeekly(opts.weeklyMarkdown);
  let recorded = 0;
  for (const b of blockers) {
    const normalized = normalizeBlockerText(b);
    if (normalized.length < 8) continue; // muy corto, probablemente ruido
    const hash = hashBlocker(b);
    opts.checkpoint.recordBlockerOccurrence({
      blockerHash: hash,
      project: opts.project,
      weeklyEndDate: opts.weeklyEndDate,
      sampleText: b.slice(0, 200),
    });
    recorded += 1;
  }
  return { recorded };
}

/**
 * Detecta blockers que ya pasaron el umbral de stuck. Se llama PRE-weekly
 * generation para inyectar al prompt.
 */
export function detectStuckPatterns(opts: {
  checkpoint: Checkpoint;
  weeklyEndDate: string;
  threshold?: number;
}): StuckBlocker[] {
  const threshold = opts.threshold ?? STUCK_THRESHOLD;
  const rows = opts.checkpoint.listBlockerHistory({ minCount: threshold });
  return rows.map((r) => ({
    text: r.sampleText,
    weeklyCount: r.weeklyCount,
    firstSeen: r.firstSeen,
  }));
}
