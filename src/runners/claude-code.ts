import { randomUUID } from "node:crypto";
import type { LLMRunner, RunnerCapabilities, RunOptions, RunResult } from "./types.ts";
import { RunnerError } from "./types.ts";
import { cleanEnv, safeParse, streamLines } from "./util.ts";

const CAPABILITIES: RunnerCapabilities = {
  sessionResume: true,
  effortControl: true,
  costTracking: true,
  addDirs: true,
  jsonStream: true,
  disableTools: true,
  fallbackModel: true,
};

type PermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "default"
  | "dontAsk"
  | "plan";

/**
 * Adapter for `claude -p` (Claude Code CLI).
 * Preserves the historical behavior of `runClaude`:
 *  - Prompt via STDIN (avoids argv size limit).
 *  - Drains stderr in parallel to avoid blocking the pipe.
 *  - Strips ANTHROPIC_API_KEY → forces OAuth/Max sub.
 *  - Disables tools (--tools "") so the agent returns markdown as the
 *    result, instead of writing files itself.
 *  - Intermediate logs to the parent's stderr when logTag is set.
 */
export class ClaudeCodeRunner implements LLMRunner {
  readonly id = "claude-code";
  readonly capabilities = CAPABILITIES;

  async run(opts: RunOptions): Promise<RunResult> {
    const sessionId = opts.sessionId ?? randomUUID();
    const args = buildArgs(opts, sessionId);
    const env = cleanEnv(process.env, ["ANTHROPIC_API_KEY"]);
    const startMs = performance.now();
    const tag = opts.logTag ? `[claude ${opts.logTag}]` : "[claude]";

    const proc = Bun.spawn(["claude", ...args], {
      cwd: opts.cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env,
      timeout: opts.timeoutMs ?? 30 * 60_000,
      killSignal: "SIGTERM",
    });

    const stdin = proc.stdin;
    if (!stdin) throw new Error("Bun.spawn did not return a stdin pipe");
    stdin.write(opts.prompt);
    await stdin.end();

    const abortHandler = () => proc.kill("SIGTERM");
    opts.signal?.addEventListener("abort", abortHandler);

    const stderrChunks: string[] = [];
    const stderrPromise = (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        stderrChunks.push(decoder.decode(value, { stream: true }));
      }
    })();

    let resultText = "";
    let totalCostUsd: number | null = null;
    let observedSessionId = sessionId;
    let numTurns = 0;
    let initSeen = false;

    try {
      await streamLines(proc.stdout, (line) => {
        const msg = safeParse(line);
        if (!msg) return;
        const type = msg.type as string | undefined;

        if (type === "system" && msg.subtype === "init" && typeof msg.session_id === "string") {
          observedSessionId = msg.session_id;
          initSeen = true;
          process.stderr.write(`${tag} init ok (session ${observedSessionId.slice(0, 8)})\n`);
        } else if (type === "system" && msg.subtype === "hook_started") {
          process.stderr.write(`${tag} hook: ${String(msg.hook_name ?? "?")}\n`);
        } else if (type === "assistant") {
          numTurns += 1;
          process.stderr.write(`${tag} turn ${numTurns} (assistant message)\n`);
        } else if (type === "rate_limit_event") {
          const info = msg.rate_limit_info as Record<string, unknown> | undefined;
          process.stderr.write(`${tag} rate_limit: ${JSON.stringify(info)}\n`);
        } else if (type === "result") {
          if (typeof msg.result === "string") resultText = msg.result;
          if (typeof msg.total_cost_usd === "number") totalCostUsd = msg.total_cost_usd;
          if (typeof msg.num_turns === "number") numTurns = msg.num_turns;
          const isError = msg.is_error === true;
          const subtype = String(msg.subtype ?? "");
          process.stderr.write(`${tag} result: subtype=${subtype} error=${isError} turns=${numTurns}\n`);
        }
      });

      await proc.exited;
      await stderrPromise;
      const durationMs = Math.round(performance.now() - startMs);
      const exitCode = proc.exitCode ?? -1;
      const stderr = stderrChunks.join("");

      if (!initSeen) {
        // Never started → likely an auth issue or CLI not installed.
        // Not retriable: re-spawning will fail the same way.
        throw new RunnerError(
          "claude never emitted an 'init' message — probably did not start",
          exitCode,
          stderr.trim(),
          false,
        );
      }

      if (exitCode !== 0) {
        throw new RunnerError(
          `claude exited with code ${exitCode}`,
          exitCode,
          stderr.trim(),
          // exit 1 is typically invalid input or auth → not retriable.
          // exit 137 (SIGKILL from timeout) or exit codes > 1 can be retriable.
          exitCode !== 1,
          resultText || undefined,
        );
      }

      return {
        sessionId: observedSessionId,
        resultText,
        totalCostUsd,
        durationMs,
        numTurns,
        exitCode,
      };
    } finally {
      opts.signal?.removeEventListener("abort", abortHandler);
    }
  }
}

function buildArgs(opts: RunOptions, sessionId: string): string[] {
  const permissionMode = readPermissionMode(opts.providerOpts) ?? "acceptEdits";
  const args: string[] = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--max-turns", String(opts.maxTurns ?? 30),
    "--permission-mode", permissionMode,
    "--session-id", sessionId,
    // Disables ALL tools — the agent must return the markdown as the final
    // result text, instead of using Write/Edit/Bash to write the file itself.
    // Without this, claude detects a path in the prompt and uses Write, leaving
    // our writePulse() to overwrite later with the "result text" (which is
    // a summary of the pulse, not the pulse itself).
    "--tools", "",
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.fallbackModel) args.push("--fallback-model", opts.fallbackModel);
  if (opts.addDirs?.length) args.push("--add-dir", ...opts.addDirs);
  return args;
}

function readPermissionMode(opts: Record<string, unknown> | undefined): PermissionMode | undefined {
  const v = opts?.permissionMode;
  if (typeof v !== "string") return undefined;
  const valid: PermissionMode[] = [
    "acceptEdits", "auto", "bypassPermissions", "default", "dontAsk", "plan",
  ];
  return (valid as string[]).includes(v) ? (v as PermissionMode) : undefined;
}
