import type { LLMRunner, RunnerCapabilities, RunOptions, RunResult } from "./types.ts";
import { RunnerError } from "./types.ts";
import { cleanEnv, drainToString, safeParse } from "./util.ts";

const CAPABILITIES: RunnerCapabilities = {
  // Gemini CLI allows `--resume <id>` but does not allow *setting* the id at
  // launch (issue google-gemini/gemini-cli#20847). We model it as:
  // capture the returned id and let the caller decide whether to use it later.
  sessionResume: true,
  effortControl: false,
  costTracking: true,
  addDirs: false,
  jsonStream: true,
  disableTools: false,
  fallbackModel: false,
};

/**
 * Adapter for `gemini -p` (Gemini CLI, Google).
 *
 * Structural differences from Claude Code that the adapter normalizes:
 *  - The output comes as ONE JSON object at the end (not streaming), via
 *    `--output-format json`. We have no intermediate turns to log.
 *  - sessionId is NOT settable at launch — you can only resume an existing
 *    session. If `opts.sessionId` is provided, we pass it to `--resume`;
 *    otherwise Gemini creates a new one and returns it in the JSON.
 *  - There is no flag to disable tools. The prompt must be explicit enough
 *    for the agent to respond in markdown.
 *  - No `--effort`, `--fallback-model`, or `--add-dir`. Those opts are
 *    silently ignored (the capability flag warns the caller).
 */
export class GeminiRunner implements LLMRunner {
  readonly id = "gemini-cli";
  readonly capabilities = CAPABILITIES;

  async run(opts: RunOptions): Promise<RunResult> {
    const args = buildArgs(opts);
    const env = cleanEnv(process.env);
    const startMs = performance.now();
    const tag = opts.logTag ? `[gemini ${opts.logTag}]` : "[gemini]";

    process.stderr.write(`${tag} spawn (model=${opts.model ?? "default"})\n`);

    const proc = Bun.spawn(["gemini", ...args], {
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

    try {
      // Gemini emits the entire result in stdout as a single JSON object
      // (mode --output-format json), not streaming.
      const [stdoutText, stderrText] = await Promise.all([
        drainToString(proc.stdout),
        drainToString(proc.stderr),
      ]);
      await proc.exited;
      const durationMs = Math.round(performance.now() - startMs);
      const exitCode = proc.exitCode ?? -1;

      if (exitCode !== 0) {
        throw new RunnerError(
          `gemini exited with code ${exitCode}`,
          exitCode,
          stderrText.trim(),
          exitCode !== 1,
          stdoutText.trim() || undefined,
        );
      }

      const parsed = safeParse(stdoutText.trim());
      if (!parsed) {
        throw new RunnerError(
          "gemini returned non-JSON stdout (expected from --output-format json)",
          exitCode,
          stderrText.trim(),
          false,
          stdoutText.slice(0, 500),
        );
      }

      const resultText = readString(parsed, ["response", "text", "result"]) ?? "";
      const sessionId = readString(parsed, ["session_id", "sessionId", "id"]);
      const stats = (parsed.stats ?? parsed.usage) as Record<string, unknown> | undefined;
      const totalCostUsd =
        readNumber(stats, ["total_cost_usd", "totalCostUsd", "cost_usd"]) ??
        readNumber(parsed, ["total_cost_usd", "totalCostUsd"]);

      if (!resultText) {
        throw new RunnerError(
          "gemini returned JSON without a recognizable response field",
          exitCode,
          stderrText.trim(),
          false,
          stdoutText.slice(0, 500),
        );
      }

      process.stderr.write(`${tag} ok (${resultText.length} chars, ${durationMs}ms)\n`);

      return {
        sessionId: sessionId ?? null,
        resultText,
        totalCostUsd: totalCostUsd ?? null,
        durationMs,
        numTurns: null,
        exitCode,
      };
    } finally {
      opts.signal?.removeEventListener("abort", abortHandler);
    }
  }
}

function buildArgs(opts: RunOptions): string[] {
  const args: string[] = ["--prompt", "-", "--output-format", "json"];
  if (opts.model) args.push("--model", opts.model);
  if (opts.sessionId) args.push("--resume", opts.sessionId);
  return args;
}

function readString(obj: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function readNumber(obj: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}
