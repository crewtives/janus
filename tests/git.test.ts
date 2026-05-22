import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActivity, getCommits, getCurrentBranch, isRepo } from "../src/core/git.ts";

let repo: string;

async function runIn(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
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
