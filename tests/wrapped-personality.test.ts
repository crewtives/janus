import { describe, expect, test } from "bun:test";
import { deterministicArchetype, parsePersonalityJson } from "../src/core/wrapped/personality.ts";
import type { PersonalitySignals } from "../src/core/wrapped/types.ts";

function makeSignals(overrides: Partial<PersonalitySignals> = {}): PersonalitySignals {
  return {
    shipRatio: 0.5,
    refactorRatio: 0.2,
    exploreSpread: 0.5,
    connectorRatio: 0.1,
    avgSessionLength: 50,
    sessionsCount: 50,
    ...overrides,
  };
}

describe("wrapped/personality — deterministic", () => {
  test("Shipper: high shipRatio", () => {
    const a = deterministicArchetype(makeSignals({ shipRatio: 0.8 }));
    expect(a.archetype).toBe("The Shipper");
    expect(a.confidence).toBeGreaterThan(0.5);
  });

  test("Refactorer: high refactorRatio", () => {
    const a = deterministicArchetype(makeSignals({ shipRatio: 0.3, refactorRatio: 0.55 }));
    expect(a.archetype).toBe("The Refactorer");
  });

  test("Explorer: high spread + low ship", () => {
    const a = deterministicArchetype(makeSignals({ shipRatio: 0.2, exploreSpread: 0.85, refactorRatio: 0.1 }));
    expect(a.archetype).toBe("The Explorer");
  });

  test("Connector: cross-project tracks", () => {
    const a = deterministicArchetype(makeSignals({ shipRatio: 0.3, refactorRatio: 0.1, exploreSpread: 0.4, connectorRatio: 0.5 }));
    expect(a.archetype).toBe("The Connector");
  });

  test("Marathonner: long sessions", () => {
    const a = deterministicArchetype(makeSignals({ shipRatio: 0.3, refactorRatio: 0.1, exploreSpread: 0.4, connectorRatio: 0.1, avgSessionLength: 120 }));
    expect(a.archetype).toBe("The Marathonner");
  });

  test("Sprinter: short and frequent sessions", () => {
    const a = deterministicArchetype(makeSignals({ shipRatio: 0.3, refactorRatio: 0.1, exploreSpread: 0.4, connectorRatio: 0.1, avgSessionLength: 20, sessionsCount: 250 }));
    expect(a.archetype).toBe("The Sprinter");
  });

  test("Hybrid when two candidates are close", () => {
    const a = deterministicArchetype(makeSignals({ shipRatio: 0.75, refactorRatio: 0.7 }));
    expect(a.archetype.startsWith("Hybrid:")).toBe(true);
  });

  test("Without clear signals → Hybrid undefined with low confidence", () => {
    const a = deterministicArchetype(makeSignals({ shipRatio: 0.2, refactorRatio: 0.1, exploreSpread: 0.3, connectorRatio: 0.1, avgSessionLength: 50, sessionsCount: 50 }));
    expect(a.archetype).toBe("Hybrid: undefined");
    expect(a.confidence).toBeLessThan(0.5);
  });
});

describe("wrapped/personality — parsePersonalityJson", () => {
  test("accepts clean JSON", () => {
    const json = `{"archetype":"The Shipper","explanation":"ship ratio 80%","evidence":["8/10 tracks"],"confidence":0.85}`;
    const out = parsePersonalityJson(json, makeSignals());
    expect(out).not.toBeNull();
    expect(out!.archetype).toBe("The Shipper");
    expect(out!.evidence).toHaveLength(1);
    expect(out!.signals).toEqual(makeSignals());
  });

  test("strips code fence", () => {
    const wrapped = "```json\n" + `{"archetype":"x","explanation":"y","evidence":[],"confidence":0.6}` + "\n```";
    const out = parsePersonalityJson(wrapped, makeSignals());
    expect(out).not.toBeNull();
  });

  test("returns null when required fields are missing", () => {
    expect(parsePersonalityJson(`{"archetype":"x"}`, makeSignals())).toBeNull();
    expect(parsePersonalityJson(`not json`, makeSignals())).toBeNull();
  });
});
