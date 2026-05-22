import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { JanusConfig, ProjectConfig } from "../config/types.ts";

export interface DiscoveredProject {
  name: string;
  repoPath: string;
  obsidianPath: string;
  status: "active";
  /** Why it was discovered: the root that matched. */
  matchedRoot: string;
}

export interface DiscoverResult {
  discovered: DiscoveredProject[];
  alreadyConfigured: string[]; // names already in config
  roots: string[]; // roots/globs that were used
  rootsInferred: boolean; // true if they came from the fallback (not explicit config)
}

const DEFAULT_MAX_DEPTH = 3;
const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".cache",
  ".turbo", ".nx", "coverage", "target", ".venv", "venv", "__pycache__",
  ".pytest_cache", ".idea", ".vscode", "_archive", ".DS_Store",
]);

/**
 * Discovers projects not yet configured.
 *
 * Strategy:
 * 1. Determine the roots to scan:
 *    - If `config.discoverRoots` exists, use that (may include `*`/`**` globs).
 *    - Otherwise, infer from the common dirname of current `repoPath`s (all unique dirs).
 * 2. For each root/glob:
 *    - Expand the glob if it has `*`.
 *    - Recursive (up to DEFAULT_MAX_DEPTH) if there's no glob.
 * 3. Each candidate path → check if it's a git repo (`.git/` inside).
 * 4. If already in `config.projects` (matching by canonical repoPath), skip.
 * 5. Generate `{name, obsidianPath, status}` from the path relative to the root.
 */
export async function discoverProjects(opts: {
  config: JanusConfig;
}): Promise<DiscoverResult> {
  const { config } = opts;

  // Set of already configured repoPaths (canonicalized via resolve to avoid trailing slashes).
  const existingRepoPaths = new Set(config.projects.map((p) => resolve(p.repoPath)));
  const existingNames = new Set(config.projects.map((p) => p.name));

  // Roots: explicit or inferred
  let roots: string[] = [];
  let rootsInferred = false;
  if (config.discoverRoots && config.discoverRoots.length > 0) {
    roots = config.discoverRoots;
  } else {
    rootsInferred = true;
    roots = inferRootsFromProjects(config.projects);
  }

  // Dedup by canonical repoPath — the same repo may surface from overlapping roots.
  // When overlapping, we prefer the MOST SPECIFIC match (longer rootAbsPath) — that
  // produces shorter and more descriptive names.
  const byRepo = new Map<string, DiscoveredProject>();
  for (const rootPattern of roots) {
    const candidates = await expandRoot(rootPattern);
    for (const candidate of candidates) {
      if (!isGitRepo(candidate.absPath)) continue;
      const canonical = resolve(candidate.absPath);
      if (existingRepoPaths.has(canonical)) continue;

      const { name, obsidianPath } = projectMetaFor({
        rootPattern,
        rootAbsPath: candidate.rootAbsPath,
        repoAbsPath: canonical,
        vaultPath: config.obsidianVault,
      });

      if (existingNames.has(name)) continue;

      const existing = byRepo.get(canonical);
      if (existing) {
        // Keep the MOST specific root (longer absolute path = more nested)
        if (candidate.rootAbsPath.length <= existing.matchedRoot.length) continue;
      }

      byRepo.set(canonical, {
        name,
        repoPath: canonical,
        obsidianPath,
        status: "active",
        matchedRoot: rootPattern,
      });
    }
  }

  return {
    discovered: [...byRepo.values()].sort((a, b) => a.name.localeCompare(b.name)),
    alreadyConfigured: [...existingNames].sort(),
    roots,
    rootsInferred,
  };
}

interface Candidate {
  absPath: string;
  /** Resolved root (without glob) — for computing rel-path in projectMetaFor. */
  rootAbsPath: string;
}

/**
 * Expands a pattern (plain path or glob) and returns candidates to evaluate.
 * - Path without `*`: recursive up to DEFAULT_MAX_DEPTH git directories found.
 * - Path with `*`: uses Bun.Glob to expand; each match is a direct candidate.
 */
async function expandRoot(pattern: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const hasGlob = pattern.includes("*");

  if (hasGlob) {
    // Glob: use Bun.Glob. We need the glob's "root" (the fixed part before the first *).
    const firstStar = pattern.indexOf("*");
    const rootPart = pattern.slice(0, firstStar);
    const globPart = pattern.slice(firstStar);
    const rootAbsPath = resolve(rootPart || ".");
    if (!existsSync(rootAbsPath)) return [];
    const glob = new Bun.Glob(globPart);
    for await (const rel of glob.scan({ cwd: rootAbsPath, onlyFiles: false, absolute: false })) {
      const absPath = join(rootAbsPath, rel);
      const st = await safeStat(absPath);
      if (!st?.isDirectory()) continue;
      candidates.push({ absPath, rootAbsPath });
    }
    return candidates;
  }

  // No glob → recursive
  const rootAbsPath = resolve(pattern);
  if (!existsSync(rootAbsPath)) return [];
  const st = await safeStat(rootAbsPath);
  if (!st?.isDirectory()) return [];

  // If the root itself is a git repo, add it and DO NOT recurse.
  if (isGitRepo(rootAbsPath)) {
    candidates.push({ absPath: rootAbsPath, rootAbsPath });
    return candidates;
  }

  await walkForRepos(rootAbsPath, rootAbsPath, 0, DEFAULT_MAX_DEPTH, candidates);
  return candidates;
}

