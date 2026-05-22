export type ProjectStatus = "active" | "paused" | "archived";

export interface ProjectConfig {
  /** Project identifier. Used as a slug in files and SQLite. */
  name: string;
  /** Absolute path to the project's git repo. */
  repoPath: string;
  /** Absolute path to the project's folder inside the Obsidian vault. */
  obsidianPath: string;
  /**
   * Project status. Default: "active".
   *   - active:   normal pulses every day.
   *   - paused:   only generates a pulse if there are commits that day (no idle).
   *   - archived: not processed at all (full skip).
   */
  status?: ProjectStatus;
}

export interface DiscordConfig {
  /** Webhook URL (gitignored, lives in config.local.json). */
  webhookUrl?: string;
  /** Visible bot name in messages. */
  username?: string;
}

export interface JanusConfig {
  /** Absolute path to the Obsidian vault root. */
  obsidianVault: string;
  /** Projects to monitor. */
  projects: ProjectConfig[];
  /**
   * Patterns for project auto-discovery. Each entry can be:
   *   - Plain path: `~/projects/crewtives` → recursive scan up to depth 3.
   *   - Glob with `*`: `~/projects/crewtives/*` → expands the glob, each match is a candidate.
   *   - Glob with `**`: `~/projects/crewtives/**` → deep recursive.
   * If unset, `janus discover` infers from the common dirname of current repoPaths.
   */
  discoverRoots?: string[];
  /** Discord config (optional). */
  discord?: DiscordConfig;
  /** Queue concurrency. Default: 2 */
  concurrency?: number;
  /** Tasks cap per interval (rate limit). Default: 5 per 60s */
  intervalCap?: number;
  intervalMs?: number;
  /** Per-task timeout in ms. Default: 30min */
  taskTimeoutMs?: number;
  /** Path where Janus stores state (.janus/). Default: cwd/.janus */
  stateDir?: string;
  /** Active provider model. Default: sonnet (Claude). */
  model?: string;
  /** Effort level. Only used by providers that support it (Claude). Default: xhigh */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Fallback model if the primary is overloaded. Default: opus (Claude). */
  fallbackModel?: string;
  /**
   * CLI agent used to generate reports.
   *  - "claude-code" (default): spawns `claude -p`.
   *  - "gemini-cli": spawns `gemini --prompt - --output-format json`.
   */
  provider?: "claude-code" | "gemini-cli";
  /** If the primary provider fails with a retriable error, retry with this one. */
  fallbackProvider?: "claude-code" | "gemini-cli";
  /**
   * UI language for the `janus init` wizard. Defaults to "en". Set to "es"
   * to run the wizard in Spanish. Does NOT affect generated pulse content —
   * pulses are always generated in English by the prompts. To localize pulse
   * output, customize the prompts via overrides.
   */
  language?: "en" | "es";
  /**
   * Privacy / PII redaction layer. Defaults are safe (enabled) — see
   * `docs/PRIVACY.md` for what gets redacted and how to opt out.
   */
  privacy?: PrivacyConfig;
}

export interface PrivacyConfig {
  /** Master switch. Default: true. */
  enabled?: boolean;
  /** Built-in pattern names to skip (e.g. `["email"]`). */
  disablePatterns?: string[];
  /** Additional patterns applied after the built-ins. */
  extraPatterns?: Array<{
    name: string;
    /** Source string for a `RegExp`. */
    pattern: string;
    /** Optional flags (`g` is forced if absent). */
    flags?: string;
    /** Replacement string. */
    replacement: string;
  }>;
  /** Regex strings whose matches survive redaction (e.g. `noreply@anthropic.com`). */
  allowList?: string[];
  /** Replace `$HOME` / repoRoot prefixes with `~` / `<repo>`. Default: true. */
  collapsePaths?: boolean;
}

export interface PulseTaskKey {
  project: string;
  date: string; // YYYY-MM-DD
}
