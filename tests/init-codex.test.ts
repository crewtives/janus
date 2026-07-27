import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexHookCommand,
  isCodexMcpMissing,
  codexMcpTransport,
  codexMcpArgs,
  installCodexHook,
  mergeCodexHooks,
  removeCodexHooks,
  resolveJanusCommandSpec,
} from "../src/core/init/codex.ts";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("Codex integration setup", () => {
  test("resolves source and compiled Janus commands", () => {
    expect(resolveJanusCommandSpec({
      execPath: "/opt/bin/bun",
      main: "/work/janus/bin/janus.ts",
      repoRoot: "/work/janus",
    })).toEqual({
      command: "/opt/bin/bun",
      args: ["run", "/work/janus/bin/janus.ts"],
    });
    expect(resolveJanusCommandSpec({
      execPath: "/opt/bin/janus",
      main: "/opt/bin/janus",
      repoRoot: "/unused",
    })).toEqual({ command: "/opt/bin/janus", args: [] });
  });

  test("quotes adversarial paths in the hook command", () => {
    const command = codexHookCommand(
      { command: "/tmp/a b/janus", args: ["it's-safe"] },
      "/tmp/config $value.json",
    );
    expect(command).toContain(`'/tmp/a b/janus'`);
    expect(command).toContain(`'it'\"'\"'s-safe'`);
    expect(command).toEndWith("# crewtives-janus");
  });

  test("merges one stable SessionStart hook and preserves unrelated entries", () => {
    const existing = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
      },
      custom: true,
    };
    const first = mergeCodexHooks(existing, "'janus' 'context' # crewtives-janus");
    expect(first.changed).toBe(true);
    expect(first.document.custom).toBe(true);
    expect(first.document.hooks?.Stop).toHaveLength(1);
    const second = mergeCodexHooks(first.document, "'janus' 'context' # crewtives-janus");
    expect(second.changed).toBe(false);
    expect(second.document.hooks?.SessionStart).toHaveLength(1);
  });

  test("normalizes one Janus hook and removes duplicate marked entries", () => {
    const command = "'janus' 'context' # crewtives-janus";
    const merged = mergeCodexHooks({
      hooks: {
        SessionStart: [{
          hooks: [
            { type: "command", command, timeout: 10 },
            { type: "command", command: "echo unrelated" },
            { type: "command", command: "'old' # crewtives-janus" },
          ],
        }],
      },
    }, command);
    const hooks = merged.document.hooks?.SessionStart?.[0]?.hooks ?? [];
    expect(hooks.filter((hook) => hook.command.includes("crewtives-janus"))).toHaveLength(1);
    expect(hooks.find((hook) => hook.command === command)?.statusMessage).toBe(
      "Loading Janus project memory",
    );
    expect(hooks.some((hook) => hook.command === "echo unrelated")).toBe(true);
  });

  test("removes only Janus-owned hooks when integration is disabled", () => {
    const cleaned = removeCodexHooks({
      hooks: {
        SessionStart: [{
          hooks: [
            { type: "command", command: "echo keep" },
            { type: "command", command: "janus context # crewtives-janus" },
          ],
        }],
        Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
      },
    });
    expect(cleaned.changed).toBe(true);
    expect(cleaned.document.hooks?.SessionStart?.[0]?.hooks).toEqual([
      { type: "command", command: "echo keep" },
    ]);
    expect(cleaned.document.hooks?.Stop).toHaveLength(1);
  });

  test("writes hook configuration idempotently", async () => {
    root = await mkdtemp(join(tmpdir(), "janus-init-codex-"));
    const spec = { command: "/opt/bin/janus", args: [] };
    const first = await installCodexHook({ codexHome: root, configPath: "/tmp/config.json", commandSpec: spec });
    const before = await readFile(first.path, "utf-8");
    const second = await installCodexHook({ codexHome: root, configPath: "/tmp/config.json", commandSpec: spec });
    expect(second.changed).toBe(false);
    expect(await readFile(first.path, "utf-8")).toBe(before);
  });

  test("builds an argv-safe MCP registration", () => {
    expect(codexMcpArgs({ command: "/opt/bin/janus", args: [] }, "/tmp/config.json")).toEqual([
      "mcp", "add", "janus", "--", "/opt/bin/janus", "mcp", "--config", "/tmp/config.json",
    ]);
  });

  test("reads Codex's nested stdio MCP transport", () => {
    expect(codexMcpTransport({
      name: "janus",
      transport: { type: "stdio", command: "/opt/bin/janus", args: ["mcp"] },
    })).toEqual({ type: "stdio", command: "/opt/bin/janus", args: ["mcp"] });
    expect(codexMcpTransport({ command: "/opt/bin/janus" })).toBeNull();
  });

  test("distinguishes a missing MCP server from a failed Codex command", () => {
    expect(isCodexMcpMissing("MCP server 'janus' not found")).toBe(true);
    expect(isCodexMcpMissing("codex: command not found")).toBe(false);
    expect(isCodexMcpMissing("request timed out")).toBe(false);
  });
});
