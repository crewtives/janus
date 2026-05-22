/**
 * Tests for the LLM runner privacy wrapper.
 *
 * The wrapper is the only chokepoint between the rendered prompt and the
 * provider, so coverage focuses on: the prompt is redacted, everything else
 * passes through, and disabling the layer is honored.
 */
import { describe, expect, test } from "bun:test";
import { redactingRunner } from "../src/runners/redacting.ts";
import type { LLMRunner, RunOptions, RunResult } from "../src/runners/types.ts";

function makeFakeRunner(): { runner: LLMRunner; lastSeen: { prompt?: string; opts?: RunOptions } } {
  const lastSeen: { prompt?: string; opts?: RunOptions } = {};
  const runner: LLMRunner = {
    id: "fake",
    capabilities: {
      sessionResume: false,
      effortControl: false,
      costTracking: false,
      addDirs: false,
      jsonStream: false,
      disableTools: false,
      fallbackModel: false,
    },
    async run(opts: RunOptions): Promise<RunResult> {
      lastSeen.prompt = opts.prompt;
      lastSeen.opts = opts;
      return {
        sessionId: null,
        resultText: "ok",
        totalCostUsd: null,
        durationMs: 1,
        numTurns: null,
        exitCode: 0,
      };
    },
  };
  return { runner, lastSeen };
}

describe("redactingRunner", () => {
  test("the wrapped runner redacts the prompt before delegating", async () => {
    const { runner, lastSeen } = makeFakeRunner();
    const wrapped = redactingRunner(runner, {});
    await wrapped.run({
      prompt: "ghp_FAKE00000000000000000000000000000000 and alice@example.com",
      cwd: "/tmp",
    });
    expect(lastSeen.prompt).toContain("<github-pat>");
    expect(lastSeen.prompt).toContain("<email>");
    expect(lastSeen.prompt).not.toContain("ghp_FAKE");
    expect(lastSeen.prompt).not.toContain("alice@example.com");
  });

  test("other RunOptions pass through unmodified", async () => {
    const { runner, lastSeen } = makeFakeRunner();
    const wrapped = redactingRunner(runner, {});
    await wrapped.run({
      prompt: "no secrets here",
      cwd: "/some/cwd",
      model: "sonnet",
      effort: "high",
      sessionId: "session-123",
      logTag: "demo/2026-05-22",
    });
    expect(lastSeen.opts?.cwd).toBe("/some/cwd");
    expect(lastSeen.opts?.model).toBe("sonnet");
    expect(lastSeen.opts?.effort).toBe("high");
    expect(lastSeen.opts?.sessionId).toBe("session-123");
    expect(lastSeen.opts?.logTag).toBe("demo/2026-05-22");
  });

  test("repoRoot collapse is applied via the redaction options", async () => {
    const { runner, lastSeen } = makeFakeRunner();
    const wrapped = redactingRunner(runner, { repoRoot: "/Users/alice/code/janus" });
    await wrapped.run({
      prompt: "edited /Users/alice/code/janus/src/foo.ts",
      cwd: "/tmp",
    });
    expect(lastSeen.prompt).toContain("<repo>/src/foo.ts");
    expect(lastSeen.prompt).not.toContain("/Users/alice/code/janus");
  });

  test("preserves underlying runner identity (id + capabilities)", () => {
    const { runner } = makeFakeRunner();
    const wrapped = redactingRunner(runner, {});
    expect(wrapped.id).toBe(runner.id);
    expect(wrapped.capabilities).toBe(runner.capabilities);
  });

  test("disabled: true short-circuits", async () => {
    const { runner, lastSeen } = makeFakeRunner();
    const wrapped = redactingRunner(runner, { disabled: true });
    const sensitive = "ghp_FAKE00000000000000000000000000000000";
    await wrapped.run({ prompt: sensitive, cwd: "/tmp" });
    expect(lastSeen.prompt).toBe(sensitive);
  });
});
