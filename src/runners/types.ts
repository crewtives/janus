/**
 * Neutral contract for invoking a coding CLI agent (Claude Code,
 * Gemini CLI, Qwen Code, Codex, …) and getting a single response text.
 *
 * Contract decisions:
 *  - Prompt always via STDIN — universal across CLIs and avoids argv size limits.
 *  - Timeout/abort are implemented in the wrapper, not via CLI flag.
 *  - Model fallback: if capabilities.fallbackModel === true, the adapter
 *    handles it (more efficient, avoids re-spawn); if false, `withFallback`
 *    retries with another runner. The wrapper picks based on capability.
 *  - Cost: null when the provider doesn't report it. We never estimate.
 */

export interface RunnerCapabilities {
  /** The runner accepts a `sessionId` input and/or returns one usable for resume. */
  sessionResume: boolean;
  /** The runner supports a "reasoning effort" axis mappable to low/medium/high/max. */
  effortControl: boolean;
  /** The runner reports cost in USD in the result. */
  costTracking: boolean;
  /** The runner can expose additional directories to the agent (e.g. Obsidian vault). */
  addDirs: boolean;
  /** The runner emits stream-json or another structured format parseable line by line. */
  jsonStream: boolean;
  /** The runner can disable internal tool use (force text-only output). */
  disableTools: boolean;
  /** The runner accepts a native fallback model (delegates failover to the CLI). */
  fallbackModel: boolean;
}

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface RunOptions {
  prompt: string;
  cwd: string;
  /** Main model. Adapter-specific when normalization is needed. */
  model?: string;
  /** Ignored by adapters with capabilities.effortControl === false. */
  effort?: EffortLevel;
  /**
   * Native fallback model. Only adapters with
   * capabilities.fallbackModel === true respect it. The rest ignore it; use
   * `withFallback(primary, secondary)` for portability.
   */
  fallbackModel?: string;
  /** Ignored by adapters with capabilities.addDirs === false. */
  addDirs?: string[];
  /** For resume if capabilities.sessionResume; some adapters ignore it at launch. */
  sessionId?: string;
  maxTurns?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Tag for logs. Typically "<project>/<date>". */
  logTag?: string;
  /**
   * Escape hatch for 100% provider-specific flags (e.g. `permissionMode` for
   * Claude Code). Each adapter documents which keys it understands.
   */
  providerOpts?: Record<string, unknown>;
}

export interface RunResult {
  /** sessionId observed or returned by the provider. null if not applicable. */
  sessionId: string | null;
  /** Final text the agent returned. */
  resultText: string;
  /** USD billed. null if the provider doesn't report cost. */
  totalCostUsd: number | null;
  durationMs: number;
  /** Agent turns. null if the provider doesn't report. */
  numTurns: number | null;
  exitCode: number;
}

export class RunnerError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    /**
     * The retry/fallback wrapper uses this to decide whether retrying is
     * worthwhile (overload, rate-limit, network) or to abort (invalid input,
     * auth missing).
     */
    readonly retriable: boolean,
    readonly partialResult?: string,
  ) {
    super(message);
    this.name = "RunnerError";
  }
}

export interface LLMRunner {
  /** Stable identifier. e.g. "claude-code", "gemini-cli". */
  readonly id: string;
  readonly capabilities: RunnerCapabilities;
  run(opts: RunOptions): Promise<RunResult>;
}
