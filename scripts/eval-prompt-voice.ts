#!/usr/bin/env bun
/**
 * Eval loop para Phase 1A — overhaul de voz narrativa.
 *
 * Regenera los últimos N pulses de un proyecto con el **prompt actual**
 * (v5+) y escribe el output a `<vault>/_eval/<date>-<project>.new.md`
 * SIN tocar los pulses originales. Esto permite hacer side-by-side
 * comparison en Obsidian (abrir vista dividida con el original y el .new).
 *
 * Uso:
 *   bun run scripts/eval-prompt-voice.ts                    # todos los proyectos active, últimos 3 pulses
 *   bun run scripts/eval-prompt-voice.ts --project NAME     # un proyecto solo
 *   bun run scripts/eval-prompt-voice.ts --last 7           # cambiar N
 *   bun run scripts/eval-prompt-voice.ts --dry-run          # no llama al LLM, solo renderea el prompt
 *
 * El script NO toca `pulse/` ni `state.db` — usa una checkpoint en-memoria
 * y escribe a `_eval/` (un directorio que el usuario puede borrar a mano
 * después de inspeccionar).
 *
 * Recomendado: abrir `<vault>/_eval/<date>-<project>.new.md` lado a lado
 * con `<vault>/Projects/<project>/pulse/<date>-<project>.md` en Obsidian.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config/loader.ts";
import type { ProjectConfig } from "../src/config/types.ts";
import { Checkpoint } from "../src/core/checkpoint.ts";
import { getActivity } from "../src/core/git.ts";
import { findSessionTranscriptsForDate, summarizeTranscript } from "../src/ingest/index.ts";
import { loadPreviousPulses } from "../src/core/previous-pulses.ts";
import { detectStrategyStatus } from "../src/core/strategy-status.ts";
import { loadActiveTracks } from "../src/core/active-tracks.ts";
import { readIfExists, roadmapPath, claudeMdPath, readStrategy, readRepoReadme } from "../src/core/obsidian.ts";
import { buildPromptContext, loadVoiceSpec, PROMPT_VERSION, renderDailyPulsePrompt } from "../src/core/template.ts";
import { resolveRunner } from "../src/runners/registry.ts";

interface CliArgs {
  project: string | null;
  last: number;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let project: string | null = null;
  let last = 3;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--project") {
      project = args[++i] ?? null;
    } else if (a === "--last") {
      last = parseInt(args[++i] ?? "3", 10);
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--help" || a === "-h") {
      console.log(`Eval loop — regenera últimos N pulses con prompt v${PROMPT_VERSION} a _eval/

Usage:
  bun run scripts/eval-prompt-voice.ts [--project NAME] [--last N] [--dry-run]

Flags:
  --project NAME   Solo este proyecto (default: todos los active)
  --last N         Cuántos pulses regenerar por proyecto (default: 3)
  --dry-run        No llama al LLM — solo renderea el prompt y muestra preview
`);
      process.exit(0);
    }
  }
  return { project, last, dryRun };
}

async function listRecentPulseDates(project: ProjectConfig, limit: number): Promise<string[]> {
  const pulseDir = join(project.obsidianPath, "pulse");
  if (!existsSync(pulseDir)) return [];
  const entries = await readdir(pulseDir);
  const dates = new Set<string>();
  for (const name of entries) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-/);
    if (m && m[1]) dates.add(m[1]);
  }
  return [...dates].sort().reverse().slice(0, limit);
}

async function evalPulseForDate(args: {
  project: ProjectConfig;
  date: string;
  vaultRoot: string;
  cp: Checkpoint;
  voice: string;
  dryRun: boolean;
  config: Awaited<ReturnType<typeof loadConfig>>;
}): Promise<{ outputPath: string | null; promptChars: number; resultChars: number }> {
  const { project, date, vaultRoot, cp, voice, dryRun, config } = args;
  const sinceISO = new Date(`${date}T00:00:00`).toISOString();
  const untilISO = new Date(`${date}T23:59:59.999`).toISOString();

  const [activity, roadmap, claudeMd, strategyMd, readmeMd, sessionFiles, previousPulses, strategyStatus, activeTracks] = await Promise.all([
    getActivity(project.repoPath, sinceISO, untilISO),
    readIfExists(roadmapPath(project.obsidianPath)),
    readIfExists(claudeMdPath(project.repoPath)),
    readStrategy(project.obsidianPath, project.repoPath),
    readRepoReadme(project.repoPath),
    findSessionTranscriptsForDate({ project, projects: config.projects, date }),
    loadPreviousPulses({ obsidianPath: project.obsidianPath, currentDate: date, daysBack: 7 }),
    detectStrategyStatus({ obsidianPath: project.obsidianPath, repoPath: project.repoPath, currentDate: date }),
    loadActiveTracks({ vaultPath: vaultRoot, project: project.name }),
  ]);
  const sessions = await Promise.all(sessionFiles.map((session) => summarizeTranscript(session, date)));

  const vaultRelPath = project.obsidianPath.startsWith(vaultRoot)
    ? project.obsidianPath.slice(vaultRoot.length).replace(/^\/+/, "")
    : project.obsidianPath;

  const ctx = buildPromptContext({
    project: project.name,
    date,
    voice,
    strategyMd,
    roadmap,
    readmeMd,
    claudeMd,
    activity,
    sessions,
    suppressRoadmapDraft: false,
    vaultRelPath,
    previousRisks: previousPulses.risks,
    previousDecisions: previousPulses.decisions,
    hasPreviousPulse: previousPulses.immediatePrevious !== null,
    previousPulseFilename: previousPulses.immediatePrevious?.filename ?? "",
    idleStreakBefore: previousPulses.idleStreakBefore,
    strategyStatus: strategyStatus.status,
    strategyDaysAsDraft: strategyStatus.daysAsDraft,
    userEdits: [],
    activeTracks: activeTracks.map((t) => ({ slug: t.slug, name: t.name, emoji: t.emoji, status: t.status })),
  });

  const prompt = await renderDailyPulsePrompt(ctx);
  // cp se usa para satisfacer el contrato pero NO se persiste (Checkpoint.openInMemory)
  void cp;

  if (dryRun) {
    console.log(`  [dry-run] prompt rendereado: ${prompt.length} chars`);
    return { outputPath: null, promptChars: prompt.length, resultChars: 0 };
  }

  const runner = resolveRunner(config);
  const result = await runner.run({
    prompt,
    cwd: project.repoPath,
    model: config.model!,
    effort: config.effort!,
    fallbackModel: config.fallbackModel,
    addDirs: [project.obsidianPath],
    sessionId: randomUUID(),
    maxTurns: 30,
    timeoutMs: config.taskTimeoutMs!,
    logTag: `eval/${project.name}/${date}`,
  });
  const content = result.resultText.trim();
  const evalDir = join(vaultRoot, "_eval");
  await mkdir(evalDir, { recursive: true });
  const outputPath = join(evalDir, `${date}-${project.name}.new.md`);
  await writeFile(outputPath, content);
  return { outputPath, promptChars: prompt.length, resultChars: content.length };
}

async function writeReadme(vaultRoot: string, results: Array<{ project: string; date: string; outputPath: string | null }>): Promise<string> {
  const evalDir = join(vaultRoot, "_eval");
  await mkdir(evalDir, { recursive: true });
  const readmePath = join(evalDir, "README.md");
  const lines: string[] = [];
  lines.push(`# Eval — voice overhaul (prompt v${PROMPT_VERSION})`);
  lines.push("");
  lines.push(`Generado: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Este directorio contiene **regeneraciones** de los últimos pulses con el prompt actual.`);
  lines.push(`Para comparar lado a lado: abrir un \`.new.md\` y su contraparte original en Obsidian (vista dividida).`);
  lines.push("");
  lines.push(`## Pulses regenerados`);
  lines.push("");
  for (const r of results) {
    if (!r.outputPath) continue;
    // El path al original es relativo al vault
    const originalRel = `Projects/${r.project}/pulse/${r.date}-${r.project}.md`;
    const newRel = `_eval/${r.date}-${r.project}.new.md`;
    lines.push(`- **${r.date} — ${r.project}**`);
    lines.push(`  - Original: \`${originalRel}\``);
    lines.push(`  - Nuevo (v${PROMPT_VERSION}): \`${newRel}\``);
  }
  lines.push("");
  lines.push(`## Cómo borrar`);
  lines.push("");
  lines.push(`Cuando termines de inspeccionar: \`rm -rf <vault>/_eval/\``);
  await writeFile(readmePath, lines.join("\n"));
  return readmePath;
}

const argsParsed = parseArgs();
const config = await loadConfig();

const projects = argsParsed.project
  ? config.projects.filter((p) => p.name === argsParsed.project)
  : config.projects.filter((p) => p.status !== "archived");

if (projects.length === 0) {
  console.error(`[eval] sin proyectos${argsParsed.project ? ` (filtrando por ${argsParsed.project})` : ""}`);
  process.exit(1);
}

console.log(`[eval] prompt v${PROMPT_VERSION} · ${projects.length} proyectos · últimos ${argsParsed.last} pulses · dry-run=${argsParsed.dryRun}`);

const voice = await loadVoiceSpec();
const cp = Checkpoint.openInMemory();
const results: Array<{ project: string; date: string; outputPath: string | null }> = [];

for (const project of projects) {
  const dates = await listRecentPulseDates(project, argsParsed.last);
  if (dates.length === 0) {
    console.log(`[eval] ${project.name}: sin pulses en disco — skip`);
    continue;
  }
  console.log(`[eval] ${project.name}: ${dates.length} pulse(s) → ${dates.join(", ")}`);
  for (const date of dates) {
    try {
      const r = await evalPulseForDate({
        project,
        date,
        vaultRoot: config.obsidianVault,
        cp,
        voice,
        dryRun: argsParsed.dryRun,
        config,
      });
      const tag = argsParsed.dryRun ? "[dry-run]" : "✓";
      console.log(`  ${tag} ${date}: prompt=${r.promptChars} chars · result=${r.resultChars} chars${r.outputPath ? ` → ${r.outputPath}` : ""}`);
      results.push({ project: project.name, date, outputPath: r.outputPath });
    } catch (err) {
      console.error(`  ✗ ${date}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

cp.close();

if (!argsParsed.dryRun && results.some((r) => r.outputPath)) {
  const readmePath = await writeReadme(config.obsidianVault, results);
  console.log(`[eval] README escrito en ${readmePath}`);
}

const writtenCount = results.filter((r) => r.outputPath).length;
console.log(`[eval] listo — ${writtenCount} pulses regenerados a _eval/`);
