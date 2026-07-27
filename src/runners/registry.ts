import type { JanusConfig } from "../config/types.ts";
import { ClaudeCodeRunner } from "./claude-code.ts";
import { GeminiRunner } from "./gemini.ts";
import { CodexRunner } from "./codex.ts";
import type { LLMRunner } from "./types.ts";
import { withFallback } from "./with-fallback.ts";
import { redactingRunner } from "./redacting.ts";
import {
  compileAllowList,
  compileUserPattern,
  type RedactOptions,
  type RedactPattern,
} from "../core/privacy/redact.ts";
import { PROVIDER_IDS, type ProviderId } from "../config/providers.ts";

export type { ProviderId } from "../config/providers.ts";

export function isValidProvider(s: string): s is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(s);
}

export function createRunner(provider: ProviderId): LLMRunner {
  switch (provider) {
    case "claude-code": return new ClaudeCodeRunner();
    case "gemini-cli": return new GeminiRunner();
    case "codex": return new CodexRunner();
  }
}

/**
 * Factory that resolves the runner from config. Applies `withFallback`
 * if the config defines `fallbackProvider`, and wraps everything in
 * `redactingRunner` so the privacy layer can't be bypassed by callers
 * that forget to redact. Default remains "claude-code" + redaction on.
 */
export function resolveRunner(config: JanusConfig, repoRoot?: string): LLMRunner {
  const primary = createRunner(config.provider ?? "claude-code");
  const fb = config.fallbackProvider;
  const base = !fb || fb === (config.provider ?? "claude-code")
    ? primary
    : withFallback(primary, withoutPrimaryModelSettings(createRunner(fb)));

  const privacy = config.privacy;
  if (privacy && privacy.enabled === false) return base;

  const extraPatterns: RedactPattern[] = [];
  for (const raw of privacy?.extraPatterns ?? []) {
    const compiled = compileUserPattern(raw);
    if (compiled) extraPatterns.push(compiled);
    else console.warn(`[privacy] skipping malformed extra pattern: ${raw.name}`);
  }

  const opts: RedactOptions = {
    disablePatterns: privacy?.disablePatterns,
    allowList: compileAllowList(privacy?.allowList),
    extraPatterns,
    collapseHome: privacy?.collapsePaths ?? true,
    repoRoot,
  };
  return redactingRunner(base, opts);
}

function withoutPrimaryModelSettings(runner: LLMRunner): LLMRunner {
  return {
    id: runner.id,
    capabilities: runner.capabilities,
    run: (opts) => runner.run({
      ...opts,
      model: undefined,
      effort: undefined,
      fallbackModel: undefined,
    }),
  };
}
