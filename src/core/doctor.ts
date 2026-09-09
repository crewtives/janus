import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Checkpoint, hasStateDb } from "./checkpoint.ts";
import { describeFreeze, readFreezeFlags, readInlineArray, readScalar, splitFrontmatter } from "./frontmatter.ts";
import { isRepo } from "./git.ts";
import { activeBoardProjects, boardPath, buildBoardModel, TEMP_SUFFIX } from "./kanvas.ts";
import { DEFAULT_LABEL } from "./init/launchd.ts";
import { loadConfig } from "../config/loader.ts";
import type { JanusConfig, ProjectConfig } from "../config/types.ts";

export type CheckResult = { name: string; ok: boolean; detail: string };
type ProviderId = NonNullable<JanusConfig["provider"]>;

/** Timeout for `claude auth status` — the call makes a network request and may hang. */
const CLAUDE_AUTH_TIMEOUT_MS = 10_000;

/** How far back the pulse-gap check looks. */
const PULSE_GAP_WINDOW_DAYS = 7;

/**
 * Hour at which the scheduler writes the previous day's pulse — the launchd and
 * systemd default (`DEFAULT_HOUR` in src/core/init/{launchd,systemd}.ts). Before
 * it, yesterday's pulse is not missing, it is not due yet; without this the gap
 * check would cry wolf on every morning run and be learned to be ignored.
 */
const PULSE_DUE_HOUR = 10;

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
    checks.push(await checkDeadLetter(config.stateDir!));
    checks.push(...(await checkPulseGaps(config.projects, new Date())));
    checks.push(await checkKanvasBoard(config, formatDate(new Date())));
  }

  if (process.platform === "darwin") checks.push(await checkLaunchdLoaded());

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

/**
 * failed.jsonl outlives the failures it records: a `janus pulse --force` repair
 * never touches the file, and `janus retry` only rewrites it if it runs to the
 * end. So a non-empty failed.jsonl is not by itself a problem. state.db is the
 * arbiter — an entry is actionable only while it still holds that
 * (project, date) as `failed`.
 */
export async function checkDeadLetter(stateDir: string): Promise<CheckResult> {
  const name = "dead-letter";
  const file = Bun.file(join(stateDir, "failed.jsonl"));
  if (!(await file.exists())) return { name, ok: true, detail: "no failed.jsonl — nothing to retry" };

  const keys = parseDeadLetterKeys(await file.text());
  if (keys.length === 0) return { name, ok: true, detail: "failed.jsonl is empty" };

  const cp = Checkpoint.open(stateDir);
  let unresolved: string[];
  try {
    const stillFailed = new Set(cp.queryFailed().map((r) => `${r.project}/${r.date}`));
    unresolved = keys.filter((k) => stillFailed.has(k));
  } finally {
    cp.close();
  }

  if (unresolved.length === 0) {
    return { name, ok: true, detail: `${keys.length} past entr(ies), all resolved since` };
  }
  return {
    name,
    ok: false,
    detail: `${unresolved.length} unresolved: ${unresolved.join(", ")} — run \`janus retry\``,
  };
}

/** Unique `<project>/<date>` keys. The same task fails once per attempt, so lines repeat. */
function parseDeadLetterKeys(text: string): string[] {
  const keys = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { project?: unknown; date?: unknown };
      if (typeof entry.project === "string" && typeof entry.date === "string") {
        keys.add(`${entry.project}/${entry.date}`);
      }
    } catch {
      // A half-written line (killed mid-append) is not worth failing the check over.
    }
  }
  return [...keys];
}

/**
 * Dates whose pulse should already be on disk, oldest first, ending at the most
 * recent date the scheduler has had a chance to write (see PULSE_DUE_HOUR).
 */
export function duePulseDates(now: Date, windowDays: number): string[] {
  const newest = new Date(now);
  newest.setDate(newest.getDate() - (now.getHours() >= PULSE_DUE_HOUR ? 1 : 2));
  const out: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(newest);
    d.setDate(d.getDate() - i);
    out.push(formatDate(d));
  }
  return out;
}

