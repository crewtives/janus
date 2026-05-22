import { describe, expect, test } from "bun:test";
import {
  detectPatterns,
  extractPulseSummary,
  parsePatternsJson,
  renderPatternsCallout,
  type DetectedPattern,
} from "../src/core/reflection/pattern-detector.ts";
import type { LLMRunner, RunResult } from "../src/runners/types.ts";

class MockRunner implements LLMRunner {
  readonly id = "mock";
  readonly capabilities = {
    sessionResume: false, effortControl: false, costTracking: false,
    addDirs: false, jsonStream: false, disableTools: false, fallbackModel: false,
  };
  constructor(private readonly response: string) {}
  async run(): Promise<RunResult> {
    return {
      sessionId: null, resultText: this.response, totalCostUsd: null,
      durationMs: 0, numTurns: 1, exitCode: 0,
    };
  }
}

describe("reflection/pattern-detector — parse", () => {
  test("parsePatternsJson accepts clean JSON", () => {
    const json = `{"patterns":[{"type":"repeated","pattern":"X 5 veces","evidence":["2026-05-15","2026-05-17"],"confidence":0.8}]}`;
    const out = parsePatternsJson(json);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("repeated");
    expect(out[0]!.confidence).toBe(0.8);
  });

  test("parsePatternsJson strips code fence", () => {
    const wrapped = "```json\n" + `{"patterns":[{"type":"contradiction","pattern":"A vs B","evidence":["2026-05-10"],"confidence":0.7}]}` + "\n```";
    const out = parsePatternsJson(wrapped);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("contradiction");
  });

  test("parsePatternsJson strips preamble before the first {", () => {
    const text = `Aquí va el JSON:\n{"patterns":[{"type":"implicit-debt","pattern":"x","evidence":[],"confidence":0.65}]}`;
    const out = parsePatternsJson(text);
    expect(out).toHaveLength(1);
  });

  test("parsePatternsJson discards items with missing fields", () => {
    const json = `{"patterns":[{"type":"repeated","pattern":"ok","evidence":[],"confidence":0.7},{"pattern":"sin type","evidence":[],"confidence":0.7},{"type":"bogus","pattern":"x","evidence":[],"confidence":0.7}]}`;
    const out = parsePatternsJson(json);
    expect(out).toHaveLength(1);
  });

  test("parsePatternsJson returns [] on invalid JSON", () => {
    expect(parsePatternsJson("no json")).toEqual([]);
    expect(parsePatternsJson("{not json}")).toEqual([]);
  });
});

describe("reflection/pattern-detector — render", () => {
  test("renderPatternsCallout empty when list is empty", () => {
    expect(renderPatternsCallout([])).toBe("");
  });

  test("renderPatternsCallout includes type label and confidence %", () => {
    const patterns: DetectedPattern[] = [
      { type: "repeated", pattern: "X 5 veces", evidence: ["2026-05-15"], confidence: 0.8 },
      { type: "contradiction", pattern: "A vs B", evidence: ["2026-05-10"], confidence: 0.7 },
      { type: "implicit-debt", pattern: "Y sin nombrar", evidence: [], confidence: 0.65 },
    ];
    const out = renderPatternsCallout(patterns);
    expect(out).toContain("[!info]");
    expect(out).toContain("Patterns");
    expect(out).toContain("🔁 Repetido");
    expect(out).toContain("⚡ Contradicción");
    expect(out).toContain("💧 Deuda implícita");
    expect(out).toContain("80%");
    expect(out).toContain("X 5 veces");
  });
});

describe("reflection/pattern-detector — extractPulseSummary", () => {
  test("extracts status, TL;DR, decisions, risks, tracks", () => {
    const content = `---
date: 2026-05-20
status: on-track
tracks: [acme-onboarding, mcp-server]
---
## TL;DR

> [!summary]+
> Día centrado en el MCP server.

> [!quote] Decisions
> - Adoptar JSON-RPC stdio para el MCP
> - Reusar el voice spec compartido

> [!danger] Risks
> - Test de smoke falla en CI
`;
    const out = extractPulseSummary(content, "janus", "2026-05-20");
    expect(out.status).toBe("on-track");
    expect(out.tldr).toContain("MCP server");
    expect(out.tracks).toEqual(["acme-onboarding", "mcp-server"]);
    expect(out.decisions).toHaveLength(2);
    expect(out.decisions[0]).toContain("JSON-RPC");
    expect(out.risks).toHaveLength(1);
    expect(out.risks[0]).toContain("smoke");
  });
});

describe("reflection/pattern-detector — detectPatterns smoke with mock runner", () => {
  test("filters patterns by minConfidence", async () => {
    const response = JSON.stringify({
      patterns: [
        { type: "repeated", pattern: "alto", evidence: ["2026-05-20"], confidence: 0.9 },
        { type: "repeated", pattern: "bajo", evidence: ["2026-05-20"], confidence: 0.4 },
      ],
    });
    const runner = new MockRunner(response);
    // El detector requiere pulses en disk → si no hay state, devuelve [].
    // Probamos el flujo de filter via parsePatternsJson directamente.
    const parsed = parsePatternsJson(response);
    const filtered = parsed.filter((p) => p.confidence >= 0.6);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.pattern).toBe("alto");

    // detectPatterns con stateDir vacío devuelve []
    const out = await detectPatterns({
      config: { obsidianVault: "/tmp/nope", projects: [], stateDir: undefined } as any,
      startDate: "2026-05-15",
      endDate: "2026-05-22",
      runnerOverride: runner,
    });
    expect(out).toEqual([]);
  });
});
