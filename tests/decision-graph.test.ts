import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Checkpoint } from "../src/core/checkpoint.ts";
import { extractDecisionReferences, indexPulseDecisions } from "../src/core/decision-graph.ts";

let cp: Checkpoint;

beforeEach(() => {
  cp = Checkpoint.openInMemory();
});

afterEach(() => {
  cp.close();
});

describe("extractDecisionReferences", () => {
  test("detects ADR-NNN as a mention", () => {
    const refs = extractDecisionReferences({
      pulseContent: "Se referencia ADR-007 y ADR-12 en el día.",
      pulseDate: "2026-05-21",
      project: "demo",
    });
    expect(refs).toEqual(
      expect.arrayContaining([
        { adrId: "ADR-007", referenceType: "mention" },
        { adrId: "ADR-012", referenceType: "mention" },
      ]),
    );
  });

  test("dedupes multiple mentions of the same ADR", () => {
    const refs = extractDecisionReferences({
      pulseContent: "ADR-007 aparece acá. Y de nuevo ADR-007 más abajo. Y ADR-7 también.",
      pulseDate: "2026-05-21",
      project: "demo",
    });
    const mentions = refs.filter((r) => r.referenceType === "mention" && r.adrId === "ADR-007");
    expect(mentions).toHaveLength(1);
  });

  test("detects candidate flag and emits synthetic id", () => {
    const refs = extractDecisionReferences({
      pulseContent: "> - [sesión abc] adoptar bun-sqlite 🏛️ ADR-candidate ^decision-1",
      pulseDate: "2026-05-21",
      project: "demo",
    });
    const cand = refs.filter((r) => r.referenceType === "candidate");
    expect(cand).toHaveLength(1);
    expect(cand[0]?.adrId).toContain("candidate:2026-05-21-demo:decision-1");
  });

  test("detects modifies/revertes associated with a specific ADR", () => {
    const refs = extractDecisionReferences({
      pulseContent: "**Modifica**: ADR-005 — el approach cambia.\n**revierte** ADR-009 — fue mal idea.",
      pulseDate: "2026-05-21",
      project: "demo",
    });
    expect(refs).toEqual(
      expect.arrayContaining([
        { adrId: "ADR-005", referenceType: "modifies" },
        { adrId: "ADR-009", referenceType: "revertes" },
      ]),
    );
  });

  test("no patterns → empty array", () => {
    const refs = extractDecisionReferences({
      pulseContent: "Día sin decisiones canónicas.",
      pulseDate: "2026-05-21",
      project: "demo",
    });
    expect(refs).toEqual([]);
  });
});

describe("indexPulseDecisions", () => {
  test("inserts rows into decision_graph (composite PK dedupes)", () => {
    indexPulseDecisions({
      checkpoint: cp,
      pulseContent: "ADR-007 mencionado.",
      pulseDate: "2026-05-21",
      project: "demo",
    });
    indexPulseDecisions({
      checkpoint: cp,
      pulseContent: "ADR-007 mencionado de nuevo.",
      pulseDate: "2026-05-21",
      project: "demo",
    });
    const rows = cp.listDecisionReferences({ adrId: "ADR-007" });
    expect(rows).toHaveLength(1);
  });

  test("countReferencesByAdr orders descending by count", () => {
    indexPulseDecisions({
      checkpoint: cp,
      pulseContent: "ADR-007 + ADR-001",
      pulseDate: "2026-05-19",
      project: "demo",
    });
    indexPulseDecisions({
      checkpoint: cp,
      pulseContent: "ADR-007",
      pulseDate: "2026-05-20",
      project: "demo",
    });
    indexPulseDecisions({
      checkpoint: cp,
      pulseContent: "ADR-007",
      pulseDate: "2026-05-21",
      project: "demo",
    });
    const counts = cp.countReferencesByAdr();
    expect(counts[0]?.adrId).toBe("ADR-007");
    expect(counts[0]?.count).toBe(3);
    expect(counts[1]?.adrId).toBe("ADR-001");
  });

  test("filter by project works", () => {
    indexPulseDecisions({ checkpoint: cp, pulseContent: "ADR-007", pulseDate: "2026-05-21", project: "a" });
    indexPulseDecisions({ checkpoint: cp, pulseContent: "ADR-007", pulseDate: "2026-05-21", project: "b" });
    expect(cp.listDecisionReferences({ project: "a" })).toHaveLength(1);
    expect(cp.listDecisionReferences({ project: "b" })).toHaveLength(1);
  });
});
