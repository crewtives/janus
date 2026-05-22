/**
 * Decision graph — Phase 1C.
 *
 * Indexa qué pulses referencian qué ADRs. Habilita:
 *  - Phase 2 U2: orphan decision detection (ADRs sin referencias recientes).
 *  - Phase 3: "Biggest decision" del Wrapped (ADR más referenciado del año).
 *
 * Patrones que indexa desde el contenido del pulse markdown:
 *  - `ADR-\d+` (case-insensitive) → reference_type = "mention".
 *  - `🏛️ ADR-candidate` cerca de un `^decision-N` → "candidate" con
 *    adr_id sintético `candidate:<date>-<project>:decision-N`.
 *  - `**Modifica/revierte**` o `**revierte**` cerca de un `ADR-NNN` →
 *    "modifies" o "revertes".
 */
import type { Checkpoint } from "./checkpoint.ts";

export type ReferenceType = "mention" | "candidate" | "modifies" | "revertes";

export interface DecisionReference {
  adrId: string;
  referenceType: ReferenceType;
}

const ADR_RE = /\bADR-(\d{1,5})\b/gi;
const CANDIDATE_RE = /🏛️\s*ADR-candidate/i;
const DECISION_ID_RE = /\^decision-(\d+)/;
const MODIFIES_RE = /\*\*\s*(modifica|modifies)[^*]*\*\*/i;
const REVERTS_RE = /\*\*\s*(revierte|reverts)[^*]*\*\*/i;

/**
 * Parsea un pulse markdown y devuelve la lista de referencias detectadas.
 * Deduplica por (adr_id, reference_type) para no inflar el grafo con
 * múltiples menciones del mismo ADR en el mismo pulse.
 */
export function extractDecisionReferences(opts: {
  pulseContent: string;
  pulseDate: string;
  project: string;
}): DecisionReference[] {
  const refs = new Map<string, DecisionReference>();
  const body = opts.pulseContent;

  // 1. Menciones de ADRs existentes (ADR-NNN). Recolectar primero.
  const mentioned = new Set<string>();
  for (const m of body.matchAll(ADR_RE)) {
    const num = parseInt(m[1]!, 10);
    if (!Number.isFinite(num)) continue;
    const adrId = `ADR-${String(num).padStart(3, "0")}`;
    mentioned.add(adrId);
  }
  for (const adrId of mentioned) {
    refs.set(`${adrId}|mention`, { adrId, referenceType: "mention" });
  }

  // 2. Decisions sección — escanear línea por línea para detectar candidate /
  //    modifies / revertes asociados a un ADR específico.
  const lines = body.split("\n");
  for (const line of lines) {
    const hasCandidate = CANDIDATE_RE.test(line);
    const hasModifies = MODIFIES_RE.test(line);
    const hasReverts = REVERTS_RE.test(line);
    if (!hasCandidate && !hasModifies && !hasReverts) continue;

    // ¿Hay ADR-NNN en la misma línea? Si sí, asociar.
    const adrMatches = [...line.matchAll(ADR_RE)];
    if (adrMatches.length > 0) {
      for (const m of adrMatches) {
        const adrId = `ADR-${String(parseInt(m[1]!, 10)).padStart(3, "0")}`;
        if (hasModifies) refs.set(`${adrId}|modifies`, { adrId, referenceType: "modifies" });
        if (hasReverts) refs.set(`${adrId}|revertes`, { adrId, referenceType: "revertes" });
      }
    }

    // Candidate: el ADR todavía no existe — usar id sintético.
    if (hasCandidate) {
      const decisionMatch = line.match(DECISION_ID_RE);
      const decisionId = decisionMatch ? `decision-${decisionMatch[1]}` : "decision-?";
      const synthId = `candidate:${opts.pulseDate}-${opts.project}:${decisionId}`;
      refs.set(`${synthId}|candidate`, { adrId: synthId, referenceType: "candidate" });
    }
  }

  return [...refs.values()];
}

/**
 * Indexa las referencias de un pulse en `decision_graph`. Idempotente
 * (PK compuesta en la tabla evita duplicados).
 */
export function indexPulseDecisions(opts: {
  checkpoint: Checkpoint;
  pulseContent: string;
  pulseDate: string;
  project: string;
}): { indexed: number } {
  const refs = extractDecisionReferences({
    pulseContent: opts.pulseContent,
    pulseDate: opts.pulseDate,
    project: opts.project,
  });
  for (const ref of refs) {
    opts.checkpoint.recordDecisionReference({
      adrId: ref.adrId,
      pulseDate: opts.pulseDate,
      project: opts.project,
      referenceType: ref.referenceType,
    });
  }
  return { indexed: refs.length };
}
