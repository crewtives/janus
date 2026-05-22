/**
 * LLM runner decorator that applies privacy redaction to `opts.prompt` before
 * delegating. Wrapping happens in `resolveRunner()` so callers don't need to
 * remember to redact themselves — single bypass-resistant chokepoint.
 *
 * The wrapper preserves the underlying runner's `id`, `capabilities`, and
 * cost/duration accounting. It only mutates `opts.prompt` and, when set,
 * `opts.logTag` (untouched here, just passed through).
 */
import type { LLMRunner, RunOptions, RunResult } from "./types.ts";
import { redact, type RedactOptions } from "../core/privacy/redact.ts";

export function redactingRunner(base: LLMRunner, opts: RedactOptions): LLMRunner {
  return {
    id: base.id,
    capabilities: base.capabilities,
    async run(runOpts: RunOptions): Promise<RunResult> {
      const redactedPrompt = redact(runOpts.prompt, opts);
      return base.run({ ...runOpts, prompt: redactedPrompt });
    },
  };
}
