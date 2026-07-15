import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActivity, getCommits, getCurrentBranch, isRepo } from "../src/core/git.ts";

let repo: string;

async function runIn(cwd: string, args: string[], env?: Record<string, string>): Promise<void> {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`${args.join(" ")} failed: ${err}`);
  }
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "janus-git-test-"));
  await runIn(repo, ["git", "init", "-b", "main"]);
  await runIn(repo, ["git", "config", "user.email", "test@janus.local"]);
  await runIn(repo, ["git", "config", "user.name", "Janus Test"]);
  await runIn(repo, ["git", "config", "commit.gpgsign", "false"]);

  await Bun.write(join(repo, "README.md"), "# initial\n");
  await runIn(repo, ["git", "add", "README.md"]);
  await runIn(repo, ["git", "commit", "-m", "init: primer commit", "-m", "body de prueba"]);

  await Bun.write(join(repo, "src.ts"), "export const x = 1;\n");
  await Bun.write(join(repo, "README.md"), "# initial\n\nUpdate\n");
  await runIn(repo, ["git", "add", "."]);
  await runIn(repo, ["git", "commit", "-m", "feat: agrega módulo src"]);
});

afterAll(async () => {
  if (repo) await rm(repo, { recursive: true, force: true });
});

describe("git", () => {
  test("isRepo detects a valid repo", async () => {
    expect(await isRepo(repo)).toBe(true);
  });

  test("isRepo returns false on a non-repo path", async () => {
    expect(await isRepo(tmpdir())).toBe(false);
  });

  test("getCurrentBranch returns main", async () => {
    expect(await getCurrentBranch(repo)).toBe("main");
  });

  test("getCommits fetches the 2 commits from 1 hour back", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const commits = await getCommits(repo, oneHourAgo);
    expect(commits.length).toBe(2);
    expect(commits[0]?.subject).toBe("feat: agrega módulo src");
    expect(commits[1]?.subject).toBe("init: primer commit");
    expect(commits[1]?.body).toBe("body de prueba");
    expect(commits[0]?.shortSha.length).toBeGreaterThan(5);
  });

  test("getCommits returns [] when there is nothing in the range", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const commits = await getCommits(repo, future);
    expect(commits).toEqual([]);
  });

  test("getActivity exposes filesChanged and diffStat", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const activity = await getActivity(repo, oneHourAgo);
    expect(activity.commits.length).toBe(2);
    expect(activity.filesChanged).toContain("README.md");
    expect(activity.filesChanged).toContain("src.ts");
    expect(activity.diffStat.length).toBeGreaterThan(0);
    expect(activity.currentBranch).toBe("main");
    expect(activity.isClean).toBe(true);
  });

  test("getActivity detects a dirty working tree", async () => {
    await Bun.write(join(repo, "dirty.txt"), "uncommitted\n");
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const activity = await getActivity(repo, oneHourAgo);
    expect(activity.isClean).toBe(false);
    // cleanup
    await rm(join(repo, "dirty.txt"));
  });
});

