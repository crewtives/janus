/**
 * Privacy / PII redaction layer.
 *
 * Sole chokepoint for outbound LLM text: `redact()` is a pure function applied
 * to the rendered prompt by `src/runners/redacting.ts` before the LLM ever sees
 * it. New code paths do not need to opt in — wrapping happens in
 * `resolveRunner()`, so any caller that goes through the registry is covered.
 *
 * Order of patterns matters: more specific tokens come first so that, e.g.,
 * an Anthropic key (`sk-ant-…`) isn't shortened by the OpenAI shape (`sk-…`).
 * Path collapse runs last so `repoRoot` substitutions stay intact.
 */

export interface RedactPattern {
  /** Stable identifier — referenced from config `disablePatterns`. */
  name: string;
  /** Must be `/g`. */
  pattern: RegExp;
  /** Static replacement string or `(match) => string`. */
  replacement: string;
}

export interface RedactOptions {
  /** Collapse `/Users/<x>/` and `/home/<x>/` to `~` after repoRoot substitution. Default true. */
  collapseHome?: boolean;
  /** Project repo root. When set, leading prefix becomes `<repo>` (preserves intra-repo relative paths). */
  repoRoot?: string;
  /** Regex strings whose matches are exempt from redaction, even if another pattern matches them. */
  allowList?: RegExp[];
  /** Additional patterns applied after CORE_PATTERNS. */
  extraPatterns?: RedactPattern[];
  /** Pattern names to skip (from CORE_PATTERNS or extraPatterns). */
  disablePatterns?: string[];
  /** If true, returns the input unchanged. */
  disabled?: boolean;
}

const DEFAULT_EMAIL_ALLOW: RegExp[] = [/noreply@/i, /@anthropic\.com\b/i];

/**
 * Built-in patterns. Order matters — specific shapes first.
 *
 * Path-collapse patterns (`home-path-*`) are *not* in this list; they need
 * `repoRoot` from `RedactOptions` and run as a separate stage.
 */
export const CORE_PATTERNS: readonly RedactPattern[] = [
  { name: "anthropic-key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: "<anthropic-key>" },
  { name: "openai-key", pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, replacement: "<openai-key>" },
  { name: "github-pat", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g, replacement: "<github-pat>" },
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: "<aws-access-key>" },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: "<jwt>" },
  { name: "discord-webhook", pattern: /https:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g, replacement: "<discord-webhook>" },
  { name: "slack-webhook", pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g, replacement: "<slack-webhook>" },
  { name: "bearer-token", pattern: /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{20,}=*/g, replacement: "Bearer <token>" },
  { name: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "<private-key>" },
  { name: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: "<email>" },
];

const HOME_PATH_PATTERNS: readonly RedactPattern[] = [
  { name: "home-path-mac", pattern: /\/Users\/[^/\s"'<>`]+/g, replacement: "~" },
  { name: "home-path-linux", pattern: /\/home\/[^/\s"'<>`]+/g, replacement: "~" },
  { name: "home-path-win", pattern: /[A-Z]:\\Users\\[^\\\s"'<>]+/g, replacement: "~" },
];

/**
 * Apply redaction to a text. Pure function — no side effects beyond regex
 * compilation, which is amortized via `CORE_PATTERNS`.
 */
export function redact(text: string, opts: RedactOptions = {}): string {
  if (opts.disabled) return text;
  if (!text) return text;

  const allowList = [...(opts.allowList ?? []), ...DEFAULT_EMAIL_ALLOW];
  const disabled = new Set(opts.disablePatterns ?? []);

  let out = text;

  // Stage 1: repo-root replacement. Done first so intra-repo paths survive the
  // home-path collapse that runs at the end.
  if (opts.repoRoot) {
    const escapedRoot = opts.repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const repoRe = new RegExp(escapedRoot, "g");
    out = out.replace(repoRe, "<repo>");
  }

  // Stage 2: secret/email patterns. Skip matches that intersect an allowList
  // entry so the user can preserve, e.g., `noreply@anthropic.com` in
  // Co-Authored-By trailers.
  const patterns = [...CORE_PATTERNS, ...(opts.extraPatterns ?? [])];
  for (const p of patterns) {
    if (disabled.has(p.name)) continue;
    out = applyPattern(out, p, allowList);
  }

  // Stage 3: home-path collapse. Runs last to catch any path that wasn't
  // anchored to repoRoot.
  if (opts.collapseHome !== false) {
    for (const p of HOME_PATH_PATTERNS) {
      if (disabled.has(p.name)) continue;
      out = applyPattern(out, p, allowList);
    }
  }

  return out;
}

function applyPattern(text: string, p: RedactPattern, allowList: RegExp[]): string {
  return text.replace(p.pattern, (match) => {
    for (const allow of allowList) {
      if (allow.test(match)) return match;
    }
    return p.replacement;
  });
}

/**
 * Translate a user-provided JSON-friendly pattern spec into a runtime
 * `RedactPattern`. Compilation errors are returned as null so callers can
 * skip individual entries without disabling the whole redaction layer
 * (fail-closed at the layer level, fail-soft at the pattern level).
 */
export function compileUserPattern(raw: {
  name: string;
  pattern: string;
  flags?: string;
  replacement: string;
}): RedactPattern | null {
  try {
    const flags = raw.flags ?? "g";
    const pattern = new RegExp(raw.pattern, flags.includes("g") ? flags : `${flags}g`);
    return { name: raw.name, pattern, replacement: raw.replacement };
  } catch {
    return null;
  }
}

export function compileAllowList(raw: string[] | undefined): RegExp[] {
  if (!raw) return [];
  const out: RegExp[] = [];
  for (const s of raw) {
    try {
      out.push(new RegExp(s));
    } catch {
      // Skip malformed entries silently; documented behavior.
    }
  }
  return out;
}
