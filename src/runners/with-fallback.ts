import type { LLMRunner, RunOptions, RunResult } from "./types.ts";
import { RunnerError } from "./types.ts";

/**
 * Hybrid between native provider fallback and wrapper-level fallback:
 *  - If `primary.capabilities.fallbackModel === true` and opts.fallbackModel
 *    is set → we don't wrap anything; the primary's adapter handles it (more
 *    efficient: a single invocation, the CLI does the switch internally).
 *  - If the primary does NOT support native fallback and a `secondary` is
 *    provided, we catch `retriable` errors and retry with `secondary`.
 *
 * `opts.fallbackModel` is preserved intact when delegating to the primary so
 * adapters with native fallback receive it. When falling through to the
 * `secondary`, we drop it from opts (the secondary normally doesn't
 * understand it).
 */
export function withFallback(primary: LLMRunner, secondary?: LLMRunner): LLMRunner {
  if (!secondary) return primary;

  return {
    id: `${primary.id}+${secondary.id}`,
    capabilities: primary.capabilities,
    async run(opts: RunOptions): Promise<RunResult> {
      try {
        return await primary.run(opts);
      } catch (err) {
        if (!(err instanceof RunnerError)) throw err;
        if (!err.retriable) throw err;
        // If the primary had native fallback and already tried it, don't
        // insist with the secondary — the failure is real, not overload.
        if (primary.capabilities.fallbackModel && opts.fallbackModel) throw err;
        const { fallbackModel: _drop, ...rest } = opts;
        process.stderr.write(
          `[withFallback] ${primary.id} failed (retriable) → retrying with ${secondary.id}\n`,
        );
        return await secondary.run(rest);
      }
    },
  };
}
