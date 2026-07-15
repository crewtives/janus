import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeRunner } from "../src/runners/claude-code.ts";
import { RunnerError } from "../src/runners/types.ts";

/**
 * These tests stub the `claude` binary with a shell script that replays canned
 * stream-json lines. No real LLM call, no network, no cost.
 */
let binDir: string;
let originalPath: string | undefined;

const INIT_LINE =
  `{"type":"system","subtype":"init","session_id":"11111111-2222-3333-4444-555555555555"}`;

/** Installs a fake `claude` that prints `lines` to stdout and exits `code`. */
async function fakeClaude(lines: string[], code = 0): Promise<void> {
  const body = lines.map((l) => `printf '%s\\n' ${JSON.stringify(l)}`).join("\n");
  await writeFile(
    join(binDir, "claude"),
    `#!/bin/sh\n# drain stdin (the prompt) so the parent never sees EPIPE\ncat > /dev/null\n${body}\nexit ${code}\n`,
  );
  await chmod(join(binDir, "claude"), 0o755);
}

beforeAll(async () => {
  binDir = await mkdtemp(join(tmpdir(), "janus-fakebin-"));
  originalPath = process.env.PATH;
  // Prepended so it wins over any real `claude`. cleanEnv() keeps the original
  // PATH at the front when it enriches, so the child resolves the fake too.
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
});

afterAll(() => {
  process.env.PATH = originalPath;
});

const opts = { prompt: "p", cwd: process.cwd(), timeoutMs: 30_000 };

describe("ClaudeCodeRunner — a reported error is an error, not a log line", () => {
  test("is_error:true with exit 0 throws instead of returning the error text as content", async () => {
    // The CLI signals failure in the result message while still exiting 0. The
    // old code only wrote it to stderr and returned normally, so callers wrote
    // the error string (or "") to the vault as if it were content.
    await fakeClaude([
      INIT_LINE,
      `{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Error: execution failed","num_turns":3}`,
    ]);
    const err = await new ClaudeCodeRunner().run(opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunnerError);
    const re = err as RunnerError;
    expect(re.message).toContain("error_during_execution");
    expect(re.retriable).toBe(true);
    expect(re.partialResult).toBe("Error: execution failed");
  });

  test("is_error:true with an empty result still throws", async () => {
    await fakeClaude([
      INIT_LINE,
      `{"type":"result","subtype":"error_max_turns","is_error":true,"result":"","num_turns":30}`,
    ]);
    const err = await new ClaudeCodeRunner().run(opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunnerError);
    expect((err as RunnerError).message).toContain("error_max_turns");
    expect((err as RunnerError).partialResult).toBeUndefined();
  });

  test("is_error:false returns the result text (the throw does not fire on success)", async () => {
    await fakeClaude([
      INIT_LINE,
      `{"type":"assistant"}`,
      `{"type":"result","subtype":"success","is_error":false,"result":"# hello","total_cost_usd":0.01,"num_turns":2}`,
    ]);
    const r = await new ClaudeCodeRunner().run(opts);
    expect(r.resultText).toBe("# hello");
    expect(r.exitCode).toBe(0);
    expect(r.totalCostUsd).toBe(0.01);
    expect(r.numTurns).toBe(2);
  });

  test("a result with no is_error field is treated as success", async () => {
    await fakeClaude([
      INIT_LINE,
      `{"type":"result","subtype":"success","result":"ok"}`,
    ]);
    const r = await new ClaudeCodeRunner().run(opts);
    expect(r.resultText).toBe("ok");
  });

  test("a non-zero exit still throws first, keeping the pre-existing behavior", async () => {
    await fakeClaude([INIT_LINE], 2);
    const err = await new ClaudeCodeRunner().run(opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunnerError);
    expect((err as RunnerError).message).toContain("exited with code 2");
  });

  test("no init message throws as not retriable", async () => {
    await fakeClaude([`{"type":"result","subtype":"success","result":"ok"}`]);
    const err = await new ClaudeCodeRunner().run(opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunnerError);
    expect((err as RunnerError).retriable).toBe(false);
  });
});
