import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

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
 * STRATEGY.md lives in the Obsidian vault or in the repo (vault takes priority).
 * `ce-strategy` pattern: project north star (problem, approach, metrics, users, tracks).
 */
export async function readStrategy(obsidianPath: string, repoPath: string): Promise<string | null> {
  const candidates = [join(obsidianPath, "STRATEGY.md"), join(repoPath, "STRATEGY.md")];
  for (const p of candidates) {
    const content = await readIfExists(p);
    if (content) return content;
  }
  return null;
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
 * Path inside the project's repo:
 *   <repoPath>/docs/pulse/<date>-<project>.md
 */
export function repoPulsePath(repoPath: string, project: string, date: string): string {
  return join(repoPath, "docs", "pulse", pulseFilename(project, date));
}

export async function writePulse(opts: {
  obsidianPath: string;
  repoPath: string;
  project: string;
  date: string;
  content: string;
  dryRun?: boolean;
}): Promise<{ obsidianTarget: string; repoTarget: string }> {
  const obsidianTarget = obsidianPulsePath(opts.obsidianPath, opts.project, opts.date);
  const repoTarget = repoPulsePath(opts.repoPath, opts.project, opts.date);

  if (opts.dryRun) {
    return { obsidianTarget, repoTarget };
  }

  await Promise.all([
    writeFile(obsidianTarget, opts.content),
    writeFile(repoTarget, opts.content),
  ]);

  return { obsidianTarget, repoTarget };
}

async function writeFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}