async function checkPulseGaps(projects: ProjectConfig[], now: Date): Promise<CheckResult[]> {
  const due = duePulseDates(now, PULSE_GAP_WINDOW_DAYS);
  const out: CheckResult[] = [];
  for (const p of projects) {
    if ((p.status ?? "active") !== "active") continue;
    out.push(await checkProjectPulseGap(p, due));
  }
  return out;
}

/**
 * The check the 2026-07-13 loss needed: state.db held a `failed` row and the
 * vault simply had no pulse, while every other check stayed green.
 *
 * A project with no pulse at all is not a gap — it never started (same reasoning
 * as the orchestrator's catch-up backstop), and reporting it would leave a newly
 * added project permanently red. For the same reason the window starts at the
 * project's first pulse: the days before it joined Janus are not missing.
 */
export async function checkProjectPulseGap(project: ProjectConfig, due: string[]): Promise<CheckResult> {
  const name = `pulses ${project.name}`;
  const onDisk = await pulseDatesOnDisk(project.obsidianPath);
  if (onDisk.size === 0) return { name, ok: true, detail: "no pulses yet — nothing to compare" };

  const first = [...onDisk].sort()[0]!;
  const from = first > due[0]! ? first : due[0]!;
  const missing = due.filter((d) => d >= from && !onDisk.has(d));
  if (missing.length === 0) return { name, ok: true, detail: `no gaps since ${from}` };
  return {
    name,
    ok: false,
    detail: `no pulse for ${missing.join(", ")} — run \`janus pulse --date ${missing[0]} --force\``,
  };
}

/**
 * Pulse dates present in a project's vault folder, current month and archived
 * alike. Globs instead of rebuilding filenames: single- and double-dash variants
 * coexist across older pulses.
 */
export async function pulseDatesOnDisk(obsidianPath: string): Promise<Set<string>> {
  const dates = new Set<string>();
  if (!existsSync(obsidianPath)) return dates;
  for (const pattern of ["pulse/*.md", "_archive/**/*.md"]) {
    const glob = new Bun.Glob(pattern);
    for await (const file of glob.scan({ cwd: obsidianPath })) {
      const m = file.match(/(\d{4}-\d{2}-\d{2})-.*\.md$/);
      if (m?.[1]) dates.add(m[1]);
    }
  }
  return dates;
}

/**
 * The Kanvas board (R18). The board is regenerated by the nightly block, so its
 * absence is evidence of a problem only once that block has had a chance to run.
 * `runDoctor` returns `checks.every(ok)` and `janus init` runs doctor: a check
 * that went red before the feature ever ran would turn onboarding red for every
 * existing user. Hence four green cases — nothing to render, no pulse ever
 * recorded, a deliberately frozen board, and a legitimately partial run.
 *
 * The project set is the board model's, not the pulse-gap check's above:
 * `collectProjectCards` filters on `archived` alone, so a `paused` project still
 * contributes cards here while `checkPulseGaps` skips it. The two checks can
 * therefore disagree about a paused project inside one doctor output, and that
 * is correct rather than a bug to be reconciled.
 */