// Which refs the log walks decides what a pulse can ever see. Fixed commit dates keep the
// window assertions independent of the real clock.
describe("git — ref coverage", () => {
  const DAY = "2026-07-11";
  const SINCE = `${DAY}T00:00:00Z`;
  const UNTIL = `${DAY}T23:59:59Z`;
  const BRANCH_SUBJECT = "perf: trabajo en rama sin mergear";
  const BOT_SUBJECT = "chore(deps): update actions/checkout action to v6";

  let refsRepo: string;
  let branchSha: string;

  async function commitAt(cwd: string, iso: string, message: string): Promise<void> {
    await runIn(cwd, ["git", "commit", "-m", message], {
      GIT_AUTHOR_DATE: iso,
      GIT_COMMITTER_DATE: iso,
    });
  }

  async function gitOut(cwd: string, args: string[]): Promise<string> {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.trim();
  }

  beforeAll(async () => {
    refsRepo = await mkdtemp(join(tmpdir(), "janus-git-refs-"));
    await runIn(refsRepo, ["git", "init", "-b", "main"]);
    await runIn(refsRepo, ["git", "config", "user.email", "test@janus.local"]);
    await runIn(refsRepo, ["git", "config", "user.name", "Janus Test"]);
    await runIn(refsRepo, ["git", "config", "commit.gpgsign", "false"]);

    await Bun.write(join(refsRepo, "main.txt"), "main\n");
    await runIn(refsRepo, ["git", "add", "."]);
    await commitAt(refsRepo, "2026-07-10T12:00:00Z", "chore: base en main");

    // Work committed on a branch that is not merged yet and that HEAD is not parked on.
    await runIn(refsRepo, ["git", "checkout", "-q", "-b", "perf/branch-work"]);
    await Bun.write(join(refsRepo, "branch.txt"), "branch work\n");
    await runIn(refsRepo, ["git", "add", "."]);
    await commitAt(refsRepo, `${DAY}T12:00:00Z`, BRANCH_SUBJECT);
    branchSha = await gitOut(refsRepo, ["rev-parse", "HEAD"]);
    // Second ref onto the same commit: the walk must still yield it once.
    await runIn(refsRepo, ["git", "branch", "dup-ref"]);
    await runIn(refsRepo, ["git", "checkout", "-q", "main"]);

    // A bot-pushed dependency PR branch: reachable only from refs/remotes.
    await runIn(refsRepo, ["git", "checkout", "-q", "-b", "tmp-bot"]);
    await Bun.write(join(refsRepo, "deps.txt"), "bump\n");
    await runIn(refsRepo, ["git", "add", "."]);
    await commitAt(refsRepo, `${DAY}T13:00:00Z`, BOT_SUBJECT);
    const botSha = await gitOut(refsRepo, ["rev-parse", "HEAD"]);
    await runIn(refsRepo, ["git", "checkout", "-q", "main"]);
    await runIn(refsRepo, ["git", "update-ref", "refs/remotes/origin/renovate/actions-checkout-6.x", botSha]);
    await runIn(refsRepo, ["git", "branch", "-D", "tmp-bot"]);

    // refs/stash carries "WIP on ..." pseudo-commits that --all would walk.
    await Bun.write(join(refsRepo, "main.txt"), "dirty\n");
    await runIn(refsRepo, ["git", "stash"], {
      GIT_AUTHOR_DATE: `${DAY}T14:00:00Z`,
      GIT_COMMITTER_DATE: `${DAY}T14:00:00Z`,
    });
  });

  afterAll(async () => {
    if (refsRepo) await rm(refsRepo, { recursive: true, force: true });
  });

  test("getCommits sees work on a local branch HEAD is not parked on", async () => {
    expect(await getCurrentBranch(refsRepo)).toBe("main");
    const subjects = (await getCommits(refsRepo, SINCE, UNTIL)).map((c) => c.subject);
    expect(subjects).toContain(BRANCH_SUBJECT);
  });

  test("getCommits excludes remote-tracking refs", async () => {
    const subjects = (await getCommits(refsRepo, SINCE, UNTIL)).map((c) => c.subject);
    expect(subjects).not.toContain(BOT_SUBJECT);
  });

  test("getCommits excludes stash pseudo-commits", async () => {
    const subjects = (await getCommits(refsRepo, SINCE, UNTIL)).map((c) => c.subject);
    expect(subjects.some((s) => s.startsWith("WIP on") || s.startsWith("index on"))).toBe(false);
  });

  test("getCommits yields a commit reachable from several branches only once", async () => {
    const shas = (await getCommits(refsRepo, SINCE, UNTIL)).map((c) => c.sha);
    expect(shas.filter((s) => s === branchSha).length).toBe(1);
    expect(new Set(shas).size).toBe(shas.length);
  });

  test("getActivity counts branch work once across diffStat and numstat", async () => {
    const activity = await getActivity(refsRepo, SINCE, UNTIL);
    expect(activity.filesChanged).toEqual(["branch.txt"]);
    expect(activity.insertions).toBe(1);
    expect(activity.commits.length).toBe(1);
  });
});
