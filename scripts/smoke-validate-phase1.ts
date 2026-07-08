#!/usr/bin/env bun
/**
 * Phase 1 smoke validation — runs the entire chain without invoking an LLM
 * or touching the production vault. Verifies that:
 *
 *  1. The voice spec loads OK.
 *  2. Each of the 7 versioned prompts renders without error with a mock context.
 *  3. Project metadata + track lineage + decision graph: insert/read OK
 *     against an in-memory SQLite DB.
 *  4. The MCP server boots and responds to tools/list against a temporary vault.
 *  5. The compiled binary (`bun build --compile`) renders `pulse --dry-run` end-to-end
 *     against a synthetic temp vault. Set `JANUS_SKIP_BINARY_SMOKE=1` to skip locally.
 *
 * Usage: bun run scripts/smoke-validate-phase1.ts
 *
 * Output: a table with ✓ per check, exit code 0 if all green.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Eta } from "eta";
import { loadVoiceSpec, PROMPT_VERSION, buildPromptContext, renderDailyPulsePrompt } from "../src/core/template.ts";
import { Checkpoint } from "../src/core/checkpoint.ts";
import { getProjectBirthDates, detectAnniversary } from "../src/core/project-metadata.ts";
import { recordTrackLineage } from "../src/core/tracks.ts";
import { indexPulseDecisions } from "../src/core/decision-graph.ts";
import { handleRequest } from "../src/mcp/server.ts";
import type { JanusConfig } from "../src/config/types.ts";

interface CheckResult { name: string; ok: boolean; detail: string }

const results: CheckResult[] = [];
const eta = new Eta({ autoEscape: false, rmWhitespace: false });
const PROMPT_DIR = join(import.meta.dir, "..", "src", "prompts");

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
}

// 1. Voice spec loads
await check("voice spec loads without error", async () => {
  const v = await loadVoiceSpec();
  if (v.length < 500) throw new Error(`spec too short: ${v.length} chars`);
  if (!v.includes("personal historian")) throw new Error("missing 'personal historian'");
  return `${v.length} chars, prompt_version=${PROMPT_VERSION}`;
});

// 2. Render all 7 prompts with a mock context
const voice = await loadVoiceSpec();

await check("daily-pulse (current PROMPT_VERSION) renders with a mock context", async () => {
  const ctx = buildPromptContext({
    project: "demo",
    date: "2026-05-21",
    voice,
    strategyMd: null,
    roadmap: null,
    readmeMd: null,
    claudeMd: null,
    activity: { commits: [], filesChanged: [], diffStat: "", currentBranch: "main", isClean: true, commitTypes: {}, insertions: 0, deletions: 0, topFolders: [] },
    sessions: [],
  });
  const out = await renderDailyPulsePrompt(ctx);
  if (!out.includes("Voice of Janus")) throw new Error("voice spec not injected");
  if (!out.includes(PROMPT_VERSION)) throw new Error("PROMPT_VERSION missing");
  return `${out.length} chars, prompt_version=${PROMPT_VERSION}`;
});

const otherPrompts: Array<{ file: string; ctx: Record<string, unknown> }> = [
  { file: "daily-rollup.v6.md", ctx: { voice, date: "2026-05-21", pulses: [{ project: "demo", content: "x" }], promptVersion: "v6" } },
  { file: "weekly-rollup.v6.md", ctx: { voice, days: 7, startDate: "2026-05-15", endDate: "2026-05-21", projects: ["demo"], dailies: [{ date: "2026-05-21", content: "x" }], promptVersion: "v6" } },
  { file: "monthly-digest.v5.md", ctx: { voice, month: "2026-05", startDate: "2026-05-01", endDate: "2026-05-31", days: 31, projects: ["demo"], weeklies: [], uncoveredDailies: [], promptVersion: "v5" } },
  { file: "quarterly-retro.v3.md", ctx: { voice, quarter: "2026-Q2", startDate: "2026-04-01", endDate: "2026-06-30", days: 91, projects: ["demo"], monthlies: [], uncoveredWeeklies: [], promptVersion: "v3" } },
  { file: "yearly-retro.v3.md", ctx: { voice, year: "2026", startDate: "2026-01-01", endDate: "2026-12-31", projects: ["demo"], quarterlies: [{ quarter: "2026-Q1", content: "x" }], promptVersion: "v3" } },
  { file: "project-spine.v4.md", ctx: { voice, project: "demo", generatedAt: "2026-05-21", previousSpine: null, strategyMd: "", strategyStatus: "missing", roadmap: "", recentWeeklies: [], recentPulses: [], activeTracks: [], projectAdrs: [], promptVersion: "v4" } },
];

for (const p of otherPrompts) {
  await check(`${p.file} renders with a mock context`, async () => {
    const tpl = await Bun.file(join(PROMPT_DIR, p.file)).text();
    const out = eta.renderString(tpl, p.ctx);
    if (typeof out !== "string") throw new Error("renderer returned non-string");
    if (!out.includes("Voice of Janus")) throw new Error("voice spec not injected");
    return `${out.length} chars`;
  });
}

// 3. Bookkeeping (Phase 1C)
await check("project_metadata insert/read OK", async () => {
  const cp = Checkpoint.openInMemory();
  cp.upsertProjectMetadata({ project: "demo", birthDateGit: "2024-01-15", birthDatePulse: "2024-02-01" });
  const m = cp.getProjectMetadata("demo");
  cp.close();
  if (!m) throw new Error("could not read inserted row");
  return `birth_git=${m.birthDateGit}, birth_pulse=${m.birthDatePulse}`;
});

await check("track_lineage upsert is idempotent per (slug, project)", async () => {
  const cp = Checkpoint.openInMemory();
  recordTrackLineage({
    checkpoint: cp,
    tracks: [{ slug: "x", name: "X", emoji: "", projects: ["demo"], status: "open", body: "" }],
    sourceFilename: "2026-05-19-week",
  });
  recordTrackLineage({
    checkpoint: cp,
    tracks: [{ slug: "x", name: "X", emoji: "", projects: ["demo"], status: "open", body: "" }],
    sourceFilename: "2026-05-19-week",
  });
  const rows = cp.listTrackLineage();
  cp.close();
  if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`);
  if (rows[0]!.mentionsCount !== 1) throw new Error("counter incremented on duplicate");
  return `1 row, count=1`;
});

await check("decision_graph indexes ADR mentions", async () => {
  const cp = Checkpoint.openInMemory();
  indexPulseDecisions({
    checkpoint: cp,
    pulseContent: "Today referenced ADR-007 and ADR-012.",
    pulseDate: "2026-05-21",
    project: "demo",
  });
  const refs = cp.listDecisionReferences();
  cp.close();
  if (refs.length !== 2) throw new Error(`expected 2 refs, got ${refs.length}`);
  return `${refs.length} refs indexed`;
});

await check("detectAnniversary: 2025-05-21 + 2026-05-21 → 1", () => {
  const r = detectAnniversary("2025-05-21", "2026-05-21");
  if (r !== 1) throw new Error(`expected 1, got ${r}`);
  return Promise.resolve("1 year");
});

// 4. MCP server smoke
await check("MCP server tools/list returns 4 tools", async () => {
  const tmpRoot = join(tmpdir(), `smoke-mcp-${Date.now()}`);
  const vaultPath = join(tmpRoot, "vault");
  const projAbs = join(vaultPath, "Projects", "demo");
  await mkdir(join(projAbs, "pulse"), { recursive: true });
  const stateDir = join(tmpRoot, ".janus");
  await mkdir(stateDir, { recursive: true });
  const config: JanusConfig = {
    obsidianVault: vaultPath,
    projects: [{ name: "demo", repoPath: tmpRoot, obsidianPath: projAbs }],
    stateDir,
  };
  try {
    const resp = await handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { config });
    const result = resp?.result as { tools: Array<{ name: string }> };
    if (result.tools.length !== 4) throw new Error(`expected 4 tools, got ${result.tools.length}`);
    return `${result.tools.length} tools: ${result.tools.map((t) => t.name).join(", ")}`;
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

await check("getProjectBirthDates doesn't fail without git or pulses", async () => {
  const tmpRoot = join(tmpdir(), `smoke-meta-${Date.now()}`);
  const obs = join(tmpRoot, "vault", "Projects", "demo");
  await mkdir(obs, { recursive: true });
  const cp = Checkpoint.openInMemory();
  try {
    const r = await getProjectBirthDates({
      project: { name: "demo", repoPath: join(tmpRoot, "no-repo"), obsidianPath: obs },
      checkpoint: cp,
    });
    if (r.earliest !== null) throw new Error(`expected null, got ${r.earliest}`);
    return "both null as expected";
  } finally {
    cp.close();
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// 5. Compiled binary smoke — guards against prompt-loading regressions in `bun build --compile`.
//    Previously a `Bun.file()` runtime read on _voice.md crashed the binary (`ENOENT: /$bunfs/...`).
//    All prompts must stay embedded via import attributes. This check builds the binary into a
//    throwaway path and runs `pulse --dry-run` against a synthetic vault.
if (process.env.JANUS_SKIP_BINARY_SMOKE !== "1") {
  await check("compiled binary runs `pulse --dry-run` against a synthetic vault", async () => {
    const tmpRoot = join(tmpdir(), `smoke-binary-${Date.now()}`);
    const vaultPath = join(tmpRoot, "vault");
    const projObs = join(vaultPath, "Projects", "demo");
    const projRepo = join(tmpRoot, "repo");
    await mkdir(join(projObs, "pulse"), { recursive: true });
    await mkdir(projRepo, { recursive: true });
    const binaryPath = join(tmpRoot, "janus-smoke");
    const repoRoot = join(import.meta.dir, "..");

    // Initialize a minimal git repo so `git log` returns cleanly.
    const initGit = Bun.spawn(["git", "init", "-q", "-b", "main"], { cwd: projRepo, stdout: "pipe", stderr: "pipe" });
    await initGit.exited;
    if (initGit.exitCode !== 0) throw new Error("git init failed");

    // Compile the binary.
    const build = Bun.spawn(
      ["bun", "build", "bin/janus.ts", "--compile", "--outfile", binaryPath],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    await build.exited;
    if (build.exitCode !== 0) {
      const err = await new Response(build.stderr).text();
      throw new Error(`build failed: ${err.slice(-300)}`);
    }

    // Write a synthetic config in the binary's cwd so loadConfig picks it up.
    const config = {
      obsidianVault: vaultPath,
      projects: [{ name: "demo", repoPath: projRepo, obsidianPath: projObs, status: "active" }],
      stateDir: join(tmpRoot, ".janus"),
      language: "en",
    };
    await writeFile(join(tmpRoot, "config.local.json"), JSON.stringify(config, null, 2));

    // Run pulse --dry-run from the tmpRoot so the binary loads the synthetic config.
    const run = Bun.spawn([binaryPath, "pulse", "--dry-run"], {
      cwd: tmpRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    await run.exited;
    const stdout = await new Response(run.stdout).text();
    const stderr = await new Response(run.stderr).text();

    try {
      if (run.exitCode !== 0) {
        throw new Error(`binary exited ${run.exitCode}: ${stderr.slice(-300)}`);
      }
      if (!/dry-run|prompt rendered/i.test(stdout)) {
        throw new Error(`unexpected output: ${stdout.slice(-200)}`);
      }
      return `binary OK (${stdout.split("\n").length} log lines)`;
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
}

// Print summary
console.log("");
console.log("┌──────────────────────────────────────────────────────────────────────────────┐");
console.log("│  Phase 1 smoke validation                                                    │");
console.log("├──────────────────────────────────────────────────────────────────────────────┤");
for (const r of results) {
  const mark = r.ok ? "✓" : "✗";
  const line = `│  ${mark} ${r.name.padEnd(54)} ${r.detail.slice(0, 18).padEnd(18)}│`;
  console.log(line);
}
console.log("└──────────────────────────────────────────────────────────────────────────────┘");

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`\n${failed.length} check(s) failed:`);
  for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log(`\n${results.length} checks OK · Phase 1 ready for e2e.`);
