import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  diffConfig,
  loadExistingConfig,
  writeConfig,
} from "../src/core/init/config-merge.ts";
import type { JanusConfig } from "../src/config/types.ts";

function baseConfig(overrides: Partial<JanusConfig> = {}): JanusConfig {
  return {
    obsidianVault: "/Users/test/Obsidian",
    projects: [
      {
        name: "test-proj",
        repoPath: "/Users/test/projects/test",
        obsidianPath: "/Users/test/Obsidian/Projects/test",
        status: "active",
      },
    ],
    concurrency: 2,
    intervalCap: 5,
    intervalMs: 60_000,
    taskTimeoutMs: 30 * 60_000,
    stateDir: "/Users/test/projects/janus/.janus",
    model: "sonnet",
    effort: "xhigh",
    fallbackModel: "opus",
    ...overrides,
  };
}

describe("loadExistingConfig", () => {
  test("status missing when the file does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-cfg-"));
    try {
      const r = await loadExistingConfig(dir);
      expect(r.status).toBe("missing");
      expect(r.path).toContain("config.local.json");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("status valid with well-formed JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-cfg-"));
    try {
      await writeFile(
        join(dir, "config.local.json"),
        JSON.stringify(baseConfig()),
      );
      const r = await loadExistingConfig(dir);
      expect(r.status).toBe("valid");
      expect(r.config?.obsidianVault).toBe("/Users/test/Obsidian");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("status invalid with broken JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-cfg-"));
    try {
      await writeFile(join(dir, "config.local.json"), "{ not valid json");
      const r = await loadExistingConfig(dir);
      expect(r.status).toBe("invalid");
      expect(r.errors?.[0]).toContain("parse");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("status invalid when obsidianVault is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-cfg-"));
    try {
      await writeFile(
        join(dir, "config.local.json"),
        JSON.stringify({ projects: [{ name: "x", repoPath: "/x", obsidianPath: "/y" }] }),
      );
      const r = await loadExistingConfig(dir);
      expect(r.status).toBe("invalid");
      expect(r.errors?.join(" ")).toContain("obsidianVault");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("status invalid when projects is empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-cfg-"));
    try {
      await writeFile(
        join(dir, "config.local.json"),
        JSON.stringify({ obsidianVault: "/x", projects: [] }),
      );
      const r = await loadExistingConfig(dir);
      expect(r.status).toBe("invalid");
      expect(r.errors?.join(" ")).toContain("projects");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("diffConfig", () => {
  test("existing=null → everything in added", () => {
    const proposed = baseConfig();
    const d = diffConfig(null, proposed);
    expect(d.added.length).toBeGreaterThan(0);
    expect(d.changed).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toEqual([]);
    // obsidianVault entre los added
    expect(d.added.find((f) => f.field === "obsidianVault")).toBeDefined();
  });

  test("equal configs → everything in unchanged", () => {
    const a = baseConfig();
    const b = baseConfig();
    const d = diffConfig(a, b);
    expect(d.changed).toEqual([]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged.find((f) => f.field === "obsidianVault")).toBeDefined();
    expect(d.unchanged.find((f) => f.field === "model")).toBeDefined();
  });

  test("model changed → in changed", () => {
    const a = baseConfig({ model: "sonnet" });
    const b = baseConfig({ model: "opus" });
    const d = diffConfig(a, b);
    const modelDiff = d.changed.find((f) => f.field === "model");
    expect(modelDiff).toBeDefined();
    expect(modelDiff?.oldValue).toBe("sonnet");
    expect(modelDiff?.newValue).toBe("opus");
  });

  test("discord added → in added", () => {
    const a = baseConfig();
    const b = baseConfig({ discord: { webhookUrl: "https://discord.com/api/webhooks/1/x" } });
    const d = diffConfig(a, b);
    expect(d.added.find((f) => f.field === "discord")).toBeDefined();
  });

  test("project added to the array → entire projects in changed", () => {
    const a = baseConfig();
    const b = baseConfig({
      projects: [
        ...a.projects,
        { name: "p2", repoPath: "/p2", obsidianPath: "/op2", status: "active" },
      ],
    });
    const d = diffConfig(a, b);
    expect(d.changed.find((f) => f.field === "projects")).toBeDefined();
  });
});

describe("writeConfig", () => {
  test("writes to a new target, without backup, written:true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-cfg-"));
    try {
      const target = join(dir, "config.local.json");
      const result = await writeConfig(target, baseConfig(), { backup: false });
      expect(result.written).toBe(true);
      expect(result.backupPath).toBeUndefined();
      const content = await readFile(target, "utf-8");
      expect(content).toContain("obsidianVault");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not write when content is byte-equal, written:false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-cfg-"));
    try {
      const target = join(dir, "config.local.json");
      const cfg = baseConfig();
      await writeConfig(target, cfg, { backup: false });
      const result2 = await writeConfig(target, cfg, { backup: true });
      expect(result2.written).toBe(false);
      expect(result2.backupPath).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("with backup:true over a different existing file, creates .bak.<ts>", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-cfg-"));
    try {
      const target = join(dir, "config.local.json");
      await writeConfig(target, baseConfig({ model: "sonnet" }), { backup: false });
      const result = await writeConfig(target, baseConfig({ model: "opus" }), { backup: true });
      expect(result.written).toBe(true);
      expect(result.backupPath).toBeDefined();
      expect(result.backupPath).toMatch(/\.bak\.\d+$/);
      // Backup tiene contenido viejo
      const backup = await readFile(result.backupPath!, "utf-8");
      expect(backup).toContain('"sonnet"');
      // Target tiene contenido nuevo
      const current = await readFile(target, "utf-8");
      expect(current).toContain('"opus"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
