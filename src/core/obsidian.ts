import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pickBestStrategy } from "./strategy-status.ts";

export async function readIfExists(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  return Bun.file(path).text();
}

export function roadmapPath(obsidianPath: string): string {
  return join(obsidianPath, "_roadmap.md");
}

export function claudeMdPath(repoPath: string): string {
  return join(repoPath, "CLAUDE.md");
}

/**
 * STRATEGY.md lives in the Obsidian vault or in the repo. A filled file wins over
 * a template draft (see `pickBestStrategy`); ties resolve to the vault.
 * `ce-strategy` pattern: project north star (problem, approach, metrics, users, tracks).
 */
export async function readStrategy(obsidianPath: string, repoPath: string): Promise<string | null> {
  const best = await pickBestStrategy(obsidianPath, repoPath);
  return best?.content ?? null;
}

/**
 * Repo README — used as a fallback when there's no STRATEGY.md or _roadmap.md
 * to infer the project's objective.
 */
export async function readRepoReadme(repoPath: string): Promise<string | null> {
  const candidates = [join(repoPath, "README.md"), join(repoPath, "Readme.md"), join(repoPath, "readme.md")];
  for (const p of candidates) {
    const content = await readIfExists(p);
    if (content) return content;
  }
  return null;
}

export function pulseFilename(project: string, date: string): string {
  return `${date}-${project}.md`;
}

/**
 * Final path inside the Obsidian vault:
 *   <obsidianPath>/pulse/<date>-<project>.md
 *
 * Stored inside the project's folder in the vault, not a global Pulse/.
 * Dataview aggregates via tag/query, not by path.
 */
export function obsidianPulsePath(obsidianPath: string, project: string, date: string): string {
  return join(obsidianPath, "pulse", pulseFilename(project, date));
}

/**
 * Pulses live ONLY in the Janus vault, never duplicated into the project repo.
 * The old dual-write into `<repoPath>/docs/pulse/` was dropped: the vault is the
 * single source of truth, and the repo copies weren't in the graph and only
 * cluttered each project's history.
 */
export async function writePulse(opts: {
  obsidianPath: string;
  project: string;
  date: string;
  content: string;
  dryRun?: boolean;
}): Promise<{ obsidianTarget: string }> {
  const obsidianTarget = obsidianPulsePath(opts.obsidianPath, opts.project, opts.date);
  if (opts.dryRun) return { obsidianTarget };
  await writeFile(obsidianTarget, opts.content);
  return { obsidianTarget };
}

async function writeFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}
