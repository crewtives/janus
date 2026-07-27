import type { LLMRunner, RunnerCapabilities, RunOptions, RunResult } from "./types.ts";
import { RunnerError } from "./types.ts";
import { cleanEnv, drainToString, safeParse, streamLines } from "./util.ts";

const CAPABILITIES: RunnerCapabilities = {
  sessionResume: false,
  effortControl: true,
  costTracking: false,
  addDirs: false,
  jsonStream: true,
  disableTools: false,
  fallbackModel: false,
};

export class CodexRunner implements LLMRunner {
  readonly id = "codex";
  readonly capabilities = CAPABILITIES;

  async run(opts: RunOptions): Promise<RunResult> {
    const runDir = await mkdtemp(join(tmpdir(), "janus-codex-"));
    try {
      const outputPath = join(runDir, "last-message.md");
      const args = buildArgs(opts, runDir, outputPath);
      const startMs = performance.now();
      const tag = opts.logTag ? `[codex ${opts.logTag}]` : "[codex]";
      const proc = Bun.spawn(["codex", ...args], {
        cwd: runDir,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        // Match the Claude adapter: Codex may otherwise prefer an API key over
        // the user's local CLI login, unexpectedly billing API usage.
        env: cleanEnv(process.env, ["OPENAI_API_KEY"]),
        timeout: opts.timeoutMs ?? 30 * 60_000,
        killSignal: "SIGTERM",
      });
      const stderrPromise = drainToString(proc.stderr, 128 * 1024);
      const stdin = proc.stdin;
      if (!stdin) throw new Error("Bun.spawn did not return a stdin pipe");
      stdin.write(opts.prompt);
      await stdin.end();

      const abortHandler = () => proc.kill("SIGTERM");
      opts.signal?.addEventListener("abort", abortHandler);
      let resultText = "";
      let sessionId: string | null = null;
      let numTurns = 0;
      let turnCompleted = false;
      let failureMessage = "";
      try {
        await streamLines(proc.stdout, (line) => {
          const event = safeParse(line);
          if (!event) return;
          if (event.type === "thread.started" && typeof event.thread_id === "string") {
            sessionId = event.thread_id;
          }
          if (event.type === "turn.completed") {
            numTurns += 1;
            turnCompleted = true;
          }
          if (event.type === "turn.failed") {
            const error = event.error as { message?: unknown } | undefined;
            failureMessage = typeof error?.message === "string" ? error.message : "turn failed";
          }
          if (event.type === "error") {
            const error = event.error as { message?: unknown } | undefined;
            const message = event.message ?? error?.message;
            if (typeof message === "string") failureMessage = message;
          }
          if (event.type === "item.completed") {
            const item = event.item as Record<string, unknown> | undefined;
            if (item?.type === "agent_message" && typeof item.text === "string") {
              resultText = item.text;
            }
          }
        });
        await proc.exited;
        const stderr = (await stderrPromise).trim();
        const exitCode = proc.exitCode ?? -1;
        if (failureMessage) {
          throw new RunnerError(
            `codex reported failure: ${failureMessage}`,
            exitCode,
            stderr,
            isRetriableCodexFailure(failureMessage),
          );
        }
        if (exitCode !== 0) {
          throw new RunnerError(
            `codex exited with code ${exitCode}`,
            exitCode,
            stderr,
            exitCode !== 1,
            resultText || undefined,
          );
        }
        if (!turnCompleted) {
          throw new RunnerError(
            "codex exited without a terminal turn.completed event",
            exitCode,
            stderr,
            false,
            resultText || undefined,
          );
        }
        try {
          const output = await readFile(outputPath, "utf-8");
          if (output.trim()) resultText = output;
        } catch {
          // Older compatible CLIs may omit the output file; the JSONL final item remains authoritative.
        }
        if (!resultText.trim()) {
          throw new RunnerError(
            "codex returned no final agent message",
            exitCode,
            stderr,
            false,
          );
        }
        process.stderr.write(`${tag} ok (${resultText.length} chars)\n`);
        return {
          sessionId,
          resultText,
          totalCostUsd: null,
          durationMs: Math.round(performance.now() - startMs),
          numTurns,
          exitCode,
        };
      } finally {
        opts.signal?.removeEventListener("abort", abortHandler);
      }
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }
}

function buildArgs(opts: RunOptions, runDir: string, outputPath: string): string[] {
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--disable", "hooks",
    "--disable", "plugins",
    "--disable", "apps",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--cd", runDir,
    "--output-last-message", outputPath,
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--config", `model_reasoning_effort=${JSON.stringify(opts.effort)}`);
  args.push("-");
  return args;
}

function isRetriableCodexFailure(message: string): boolean {
  return /rate.?limit|temporar|unavailable|overload|network|timeout|connection/i.test(message);
}
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
