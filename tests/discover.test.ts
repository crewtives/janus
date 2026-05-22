import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjects, inferRootsFromProjects, projectMetaFor } from "../src/core/discover.ts";
import type { JanusConfig } from "../src/config/types.ts";

async function makeFakeRepo(dir: string): Promise<void> {
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main");
}

async function setupSandbox(structure: {
  reposToCreate: string[]; // relative paths inside sandbox
  excludedDirs?: string[]; // dirs that should NOT be repos
}): Promise<{ sandbox: string; cleanup: () => Promise<void> }> {
  const sandbox = await mkdtemp(join(tmpdir(), "janus-discover-"));
  for (const rel of structure.reposToCreate) {
    const abs = join(sandbox, rel);
    await mkdir(abs, { recursive: true });
    await makeFakeRepo(abs);
  }
  for (const rel of structure.excludedDirs ?? []) {
    await mkdir(join(sandbox, rel), { recursive: true });
  }
  return { sandbox, cleanup: () => rm(sandbox, { recursive: true, force: true }) };
}

function makeConfig(opts: { vaultPath: string; projects?: Array<{ name: string; repoPath: string; obsidianPath: string; status?: "active" | "paused" | "archived" }>; discoverRoots?: string[] }): JanusConfig {
  return {
    obsidianVault: opts.vaultPath,
    projects: (opts.projects ?? []).map((p) => ({ ...p, status: p.status ?? "active" })),
    discoverRoots: opts.discoverRoots,
    concurrency: 1, intervalCap: 5, intervalMs: 60_000, taskTimeoutMs: 60_000,
    stateDir: "/tmp/janus-state", model: "sonnet", effort: "xhigh",
  };
}

describe("discoverProjects", () => {
  test("detects repos in discoverRoots with glob *", async () => {
    const { sandbox, cleanup } = await setupSandbox({
      reposToCreate: ["projects/crewtives/janus", "projects/crewtives/portfolio", "projects/crewtives/acme/app"],
    });
    const config = makeConfig({
      vaultPath: "/tmp/vault",
      discoverRoots: [join(sandbox, "projects/crewtives/*")],
    });
    const r = await discoverProjects({ config });
    const names = r.discovered.map((d) => d.name).sort();
    // Glob "crewtives/*" matchea janus, portfolio y acme (que NO es repo en sí, así que skip)
    expect(names).toContain("crewtives-janus");
    expect(names).toContain("crewtives-portfolio");
    expect(names).not.toContain("crewtives-acme"); // acme/ no tiene .git
    await cleanup();
  });

  test("recursive without glob detects nested repos", async () => {
    const { sandbox, cleanup } = await setupSandbox({
      reposToCreate: ["projects/crewtives/janus", "projects/crewtives/acme/app", "projects/crewtives/acme/landing"],
    });
    const config = makeConfig({
      vaultPath: "/tmp/vault",
      discoverRoots: [join(sandbox, "projects/crewtives")],
    });
    const r = await discoverProjects({ config });
    const names = r.discovered.map((d) => d.name).sort();
    expect(names).toEqual(["crewtives-acme-app", "crewtives-acme-landing", "crewtives-janus"]);
    await cleanup();
  });

  test("skips already-configured repos (matching by canonical repoPath)", async () => {
    const { sandbox, cleanup } = await setupSandbox({
      reposToCreate: ["projects/crewtives/janus", "projects/crewtives/portfolio"],
    });
    const existingRepo = join(sandbox, "projects/crewtives/janus");
    const config = makeConfig({
      vaultPath: "/tmp/vault",
      projects: [{ name: "crewtives-janus", repoPath: existingRepo, obsidianPath: "/tmp/vault/Projects/crewtives/janus" }],
      discoverRoots: [join(sandbox, "projects/crewtives")],
    });
    const r = await discoverProjects({ config });
    const names = r.discovered.map((d) => d.name);
    expect(names).toEqual(["crewtives-portfolio"]);
    expect(r.alreadyConfigured).toContain("crewtives-janus");
    await cleanup();
  });

  test("excludes standard directories (node_modules, dist, .next)", async () => {
    const { sandbox, cleanup } = await setupSandbox({
      reposToCreate: ["projects/myrepo"],
      excludedDirs: ["projects/myrepo/node_modules", "projects/myrepo/dist"],
    });
    // Crear fake .git en node_modules para tentar al walker
    const tempPkg = join(sandbox, "projects/myrepo/node_modules/sub-pkg");
    await mkdir(join(tempPkg, ".git"), { recursive: true });
    const config = makeConfig({
      vaultPath: "/tmp/vault",
      discoverRoots: [join(sandbox, "projects")],
    });
    const r = await discoverProjects({ config });
    const names = r.discovered.map((d) => d.name);
    expect(names).toContain("projects-myrepo");
    // sub-pkg en node_modules NO debe descubrirse
    expect(names.some((n) => n.includes("sub-pkg"))).toBe(false);
    await cleanup();
  });

  test("infers roots when there are no discoverRoots", async () => {
    const { sandbox, cleanup } = await setupSandbox({
      reposToCreate: ["org-a/repo1", "org-a/repo2"],
    });
    const existing = join(sandbox, "org-a/repo1");
    const config = makeConfig({
      vaultPath: "/tmp/vault",
      projects: [{ name: "org-a-repo1", repoPath: existing, obsidianPath: "/tmp/vault" }],
      // SIN discoverRoots
    });
    const r = await discoverProjects({ config });
    expect(r.rootsInferred).toBe(true);
    expect(r.discovered.map((d) => d.name)).toContain("org-a-repo2");
    await cleanup();
  });
});

describe("projectMetaFor", () => {
  test("simple path → name org-repo", () => {
    const m = projectMetaFor({
      rootPattern: "/abs/projects/crewtives",
      rootAbsPath: "/abs/projects/crewtives",
      repoAbsPath: "/abs/projects/crewtives/janus",
      vaultPath: "/vault",
    });
    expect(m.name).toBe("crewtives-janus");
    expect(m.obsidianPath).toBe("/vault/Projects/crewtives/janus");
  });

  test("nested → name org-sub-repo", () => {
    const m = projectMetaFor({
      rootPattern: "/abs/projects/crewtives",
      rootAbsPath: "/abs/projects/crewtives",
      repoAbsPath: "/abs/projects/crewtives/acme/app",
      vaultPath: "/vault",
    });
    expect(m.name).toBe("crewtives-acme-app");
    expect(m.obsidianPath).toBe("/vault/Projects/crewtives/acme/app");
  });

  test("repo at root itself → name = basename(root)", () => {
    const m = projectMetaFor({
      rootPattern: "/abs/janus",
      rootAbsPath: "/abs/janus",
      repoAbsPath: "/abs/janus",
      vaultPath: "/vault",
    });
    expect(m.name).toBe("janus");
    expect(m.obsidianPath).toBe("/vault/Projects/janus");
  });
});

describe("inferRootsFromProjects", () => {
  test("returns only the immediate parent (depth 1) per project", () => {
    const roots = inferRootsFromProjects([
      { name: "a", repoPath: "/x/org/repo1", obsidianPath: "/v" },
      { name: "b", repoPath: "/x/org/sub/repo2", obsidianPath: "/v" },
    ]);
    expect(roots).toContain("/x/org");
    expect(roots).toContain("/x/org/sub");
    expect(roots).not.toContain("/x"); // no se incluye el grandparent
  });
});
