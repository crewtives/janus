import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexRunner } from "../src/runners/codex.ts";
import { RunnerError } from "../src/runners/types.ts";

let binDir: string;
let originalPath: string | undefined;
let originalOpenAiKey: string | undefined;

async function fakeCodex(lines: string[], code = 0, outputText?: string): Promise<void> {
  const body = lines.map((line) => `printf '%s\\n' ${JSON.stringify(line)}`).join("\n");
  const writeOutput = outputText === undefined
    ? ""
    : `if [ -n \"$output_path\" ]; then printf '%s' ${JSON.stringify(outputText)} > \"$output_path\"; fi`;
  await writeFile(
    join(binDir, "codex"),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(binDir, "args")}"\nprintf '%s' "\${OPENAI_API_KEY:-}" > "${join(binDir, "openai-key")}"\noutput_path=\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--output-last-message" ]; then output_path="$2"; shift; fi\n  shift\ndone\ncat > "${join(binDir, "stdin")}"\n${body}\n${writeOutput}\nexit ${code}\n`,
  );
  await chmod(join(binDir, "codex"), 0o755);
}

beforeAll(async () => {
  binDir = await mkdtemp(join(tmpdir(), "janus-codex-runner-"));
  originalPath = process.env.PATH;
  originalOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  process.env.OPENAI_API_KEY = "should-not-reach-codex";
});

afterAll(() => {
  process.env.PATH = originalPath;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

const opts = {
  prompt: "large private prompt",
  cwd: process.cwd(),
  model: "gpt-test",
  effort: "high" as const,
  timeoutMs: 30_000,
};

describe("CodexRunner", () => {
  test("uses an isolated read-only ephemeral invocation and reads the last agent message", async () => {
    await fakeCodex([
      `{"type":"thread.started","thread_id":"thread-neutral"}`,
      `{"type":"turn.started"}`,
      `{"type":"item.completed","item":{"type":"agent_message","text":"draft"}}`,
      `{"type":"item.completed","item":{"type":"agent_message","text":"# final"}}`,
      `{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":4}}`,
    ]);
    const result = await new CodexRunner().run(opts);
    expect(result.resultText).toBe("# final");
    expect(result.sessionId).toBe("thread-neutral");
    expect(result.numTurns).toBe(1);
    expect(await readFile(join(binDir, "stdin"), "utf8")).toBe(opts.prompt);
    const args = (await readFile(join(binDir, "args"), "utf8")).trim().split("\n");
    expect(args).toContain("exec");
    expect(args).toContain("--json");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    expect(args.filter((arg) => arg === "--disable")).toHaveLength(3);
    expect(args).toContain("hooks");
    expect(args).toContain("plugins");
    expect(args).toContain("apps");
    expect(args).toContain("read-only");
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("--output-last-message");
    expect(args).toContain("-");
    expect(args.join(" ")).not.toContain(opts.prompt);
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect((await readFile(join(binDir, "stdin"), "utf8"))).toBe(opts.prompt);
    expect(await readFile(join(binDir, "openai-key"), "utf8")).toBe("");
  });

  test("prefers Codex's output-last-message file over streamed draft text", async () => {
    await fakeCodex([
      `{"type":"item.completed","item":{"type":"agent_message","text":"streamed draft"}}`,
      `{"type":"turn.completed"}`,
    ], 0, "# output file wins");
    expect((await new CodexRunner().run(opts)).resultText).toBe("# output file wins");
  });

  test("rejects a successful process without a final agent message", async () => {
    await fakeCodex([`{"type":"thread.started","thread_id":"thread-neutral"}`]);
    const err = await new CodexRunner().run(opts).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(RunnerError);
    expect((err as RunnerError).retriable).toBe(false);
  });

  test("preserves partial output for a non-zero process", async () => {
    await fakeCodex([
      `{"type":"item.completed","item":{"type":"agent_message","text":"partial"}}`,
    ], 2);
    const err = await new CodexRunner().run(opts).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(RunnerError);
    expect((err as RunnerError).partialResult).toBe("partial");
    expect((err as RunnerError).retriable).toBe(true);
  });

  test("ignores malformed JSONL while retaining valid events", async () => {
    await fakeCodex([
      "not-json",
      `{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}`,
      `{"type":"turn.completed","usage":{}}`,
    ]);
    expect((await new CodexRunner().run(opts)).resultText).toBe("ok");
  });

  test("rejects a partial message followed by turn.failed", async () => {
    await fakeCodex([
      `{"type":"item.completed","item":{"type":"agent_message","text":"partial"}}`,
      `{"type":"turn.failed","error":{"message":"model unavailable"}}`,
    ]);
    const err = await new CodexRunner().run(opts).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(RunnerError);
    expect((err as RunnerError).message).toContain("model unavailable");
    expect((err as RunnerError).partialResult).toBeUndefined();
    expect((err as RunnerError).retriable).toBe(true);
  });

  test("does not retry a permanent structured failure", async () => {
    await fakeCodex([
      `{"type":"turn.failed","error":{"message":"invalid model configuration"}}`,
    ]);
    const err = await new CodexRunner().run(opts).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(RunnerError);
    expect((err as RunnerError).retriable).toBe(false);
  });
});