export async function checkKanvasBoard(config: JanusConfig, today: string): Promise<CheckResult> {
  const name = "kanvas board";
  const path = boardPath(config.obsidianVault);
  // The writer renames into place, so a leftover means a write was killed
  // mid-flight. The suffix is imported, not copied: a hand-mirrored constant
  // stops matching the moment the writer changes it, and the check goes quietly
  // green while the leftover sits there.
  const tmp = `${path}${TEMP_SUFFIX}`;
  const siblings = await boardSiblings(path);
  const note = siblings.length > 0 ? ` · also in Dashboards/: ${siblings.join(", ")}` : "";

  if (existsSync(tmp)) {
    return { name, ok: false, detail: `stale ${basename(tmp)} from an interrupted write${note} — delete it and run \`janus kanvas\`` };
  }

  const existing = existsSync(path) ? await Bun.file(path).text() : null;
  if (existing !== null) {
    const freeze = describeFreeze(existing);
    if (freeze) return { name, ok: true, detail: `${freeze.message}${note}` };
    // A file Janus does not own is a stuck state it will never resolve on its
    // own: every future run refuses, and without this the check would report
    // "present" forever while the board silently stopped updating.
    if (readFreezeFlags(existing).managed !== true) {
      return {
        name,
        ok: false,
        detail: `a file Janus does not own sits at ${basename(path)}${note} — rename or delete it, then run \`janus kanvas\``,
      };
    }
    // Partial is a normal state, not a failure: one unreadable mirror costs that
    // project's cards and the board says so in its own banner.
    const failed = readFailedProjects(existing);
    const partial = failed.length > 0 ? ` · last run was partial, could not read: ${failed.join(", ")}` : "";
    const written = readScalar(splitFrontmatter(existing).frontmatter, "generated_at");
    const when = written !== null ? ` · last written ${written}` : "";
    return { name, ok: true, detail: `present${when}${partial}${note}` };
  }

  if (!anyPulseRecorded(config)) {
    return { name, ok: true, detail: `no pulse recorded yet — the board block has not run${note}` };
  }

  let model: Awaited<ReturnType<typeof buildBoardModel>>;
  try {
    model = await buildBoardModel({ config, today });
  } catch (err) {
    // runDoctor returns checks.every(ok) and the command exits on it, so an
    // unguarded throw here would take every other check's output down with it.
    return { name, ok: false, detail: `could not build the board: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (model.cards.length === 0 && model.blocked.length === 0) {
    return { name, ok: true, detail: `nothing to render — no card source and no blocker in window${note}` };
  }
  return {
    name,
    ok: false,
    detail: `missing ${path} with ${model.cards.length} card(s) to render${note} — run \`janus kanvas\``,
  };
}

/**
 * Cheapest honest signal that the pipeline has ever run: one `lastDoneDate` per
 * board project, short-circuited on the first hit. It reads the same
 * `pulse_state` rows the orchestrator writes, needs no vault scan, and is not
 * fooled by a hand-copied pulse file. The state.db existence check comes first
 * because `Checkpoint.open` CREATES the database — a doctor run has no business
 * leaving one behind.
 */
function anyPulseRecorded(config: JanusConfig): boolean {
  const stateDir = config.stateDir;
  if (!hasStateDb(stateDir)) return false;
  const cp = Checkpoint.open(stateDir!);
  try {
    return activeBoardProjects(config).some((p) => cp.lastDoneDate(p.name) !== null);
  } finally {
    cp.close();
  }
}

/** `failed_projects: [...]` out of the board's own frontmatter block. */
function readFailedProjects(md: string): string[] {
  return readInlineArray(splitFrontmatter(md).frontmatter, "failed_projects");
}

/**
 * Files beside the board sharing its basename stem — `Kanvas (conflicted copy
 * 2026-09-01).md`, `Kanvas.sync-conflict-….md`. That is how a file-sync client
 * resolves a concurrent edit: the copy shadows the real board in search while
 * Janus keeps rewriting the original, and nothing else would ever mention it.
 */
async function boardSiblings(path: string): Promise<string[]> {
  const dir = dirname(path);
  if (!existsSync(dir)) return [];
  const self = basename(path);
  const out: string[] = [];
  const glob = new Bun.Glob(`${basename(path, ".md")}*`);
  for await (const file of glob.scan({ cwd: dir, onlyFiles: true })) {
    // The temp file has its own check, with its own remediation.
    if (file === self || file === `${self}${TEMP_SUFFIX}`) continue;
    out.push(file);
  }
  return out.sort();
}

/**
 * macOS-only (mirrors the guard in src/core/init/launchd.ts). An unloaded job
 * produces no pulses at all, silently — nothing else in `doctor` notices.
 */
export async function checkLaunchdLoaded(label: string = DEFAULT_LABEL): Promise<CheckResult> {
  if (process.platform !== "darwin") {
    throw new Error(`launchctl is macOS-only (currently: ${process.platform})`);
  }
  const name = "scheduler";
  try {
    const proc = Bun.spawn(["launchctl", "list", label], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    if (proc.exitCode !== 0) {
      return { name, ok: false, detail: `launchd job ${label} not loaded — run \`janus init\`` };
    }
    return { name, ok: true, detail: `launchd job ${label} loaded` };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
