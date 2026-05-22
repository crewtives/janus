import { describe, expect, test } from "bun:test";
import { withFallback } from "../src/runners/with-fallback.ts";
import type { LLMRunner, RunOptions, RunResult, RunnerCapabilities } from "../src/runners/types.ts";
import { RunnerError } from "../src/runners/types.ts";

function makeRunner(opts: {
  id: string;
  capabilities?: Partial<RunnerCapabilities>;
  behavior: () => Promise<RunResult>;
}): LLMRunner & { calls: RunOptions[] } {
  const calls: RunOptions[] = [];
  const caps: RunnerCapabilities = {
    sessionResume: true,
    effortControl: true,
    costTracking: true,
    addDirs: true,
    jsonStream: true,
    disableTools: true,
    fallbackModel: true,
    ...opts.capabilities,
  };
  return {
    id: opts.id,
    capabilities: caps,
    calls,
    async run(input: RunOptions) {
      calls.push(input);
      return opts.behavior();
    },
  };
}

const okResult = (text = "ok"): RunResult => ({
  sessionId: null,
  resultText: text,
  totalCostUsd: null,
  durationMs: 1,
  numTurns: 1,
  exitCode: 0,
});

const baseOpts: RunOptions = { prompt: "p", cwd: "/" };

describe("withFallback", () => {
  test("returns primary when no secondary", async () => {
    const primary = makeRunner({ id: "a", behavior: async () => okResult("primary") });
    const wrapped = withFallback(primary);
    const r = await wrapped.run(baseOpts);
    expect(r.resultText).toBe("primary");
    expect(wrapped.id).toBe("a");
  });

  test("uses primary on success", async () => {
    const primary = makeRunner({ id: "a", behavior: async () => okResult("primary") });
    const secondary = makeRunner({ id: "b", behavior: async () => okResult("secondary") });
    const wrapped = withFallback(primary, secondary);
    const r = await wrapped.run(baseOpts);
    expect(r.resultText).toBe("primary");
    expect(secondary.calls).toHaveLength(0);
  });

  test("falls over to secondary on retriable error", async () => {
    const primary = makeRunner({
      id: "a",
      behavior: async () => {
        throw new RunnerError("overloaded", 137, "", true);
      },
    });
    const secondary = makeRunner({ id: "b", behavior: async () => okResult("rescued") });
    const wrapped = withFallback(primary, secondary);
    const r = await wrapped.run(baseOpts);
    expect(r.resultText).toBe("rescued");
    expect(primary.calls).toHaveLength(1);
    expect(secondary.calls).toHaveLength(1);
  });

  test("does NOT fall over on non-retriable error", async () => {
    const primary = makeRunner({
      id: "a",
      behavior: async () => {
        throw new RunnerError("auth missing", 1, "", false);
      },
    });
    const secondary = makeRunner({ id: "b", behavior: async () => okResult("rescued") });
    const wrapped = withFallback(primary, secondary);
    await expect(wrapped.run(baseOpts)).rejects.toThrow("auth missing");
    expect(secondary.calls).toHaveLength(0);
  });

  test("strips fallbackModel when delegating to secondary", async () => {
    const primary = makeRunner({
      id: "a",
      capabilities: { fallbackModel: false },
      behavior: async () => {
        throw new RunnerError("rate-limit", 137, "", true);
      },
    });
    const secondary = makeRunner({ id: "b", behavior: async () => okResult("rescued") });
    const wrapped = withFallback(primary, secondary);
    await wrapped.run({ ...baseOpts, fallbackModel: "opus" });
    expect(secondary.calls[0]?.fallbackModel).toBeUndefined();
  });

  test("when primary has fallbackModel capability AND opts.fallbackModel set, does NOT fall over (primary's native fallback already tried)", async () => {
    const primary = makeRunner({
      id: "a",
      capabilities: { fallbackModel: true },
      behavior: async () => {
        throw new RunnerError("overloaded twice", 137, "", true);
      },
    });
    const secondary = makeRunner({ id: "b", behavior: async () => okResult("rescued") });
    const wrapped = withFallback(primary, secondary);
    await expect(wrapped.run({ ...baseOpts, fallbackModel: "opus" })).rejects.toThrow("overloaded twice");
    expect(secondary.calls).toHaveLength(0);
  });

  test("rethrows non-RunnerError exceptions unchanged", async () => {
    const primary = makeRunner({
      id: "a",
      behavior: async () => {
        throw new TypeError("bug");
      },
    });
    const secondary = makeRunner({ id: "b", behavior: async () => okResult("rescued") });
    const wrapped = withFallback(primary, secondary);
    await expect(wrapped.run(baseOpts)).rejects.toThrow(TypeError);
    expect(secondary.calls).toHaveLength(0);
  });
});
