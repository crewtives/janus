export interface GitCommit {
  sha: string;
  shortSha: string;
  author: string;
  date: string; // ISO
  subject: string;
  body: string;
}

export interface GitActivity {
  commits: GitCommit[];
  filesChanged: string[];
  diffStat: string; // raw output of --stat
  currentBranch: string;
  isClean: boolean; // whether the working tree is clean
  /** Commit count per conventional type (feat, fix, chore, docs, refactor, test, build, ci, perf, style, revert, other). */
  commitTypes: Record<string, number>;
  /** Lines added (summed from numstat). */
  insertions: number;
  /** Lines removed. */
  deletions: number;
  /** Top touched folders with file counts. */
  topFolders: Array<{ folder: string; count: number }>;
}

const GIT_LOG_FORMAT = "%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%b%x1e";

// git log walks HEAD by default, so a pulse only saw whatever branch happened to be checked
// out when it ran. Merge commits preserve the original committer dates, so work committed on a
// branch and merged the next day lands in a window that was already processed: no pulse ever
// reports it. refs/heads + HEAD covers every local branch (and a detached HEAD) and git's
// revision walk visits each commit once, so there is nothing to deduplicate. This is
// deliberately narrower than --all, which also drags in refs/remotes (bot-pushed dependency
// PR branches the user never wrote) and refs/stash (WIP pseudo-commits).
const LOG_REVS = ["--branches", "HEAD"];

export async function getActivity(repoPath: string, sinceISO: string, untilISO?: string): Promise<GitActivity> {
  const [commits, diffStat, branch, status, numstat] = await Promise.all([
    getCommits(repoPath, sinceISO, untilISO),
    getDiffStat(repoPath, sinceISO, untilISO),
    getCurrentBranch(repoPath),
    getStatusShort(repoPath),
    getNumstat(repoPath, sinceISO, untilISO),
  ]);
  const filesChanged = parseFilesFromStat(diffStat);
  const commitTypes = categorizeCommits(commits);
  const { insertions, deletions } = sumNumstat(numstat);
  const topFolders = countTopFolders(filesChanged, 5);
  return {
    commits,
    filesChanged,
    diffStat,
    currentBranch: branch,
    isClean: status.trim().length === 0,
    commitTypes,
    insertions,
    deletions,
    topFolders,
  };
}

export async function getNumstat(repoPath: string, sinceISO: string, untilISO?: string): Promise<string> {
  const args = ["log", ...LOG_REVS, `--since=${sinceISO}`, "--pretty=format:", "--numstat"];
  if (untilISO) args.push(`--until=${untilISO}`);
  return runGit(repoPath, args);
}

const CONVENTIONAL_TYPES = new Set([
  "feat", "fix", "chore", "docs", "refactor", "test", "build", "ci", "perf", "style", "revert",
]);

export function categorizeCommits(commits: GitCommit[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of commits) {
    const m = c.subject.match(/^([a-z]+)(?:\([^)]+\))?!?:/i);
    const type = m && m[1] && CONVENTIONAL_TYPES.has(m[1].toLowerCase()) ? m[1].toLowerCase() : "other";
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

function sumNumstat(numstat: string): { insertions: number; deletions: number } {
  let ins = 0;
  let del = 0;
  for (const line of numstat.split("\n")) {
    const parts = line.trim().split("\t");
    if (parts.length < 3) continue;
    const a = parts[0];
    const b = parts[1];
    if (a === "-" || b === "-") continue; // binary file
    const ai = parseInt(a ?? "0", 10);
    const bi = parseInt(b ?? "0", 10);
    if (!isNaN(ai)) ins += ai;
    if (!isNaN(bi)) del += bi;
  }
  return { insertions: ins, deletions: del };
}

function countTopFolders(files: string[], topN: number): Array<{ folder: string; count: number }> {
  const counts = new Map<string, number>();
  for (const f of files) {
    const folder = f.includes("/") ? f.split("/").slice(0, 2).join("/") : "(root)";
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

export async function getCommits(repoPath: string, sinceISO: string, untilISO?: string): Promise<GitCommit[]> {
  const args = [
    "log",
    ...LOG_REVS,
    `--since=${sinceISO}`,
    `--pretty=format:${GIT_LOG_FORMAT}`,
  ];
  if (untilISO) args.push(`--until=${untilISO}`);
  const raw = await runGit(repoPath, args);
  if (!raw.trim()) return [];
  return raw
    .split("\x1e")
    .map((rec) => rec.trim())
    .filter(Boolean)
    .map(parseCommit);
}

export async function getDiffStat(repoPath: string, sinceISO: string, untilISO?: string): Promise<string> {
  const args = [
    "log",
    ...LOG_REVS,
    `--since=${sinceISO}`,
    "--pretty=format:",
    "--stat",
  ];
  if (untilISO) args.push(`--until=${untilISO}`);
  return runGit(repoPath, args);
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const branch = await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch.trim();
}

export async function getStatusShort(repoPath: string): Promise<string> {
  return runGit(repoPath, ["status", "--short"]);
}

export async function isRepo(repoPath: string): Promise<boolean> {
  try {
    await runGit(repoPath, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

function parseCommit(rec: string): GitCommit {
  const [sha = "", shortSha = "", author = "", date = "", subject = "", body = ""] = rec.split("\x1f");
  return {
    sha,
    shortSha,
    author,
    date,
    subject,
    body: body.trim(),
  };
}

function parseFilesFromStat(stat: string): string[] {
  // git --stat format: " path/to/file | 12 ++++--"
  // summary at the end: " 3 files changed, ..." (skip it)
  const files = new Set<string>();
  for (const line of stat.split("\n")) {
    const m = line.match(/^\s*([^|]+?)\s+\|\s+\d+/);
    if (m && m[1]) files.add(m[1].trim());
  }
  return [...files];
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${proc.exitCode}): ${stderr.trim()}`);
  }
  return stdout;
}
