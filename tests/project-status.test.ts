import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/loader.ts";

async function writeConfig(content: object): Promise<{ cwd: string; cleanup: () => Promise<void> }> {
  const cwd = await mkdtemp(join(tmpdir(), "janus-cfg-"));
  await writeFile(join(cwd, "config.local.json"), JSON.stringify(content));
  const origCwd = process.cwd();
  process.chdir(cwd);
  return {
    cwd,
    cleanup: async () => {
      process.chdir(origCwd);
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

describe("project status in config", () => {
  test("defaults to 'active' when not specified", async () => {
    const { cleanup } = await writeConfig({
      obsidianVault: "/tmp/vault",
      projects: [{ name: "test", repoPath: "/tmp/repo", obsidianPath: "/tmp/vault/test" }],
    });
    const cfg = await loadConfig();
    expect(cfg.projects[0]!.status).toBe("active");
    await cleanup();
  });

  test("respects explicit status 'paused'", async () => {
    const { cleanup } = await writeConfig({
      obsidianVault: "/tmp/vault",
      projects: [{ name: "p", repoPath: "/tmp/repo", obsidianPath: "/tmp/vault/p", status: "paused" }],
    });
    const cfg = await loadConfig();
    expect(cfg.projects[0]!.status).toBe("paused");
    await cleanup();
  });

  test("respects explicit status 'archived'", async () => {
    const { cleanup } = await writeConfig({
      obsidianVault: "/tmp/vault",
      projects: [
        { name: "a", repoPath: "/tmp/repo-a", obsidianPath: "/tmp/vault/a", status: "active" },
        { name: "b", repoPath: "/tmp/repo-b", obsidianPath: "/tmp/vault/b", status: "archived" },
      ],
    });
    const cfg = await loadConfig();
    expect(cfg.projects[0]!.status).toBe("active");
    expect(cfg.projects[1]!.status).toBe("archived");
    await cleanup();
  });
});
