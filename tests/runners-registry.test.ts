import { describe, expect, test } from "bun:test";
import { createRunner, isValidProvider, resolveRunner } from "../src/runners/registry.ts";
import { ClaudeCodeRunner } from "../src/runners/claude-code.ts";
import { GeminiRunner } from "../src/runners/gemini.ts";
import { CodexRunner } from "../src/runners/codex.ts";
import type { JanusConfig } from "../src/config/types.ts";

function configFor(provider?: JanusConfig["provider"], fallback?: JanusConfig["fallbackProvider"]): JanusConfig {
  return {
    obsidianVault: "/tmp/vault",
    projects: [],
    provider,
    fallbackProvider: fallback,
  };
}

describe("registry.isValidProvider", () => {
  test("accepts known providers", () => {
    expect(isValidProvider("claude-code")).toBe(true);
    expect(isValidProvider("gemini-cli")).toBe(true);
    expect(isValidProvider("codex")).toBe(true);
  });
  test("rejects unknown providers", () => {
    expect(isValidProvider("other")).toBe(false);
    expect(isValidProvider("")).toBe(false);
  });
});

describe("registry.createRunner", () => {
  test("creates ClaudeCodeRunner for claude-code", () => {
    const r = createRunner("claude-code");
    expect(r).toBeInstanceOf(ClaudeCodeRunner);
    expect(r.id).toBe("claude-code");
  });
  test("creates GeminiRunner for gemini-cli", () => {
    const r = createRunner("gemini-cli");
    expect(r).toBeInstanceOf(GeminiRunner);
    expect(r.id).toBe("gemini-cli");
  });
  test("creates CodexRunner for codex", () => {
    const r = createRunner("codex");
    expect(r).toBeInstanceOf(CodexRunner);
    expect(r.id).toBe("codex");
  });
});

describe("registry.resolveRunner", () => {
  test("defaults to claude-code when provider not set", () => {
    const r = resolveRunner(configFor());
    expect(r.id).toBe("claude-code");
  });

  test("uses configured provider", () => {
    const r = resolveRunner(configFor("gemini-cli"));
    expect(r.id).toBe("gemini-cli");
  });

  test("ignores fallback equal to primary (no-op)", () => {
    const r = resolveRunner(configFor("claude-code", "claude-code"));
    expect(r.id).toBe("claude-code");
  });

  test("wraps with fallback when secondary differs", () => {
    const r = resolveRunner(configFor("claude-code", "gemini-cli"));
    // withFallback compone el id como "<primary>+<secondary>"
    expect(r.id).toBe("claude-code+gemini-cli");
  });
});

describe("ClaudeCodeRunner capabilities", () => {
  test("declares full Claude Code feature set", () => {
    const c = new ClaudeCodeRunner().capabilities;
    expect(c.sessionResume).toBe(true);
    expect(c.effortControl).toBe(true);
    expect(c.addDirs).toBe(true);
    expect(c.disableTools).toBe(true);
    expect(c.fallbackModel).toBe(true);
    expect(c.costTracking).toBe(true);
    expect(c.jsonStream).toBe(true);
  });
});

describe("GeminiRunner capabilities", () => {
  test("declares the Gemini CLI gaps explicitly", () => {
    const c = new GeminiRunner().capabilities;
    expect(c.effortControl).toBe(false);
    expect(c.addDirs).toBe(false);
    expect(c.disableTools).toBe(false);
    expect(c.fallbackModel).toBe(false);
    // Las que sí soporta:
    expect(c.sessionResume).toBe(true);
    expect(c.costTracking).toBe(true);
    expect(c.jsonStream).toBe(true);
  });
});
