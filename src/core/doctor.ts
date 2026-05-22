import { existsSync } from "node:fs";
import { isRepo } from "./git.ts";
import { loadConfig } from "../config/loader.ts";
import type { JanusConfig } from "../config/types.ts";

export type CheckResult = { name: string; ok: boolean; detail: string };
type ProviderId = NonNullable<JanusConfig["provider"]>;

/** Timeout for `claude auth status` — the call makes a network request and may hang. */
const CLAUDE_AUTH_TIMEOUT_MS = 10_000;

export async function runDoctor(): Promise<boolean> {
  const checks: CheckResult[] = [];

  checks.push(await checkCommand("git", ["--version"]));

  let config: JanusConfig | undefined;
  try {
    config = await loadConfig();
    checks.push({ name: "config", ok: true, detail: "found and parsed" });
  } catch (err) {
    checks.push({
      name: "config",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Provider checks — only checks the CLIs configured (primary + fallback).
  // If no valid config, conservative default: claude-code.
  const providersToCheck = uniq(
    config
      ? [config.provider ?? "claude-code", config.fallbackProvider].filter((p): p is ProviderId => !!p)
      : (["claude-code"] as ProviderId[]),
  );
  for (const provider of providersToCheck) {
    checks.push(...(await checkProvider(provider)));
  }

  if (config) {
    checks.push(checkPath("obsidianVault", config.obsidianVault));
    for (const p of config.projects) {
      checks.push(await checkProject(p.name, p.repoPath, p.obsidianPath, p.status ?? "active"));
    }
    checks.push(checkDiscord(config.discord?.webhookUrl));
  }

  printChecks(checks);
  return checks.every((c) => c.ok);
}

async function checkProvider(provider: ProviderId): Promise<CheckResult[]> {
  switch (provider) {
    case "claude-code":
      return [
        await checkCommand("claude", ["--version"]),
        await checkClaudeAuth(),
        checkAnthropicEnv(),
      ];
    case "gemini-cli":
      return [
        await checkCommand("gemini", ["--version"]),
        checkGeminiAuth(),
      ];
  }
}

async function checkCommand(cmd: string, args: string[]): Promise<CheckResult> {
  try {
    const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    const out = (await new Response(proc.stdout).text()).trim();
    if (proc.exitCode !== 0) return { name: cmd, ok: false, detail: `exit ${proc.exitCode}` };
    return { name: cmd, ok: true, detail: out };
  } catch (e) {
    return { name: cmd, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  subscriptionType?: string;
  authMethod?: string;
  email?: string;
}

/**
 * Calls `claude auth status` and parses the JSON. Has a 10s timeout because
 * the call performs a network request to validate the OAuth token and can
 * hang indefinitely with flaky networks or expired tokens.
 *
 * If you want the structured status (not just OK/fail), use `detectClaudeAuth`
 * from src/core/init/detect.ts, which returns `ClaudeAuthStatus | null`.
 */
export async function checkClaudeAuth(): Promise<CheckResult> {
  const proc = Bun.spawn(["claude", "auth", "status"], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: CLAUDE_AUTH_TIMEOUT_MS,
  });
  await proc.exited;
  if (proc.exitCode === null) {
    return {
      name: "claude auth",
      ok: false,
      detail: `timeout (${CLAUDE_AUTH_TIMEOUT_MS / 1000}s) — check the network or retry`,
    };
  }
  if (proc.exitCode !== 0) {
    return { name: "claude auth", ok: false, detail: "claude auth status failed — run `claude auth login`" };
  }
  const out = (await new Response(proc.stdout).text()).trim();
  try {
    const parsed = JSON.parse(out) as ClaudeAuthStatus;
    if (!parsed.loggedIn) {
      return { name: "claude auth", ok: false, detail: "not logged in — `claude auth login`" };
    }
    const note = parsed.subscriptionType === "max" ? "Max active" : `plan: ${parsed.subscriptionType ?? "?"}`;
    return { name: "claude auth", ok: true, detail: `${parsed.email ?? "?"} · ${note}` };
  } catch {
    return { name: "claude auth", ok: false, detail: "could not parse the claude auth status response" };
  }
}

/**
 * Variant of checkClaudeAuth that returns the parsed status (not a CheckResult).
 * Returns null on timeout / not logged in / not parseable.
 */
export async function getClaudeAuthStatus(): Promise<ClaudeAuthStatus | null> {
  const proc = Bun.spawn(["claude", "auth", "status"], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: CLAUDE_AUTH_TIMEOUT_MS,
  });
  await proc.exited;
  if (proc.exitCode === null || proc.exitCode !== 0) return null;
  const out = (await new Response(proc.stdout).text()).trim();
  try {
    return JSON.parse(out) as ClaudeAuthStatus;
  } catch {
    return null;
  }
}

function checkAnthropicEnv(): CheckResult {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      name: "env ANTHROPIC_API_KEY",
      ok: true,
      detail: "is set (Janus strips it at runtime to force Max)",
    };
  }
  return { name: "env ANTHROPIC_API_KEY", ok: true, detail: "not set (perfect, will use Max)" };
}

function checkGeminiAuth(): CheckResult {
  // Gemini CLI doesn't expose a stable `auth status`. The best we can do is
  // check for some credential hint — env var or config dir.
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
    return { name: "gemini auth", ok: true, detail: "GOOGLE_API_KEY/GEMINI_API_KEY present" };
  }
  const home = process.env.HOME;
  if (home && existsSync(`${home}/.gemini/credentials.json`)) {
    return { name: "gemini auth", ok: true, detail: "OAuth credentials in ~/.gemini/" };
  }
  return {
    name: "gemini auth",
    ok: false,
    detail: "no GOOGLE_API_KEY/GEMINI_API_KEY or ~/.gemini/credentials.json — run `gemini auth login`",
  };
}

