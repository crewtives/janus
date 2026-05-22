import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDiscordWebhook } from "../src/core/doctor.ts";
import { detectObsidianVaults, testDiscordWebhook } from "../src/core/init/detect.ts";

describe("validateDiscordWebhook", () => {
  test("accepts canonical Discord webhook URL", () => {
    const r = validateDiscordWebhook("https://discord.com/api/webhooks/123456789/abc-DEF_xyz");
    expect(r.ok).toBe(true);
  });

  test("rejects URL from another host", () => {
    const r = validateDiscordWebhook("https://example.com/api/webhooks/123/abc");
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("Discord");
  });

  test("rejects malformed URL", () => {
    const r = validateDiscordWebhook("not-a-url");
    expect(r.ok).toBe(false);
  });

  test("rejects empty string", () => {
    const r = validateDiscordWebhook("");
    expect(r.ok).toBe(false);
  });

  test("rejects http (not https)", () => {
    const r = validateDiscordWebhook("http://discord.com/api/webhooks/123/abc");
    expect(r.ok).toBe(false);
  });
});

describe("detectObsidianVaults", () => {
  test("finds a vault with .obsidian/ inside", async () => {
    const root = await mkdtemp(join(tmpdir(), "janus-vault-"));
    try {
      const vaultPath = join(root, "MyVault");
      await mkdir(join(vaultPath, ".obsidian"), { recursive: true });
      await writeFile(join(vaultPath, ".obsidian", "config"), "{}");

      const result = await detectObsidianVaults([root]);
      expect(result.vaults).toContain(vaultPath);
      expect(result.reason).toBe("complete");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns empty when there are no vaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "janus-vault-"));
    try {
      await mkdir(join(root, "some-folder"), { recursive: true });
      const result = await detectObsidianVaults([root]);
      expect(result.vaults).toEqual([]);
      expect(result.reason).toBe("complete");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("excludes node_modules and other standard dirs", async () => {
    const root = await mkdtemp(join(tmpdir(), "janus-vault-"));
    try {
      // Vault dentro de node_modules — no debería encontrarlo
      await mkdir(join(root, "node_modules", "lib", ".obsidian"), { recursive: true });
      // Vault dentro de un dir normal — sí debería
      await mkdir(join(root, "real-vault", ".obsidian"), { recursive: true });

      const result = await detectObsidianVaults([root]);
      expect(result.vaults).toContain(join(root, "real-vault"));
      expect(result.vaults).not.toContain(join(root, "node_modules", "lib"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("respects max-depth (does not enter level 4+)", async () => {
    const root = await mkdtemp(join(tmpdir(), "janus-vault-"));
    try {
      // root es depth 0
      // a/ es depth 1
      // a/b/ es depth 2
      // a/b/c/ es depth 3
      // a/b/c/d/.obsidian existe pero d/ está en depth 4 — no se visita
      await mkdir(join(root, "a", "b", "c", "d", ".obsidian"), { recursive: true });
      const result = await detectObsidianVaults([root]);
      expect(result.vaults).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not recurse inside a detected vault", async () => {
    const root = await mkdtemp(join(tmpdir(), "janus-vault-"));
    try {
      // Vault padre con .obsidian, y un sub-vault adentro (caso patológico)
      await mkdir(join(root, "parent", ".obsidian"), { recursive: true });
      await mkdir(join(root, "parent", "nested-vault", ".obsidian"), { recursive: true });

      const result = await detectObsidianVaults([root]);
      expect(result.vaults).toContain(join(root, "parent"));
      // El nested no debería aparecer porque paramos al detectar el padre
      expect(result.vaults).not.toContain(join(root, "parent", "nested-vault"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ignores roots that do not exist", async () => {
    const result = await detectObsidianVaults(["/path/que/definitivamente/no/existe/xyz123"]);
    expect(result.vaults).toEqual([]);
    expect(result.reason).toBe("complete");
  });
});

describe("testDiscordWebhook", () => {
  test("returns ok:false without throwing on an invalid URL", async () => {
    const result = await testDiscordWebhook("https://invalid-host-that-does-not-exist-xyz123.example/webhook");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("returns ok:false on a malformed URL", async () => {
    const result = await testDiscordWebhook("not-a-url");
    expect(result.ok).toBe(false);
  });
});
