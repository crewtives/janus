import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectConfig } from "../src/config/types.ts";
import { getProjectContext, matchTrackedProject } from "../src/core/project-context.ts";

const roots: string[] = [];

async function fixture(): Promise<{
  root: string;
  repo: string;
  nestedRepo: string;
  project: ProjectConfig;
  nestedProject: ProjectConfig;
}> {
  const root = await mkdtemp(join(tmpdir(), "janus-context-"));
  roots.push(root);
  const repo = join(root, "alpha");
  const nestedRepo = join(repo, "packages", "beta");
  const vault = join(root, "vault");
  await mkdir(nestedRepo, { recursive: true });
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(root, "alpha-old"), { recursive: true });
  await mkdir(join(vault, "alpha"), { recursive: true });
  await mkdir(join(vault, "beta"), { recursive: true });
  return {
    root,
    repo,
    nestedRepo,
    project: { name: "alpha", repoPath: repo, obsidianPath: join(vault, "alpha") },
    nestedProject: { name: "beta", repoPath: nestedRepo, obsidianPath: join(vault, "beta") },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("matchTrackedProject", () => {
  test("matches exact and nested paths but not sibling prefixes", async () => {
    const f = await fixture();
    expect((await matchTrackedProject(f.repo, [f.project]))?.name).toBe("alpha");
    expect((await matchTrackedProject(join(f.repo, "src"), [f.project]))?.name).toBe("alpha");
    expect(await matchTrackedProject(join(f.root, "alpha-old"), [f.project])).toBeNull();
  });

  test("selects the most specific configured repository", async () => {
    const f = await fixture();
    expect((await matchTrackedProject(f.nestedRepo, [f.project, f.nestedProject]))?.name).toBe("beta");
  });

  test("resolves symlinked working directories", async () => {
    const f = await fixture();
    const alias = join(f.root, "alias");
    await symlink(f.repo, alias);
    expect((await matchTrackedProject(join(alias, "src"), [f.project]))?.name).toBe("alpha");
  });
});

describe("getProjectContext", () => {
  test("returns a tracked project and its spine", async () => {
    const f = await fixture();
    await writeFile(join(f.project.obsidianPath, "alpha-spine.md"), "# Alpha\n\nCurrent narrative.");
    const result = await getProjectContext(f.repo, [f.project]);
    expect(result).toMatchObject({ tracked: true, state: "ready", project: "alpha" });
    if (result.tracked) expect(result.spine).toContain("Current narrative");
  });

  test("returns tracked-without-spine as a recoverable state", async () => {
    const f = await fixture();
    expect(await getProjectContext(f.repo, [f.project])).toEqual({
      tracked: true,
      state: "missing-spine",
      project: "alpha",
      spine: null,
    });
  });

  test("returns only an untracked discriminator outside scope", async () => {
    const f = await fixture();
    expect(await getProjectContext(f.root, [f.project])).toEqual({ tracked: false, state: "untracked" });
  });
});