function checkPath(name: string, path: string): CheckResult {
  return existsSync(path)
    ? { name, ok: true, detail: path }
    : { name, ok: false, detail: `does not exist: ${path}` };
}

async function checkProject(name: string, repoPath: string, obsidianPath: string, status: string): Promise<CheckResult> {
  const statusTag = status === "active" ? "" : ` · ${status.toUpperCase()}`;
  if (!existsSync(repoPath)) {
    return { name: `project ${name}`, ok: false, detail: `repo path does not exist: ${repoPath}${statusTag}` };
  }
  const isGit = await isRepo(repoPath);
  if (!isGit) {
    return { name: `project ${name}`, ok: false, detail: `${repoPath} is not a git repo${statusTag}` };
  }
  if (!existsSync(obsidianPath)) {
    return {
      name: `project ${name}`,
      ok: true,
      detail: `repo ok · obsidian path will be created: ${obsidianPath}${statusTag}`,
    };
  }
  return { name: `project ${name}`, ok: true, detail: `repo + obsidian ok${statusTag}` };
}

/**
 * Pure validation of a Discord webhook URL's format.
 * Makes no network call — just regex against the canonical prefix.
 */
export function validateDiscordWebhook(url: string): CheckResult {
  const ok = /^https:\/\/discord\.com\/api\/webhooks\//.test(url);
  return ok
    ? { name: "discord webhook", ok: true, detail: "valid URL (no request made)" }
    : { name: "discord webhook", ok: false, detail: "URL doesn't look like Discord" };
}

function checkDiscord(url?: string): CheckResult {
  if (!url) return { name: "discord webhook", ok: true, detail: "not configured (optional)" };
  return validateDiscordWebhook(url);
}

function printChecks(checks: CheckResult[]): void {
  const okMark = "✓";
  const failMark = "✗";
  for (const c of checks) {
    const mark = c.ok ? okMark : failMark;
    console.log(`  ${mark} ${c.name}: ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log("");
  if (failed === 0) {
    console.log(`[doctor] ${checks.length}/${checks.length} OK`);
  } else {
    console.log(`[doctor] ${checks.length - failed}/${checks.length} OK · ${failed} failed`);
  }
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