async function walkForRepos(currentPath: string, rootAbsPath: string, depth: number, maxDepth: number, out: Candidate[]): Promise<void> {
  if (depth > maxDepth) return;
  let entries: string[];
  try { entries = await readdir(currentPath); } catch { return; }
  for (const name of entries) {
    if (EXCLUDED_DIRS.has(name) || name.startsWith(".")) continue;
    const full = join(currentPath, name);
    const st = await safeStat(full);
    if (!st?.isDirectory()) continue;
    if (isGitRepo(full)) {
      out.push({ absPath: full, rootAbsPath });
      // Do not recurse inside a git repo (avoids submodules and accidental nested repos)
      continue;
    }
    await walkForRepos(full, rootAbsPath, depth + 1, maxDepth, out);
  }
}

async function safeStat(path: string): Promise<{ isDirectory: () => boolean } | null> {
  try { return await stat(path); } catch { return null; }
}

function isGitRepo(path: string): boolean {
  return existsSync(join(path, ".git"));
}

/**
 * Derives `name` and `obsidianPath` from the repo path and the root it was discovered from.
 *
 * Naming convention:
 *   - rootAbsPath = "/Users/alice/projects"
 *   - repoAbsPath = "/Users/alice/projects/acme/app"
 *   - rel         = "acme/app"
 *   - basename(rootAbsPath) = "crewtives"
 *   - name        = "crewtives-acme-app"
 *   - obsidianPath = "<vault>/Projects/crewtives/acme/app"
 *
 *   - rootAbsPath = "/Users/alice/projects"
 *   - repoAbsPath = "/Users/alice/projects/portfolio"
 *   - name        = "crewtives-portfolio"
 *   - obsidianPath = "<vault>/Projects/crewtives/portfolio"
 */
export function projectMetaFor(opts: {
  rootPattern: string;
  rootAbsPath: string;
  repoAbsPath: string;
  vaultPath: string;
}): { name: string; obsidianPath: string } {
  const rel = relative(opts.rootAbsPath, opts.repoAbsPath);
  const rootName = basenameSafe(opts.rootAbsPath);
  // If the repo IS the root itself (rare), name = rootName, obsidianPath = vault/Projects/rootName
  if (!rel || rel === ".") {
    return {
      name: rootName,
      obsidianPath: join(opts.vaultPath, "Projects", rootName),
    };
  }
  const relSlug = rel.replace(/[\\/]/g, "-");
  const name = `${rootName}-${relSlug}`;
  const obsidianPath = join(opts.vaultPath, "Projects", rootName, rel);
  return { name, obsidianPath };
}

function basenameSafe(absPath: string): string {
  const parts = absPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "project";
}

/**
 * If `discoverRoots` is not configured, infer unique roots by taking ONLY
 * the immediate dirname of each current repoPath.
 *
 * Keeping it at 1 level avoids scanning super-generic paths like `~/projects`
 * that would discover repos from unrelated orgs.
 *
 *   ~/projects/crewtives/janus → root ~/projects/crewtives
 *   ~/projects/crewtives/acme/app → root ~/projects/crewtives/acme
 *
 * If you want a more generic root (e.g. `~/projects` covering many orgs),
 * configure it explicitly with `discoverRoots` in config.local.json.
 */
export function inferRootsFromProjects(projects: ProjectConfig[]): string[] {
  const roots = new Set<string>();
  for (const p of projects) {
    const d1 = dirname(p.repoPath);
    if (d1 && d1 !== "/" && d1 !== ".") roots.add(d1);
  }
  return [...roots];
}

/**
 * Renders a new entry for config.local.json (JSON with indent 2).
 */
export function renderProjectEntry(p: DiscoveredProject, vaultPath: string): Record<string, string> {
  // Use ~/ relative if possible
  const home = process.env.HOME ?? "";
  const repoPath = home && p.repoPath.startsWith(home) ? `~${p.repoPath.slice(home.length)}` : p.repoPath;
  const obsidianPath = home && p.obsidianPath.startsWith(home) ? `~${p.obsidianPath.slice(home.length)}` : p.obsidianPath;
  return {
    name: p.name,
    repoPath,
    obsidianPath,
    status: p.status,
  };
}
