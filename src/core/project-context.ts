import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ProjectConfig } from "../config/types.ts";

export type ProjectContext =
  | { tracked: false; state: "untracked" }
  | {
      tracked: true;
      state: "ready" | "missing-spine";
      project: string;
      spine: string | null;
    };

async function canonicalPath(path: string): Promise<string> {
  const absolute = isAbsolute(path) ? path : resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    return resolve(absolute);
  }
}

function containsPath(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel));
}

export async function matchTrackedProject(
  cwd: string,
  projects: ProjectConfig[],
): Promise<ProjectConfig | null> {
  return (await createTrackedProjectMatcher(projects))(cwd);
}

export async function createTrackedProjectMatcher(
  projects: ProjectConfig[],
): Promise<(cwd: string) => Promise<ProjectConfig | null>> {
  const roots = await Promise.all(
    projects.map(async (project) => ({ project, root: await canonicalPath(project.repoPath) })),
  );
  return (cwd) => matchCanonicalProject(cwd, roots);
}

async function matchCanonicalProject(
  cwd: string,
  roots: Array<{ project: ProjectConfig; root: string }>,
): Promise<ProjectConfig | null> {
  if (!cwd.trim()) return null;
  const candidate = await canonicalPath(cwd);
  let best: { project: ProjectConfig; root: string } | null = null;
  for (const match of roots) {
    if (containsPath(match.root, candidate) && (!best || match.root.length > best.root.length)) {
      best = match;
    }
  }
  return best?.project ?? null;
}

export async function getProjectContext(
  cwd: string,
  projects: ProjectConfig[],
): Promise<ProjectContext> {
  const project = await matchTrackedProject(cwd, projects);
  if (!project) return { tracked: false, state: "untracked" };

  const spinePath = join(project.obsidianPath, `${project.name}-spine.md`);
  let spine: string;
  try {
    spine = await readFile(spinePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      tracked: true,
      state: "missing-spine",
      project: project.name,
      spine: null,
    };
  }

  return {
    tracked: true,
    state: "ready",
    project: project.name,
    spine,
  };
}
