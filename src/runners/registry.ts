import type { JanusConfig } from "../config/types.ts";
import { ClaudeCodeRunner } from "./claude-code.ts";
import { GeminiRunner } from "./gemini.ts";
import type { LLMRunner } from "./types.ts";
import { withFallback } from "./with-fallback.ts";
import { redactingRunner } from "./redacting.ts";
import {
  compileAllowList,
  compileUserPattern,
  type RedactOptions,
  type RedactPattern,
} from "../core/privacy/redact.ts";

export type ProviderId = "claude-code" | "gemini-cli";

const ALL_PROVIDERS: ProviderId[] = ["claude-code", "gemini-cli"];

export function isValidProvider(s: string): s is ProviderId {
  return (ALL_PROVIDERS as string[]).includes(s);
}

export function createRunner(provider: ProviderId): LLMRunner {
  switch (provider) {
    case "claude-code": return new ClaudeCodeRunner();
    case "gemini-cli": return new GeminiRunner();
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
    : withFallback(primary, createRunner(fb));

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
