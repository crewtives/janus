import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/loader.ts";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function load(provider?: string) {
  root = await mkdtemp(join(tmpdir(), "janus-provider-config-"));
  const path = join(root, "config.json");
  await writeFile(path, JSON.stringify({
    obsidianVault: join(root, "vault"),
    projects: [{
      name: "alpha",
      repoPath: join(root, "alpha"),
      obsidianPath: join(root, "vault", "alpha"),
    }],
    ...(provider ? { provider } : {}),
  }));
  return loadConfig(path);
}

describe("provider-specific config defaults", () => {
  test("keeps the historical Claude defaults", async () => {
    const config = await load();
    expect(config.provider).toBe("claude-code");
    expect(config.model).toBe("sonnet");
    expect(config.effort).toBe("xhigh");
    expect(config.fallbackModel).toBe("opus");
  });

  test("does not leak Claude model names into Codex", async () => {
    const config = await load("codex");
    expect(config.provider).toBe("codex");
    expect(config.model).toBeUndefined();
    expect(config.effort).toBeUndefined();
    expect(config.fallbackModel).toBeUndefined();
  });

  test("does not leak Claude model names into Gemini", async () => {
    const config = await load("gemini-cli");
    expect(config.model).toBeUndefined();
    expect(config.effort).toBeUndefined();
    expect(config.fallbackModel).toBeUndefined();
  });
});
