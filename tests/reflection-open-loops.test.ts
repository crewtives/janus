import { describe, expect, test } from "bun:test";
import { Checkpoint } from "../src/core/checkpoint.ts";
import {
  detectOpenTrackLoops,
  detectOrphanDecisions,
  renderOpenLoopsCallout,
} from "../src/core/reflection/open-loops.ts";

describe("reflection/open-loops — tracks", () => {
  test("flags open track with last_mentioned > 14d", () => {
    const cp = Checkpoint.openInMemory();
    cp.recordTrackMention({ slug: "dormido", project: "p", date: "2026-05-01", status: "open" });
    cp.recordTrackMention({ slug: "vivo", project: "p", date: "2026-05-20", status: "open" });
    const loops = detectOpenTrackLoops({ checkpoint: cp, today: "2026-05-22" });
    expect(loops.length).toBe(1);
    expect(loops[0]!.slug).toBe("dormido");
    expect(loops[0]!.daysSince).toBeGreaterThan(14);
    cp.close();
  });

  test("closed/archived track is not flagged even when old", () => {
    const cp = Checkpoint.openInMemory();
    cp.recordTrackMention({ slug: "cerrado", project: "p", date: "2026-04-01", status: "completed" });
    const loops = detectOpenTrackLoops({ checkpoint: cp, today: "2026-05-22" });
    expect(loops.length).toBe(0);
    cp.close();
  });

  test("descending order by daysSince", () => {
    const cp = Checkpoint.openInMemory();
    cp.recordTrackMention({ slug: "old", project: "p", date: "2026-03-01", status: "open" });
    cp.recordTrackMention({ slug: "med", project: "p", date: "2026-04-15", status: "open" });
    const loops = detectOpenTrackLoops({ checkpoint: cp, today: "2026-05-22" });
    expect(loops.map((l) => l.slug)).toEqual(["old", "med"]);
    cp.close();
  });
});

describe("reflection/open-loops — decisions", () => {
  test("orphan: ADR created 14d ago without recent references", () => {
    const cp = Checkpoint.openInMemory();
    cp.recordDecisionReference({
      adrId: "ADR-007",
      pulseDate: "2026-05-01",
      project: "p",
      referenceType: "mention",
    });
    const orphans = detectOrphanDecisions({ checkpoint: cp, today: "2026-05-22" });
    expect(orphans.length).toBe(1);
    expect(orphans[0]!.adrId).toBe("ADR-007");
    cp.close();
  });

  test("not orphan: ADR referenced recently", () => {
    const cp = Checkpoint.openInMemory();
    cp.recordDecisionReference({
      adrId: "ADR-007",
      pulseDate: "2026-05-01",
      project: "p",
      referenceType: "mention",
    });
    cp.recordDecisionReference({
      adrId: "ADR-007",
      pulseDate: "2026-05-20",
      project: "p",
      referenceType: "mention",
    });
    const orphans = detectOrphanDecisions({ checkpoint: cp, today: "2026-05-22" });
    expect(orphans.length).toBe(0);
    cp.close();
  });

  test("ignores synthetic candidates", () => {
    const cp = Checkpoint.openInMemory();
    cp.recordDecisionReference({
      adrId: "candidate:2026-05-01--p:decision-1",
      pulseDate: "2026-05-01",
      project: "p",
      referenceType: "candidate",
    });
    const orphans = detectOrphanDecisions({ checkpoint: cp, today: "2026-05-22" });
    expect(orphans.length).toBe(0);
    cp.close();
  });
});

describe("reflection/open-loops — callout", () => {
  test("empty callout when there are no loops", () => {
    const out = renderOpenLoopsCallout({ tracks: [], decisions: [] });
    expect(out).toBe("");
  });

  test("callout includes tracks and decisions when present", () => {
    const out = renderOpenLoopsCallout({
      tracks: [{ slug: "x", project: "p", lastMentioned: "2026-05-01", daysSince: 21 }],
      decisions: [
        { adrId: "ADR-007", project: "p", firstSeen: "2026-05-01", lastReferenced: "2026-05-01", daysSinceReference: 21 },
      ],
    });
    expect(out).toContain("[!info]");
    expect(out).toContain("Open loops");
    expect(out).toContain("Dormant tracks");
    expect(out).toContain("`x`");
    expect(out).toContain("Decisions without follow-up");
    expect(out).toContain("ADR-007");
  });
});
