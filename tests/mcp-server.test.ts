import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { JanusConfig } from "../src/config/types.ts";
import { handleRequest, TOOLS, type ServerContext } from "../src/mcp/server.ts";
import pkg from "../package.json" with { type: "json" };

let tmpRoot: string;
let ctx: ServerContext;

beforeEach(async () => {
  tmpRoot = join(tmpdir(), `janus-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const vaultPath = join(tmpRoot, "vault");
  const projAbs = join(vaultPath, "Projects", "demo");
  await mkdir(join(projAbs, "pulse"), { recursive: true });
  await writeFile(
    join(projAbs, "pulse", "2026-05-21-demo.md"),
    `---\ndate: 2026-05-21\nproject: demo\nstatus: on-track\n---\n\n## TL;DR\n\n> [!summary]+\n> Día de prueba.\n`,
  );
  await writeFile(
    join(projAbs, "demo-spine.md"),
    `---\ntype: project-spine\nproject: demo\n---\n\n# demo Spine\n\nProyecto de prueba.\n`,
  );

  const stateDir = join(tmpRoot, ".janus");
  await mkdir(stateDir, { recursive: true });

  const config: JanusConfig = {
    obsidianVault: vaultPath,
    projects: [
      { name: "demo", repoPath: join(tmpRoot, "repo-demo"), obsidianPath: projAbs, status: "active" },
    ],
    stateDir,
    concurrency: 2,
    intervalCap: 5,
    intervalMs: 60_000,
    taskTimeoutMs: 30 * 60_000,
    model: "sonnet",
    effort: "xhigh",
    provider: "claude-code",
  };
  await mkdir(config.projects[0]!.repoPath, { recursive: true });
  ctx = { config };
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("MCP server protocol", () => {
  test("initialize returns protocolVersion, serverInfo, and startup instructions", async () => {
    const resp = await handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, ctx);
    expect(resp).not.toBeNull();
    expect(resp!.result).toBeDefined();
    const r = resp!.result as { protocolVersion: string; serverInfo: { name: string; version: string }; instructions: string };
    expect(r.protocolVersion).toBe("2024-11-05");
    expect(r.serverInfo.name).toBe("janus");
    // Version must track package.json so `janus mcp` reports the real release,
    // not a hardcoded literal that drifts across bumps.
    expect(r.serverInfo.version).toBe(pkg.version);
    expect(r.instructions).toContain("janus_get_project_context");
    expect(r.instructions).toContain("working directory");
  });

  test("notifications/initialized → no response", async () => {
    const resp = await handleRequest({ jsonrpc: "2.0", id: null, method: "notifications/initialized" }, ctx);
    expect(resp).toBeNull();
  });

  test("tools/list returns the 5 tools with schema", async () => {
    const resp = await handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx);
    expect(resp).not.toBeNull();
    const result = resp!.result as { tools: Array<{ name: string; inputSchema: object }> };
    expect(result.tools).toHaveLength(5);
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("janus_ask");
    expect(names).toContain("janus_get_spine");
    expect(names).toContain("janus_get_pulse");
    expect(names).toContain("janus_list_projects");
    expect(names).toContain("janus_get_project_context");
    for (const t of result.tools) {
      expect(t.inputSchema).toBeDefined();
    }
  });

  test("unknown method → error -32601", async () => {
    const resp = await handleRequest({ jsonrpc: "2.0", id: 3, method: "bogus" }, ctx);
    expect(resp).not.toBeNull();
    expect(resp!.error?.code).toBe(-32601);
  });

  test("ping responds {}", async () => {
    const resp = await handleRequest({ jsonrpc: "2.0", id: 4, method: "ping" }, ctx);
    expect(resp?.result).toEqual({});
  });
});

describe("MCP tools", () => {
  test("janus_get_project_context resolves the current tracked repository", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "janus_get_project_context", arguments: { cwd: ctx.config.projects[0]!.repoPath } },
      },
      ctx,
    );
    const r = resp!.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]!.text)).toMatchObject({
      tracked: true,
      state: "ready",
      project: "demo",
    });
  });

  test("janus_get_project_context is a private no-op outside configured repositories", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "janus_get_project_context", arguments: { cwd: tmpRoot } },
      },
      ctx,
    );
    const r = resp!.result as { content: Array<{ text: string }> };
    expect(JSON.parse(r.content[0]!.text)).toEqual({ tracked: false, state: "untracked" });
    expect(r.content[0]!.text).not.toContain("demo");
  });

  test("janus_list_projects returns the projects from the config", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "janus_list_projects", arguments: {} },
      },
      ctx,
    );
    expect(resp?.result).toBeDefined();
    const r = resp!.result as { content: Array<{ text: string }> };
    expect(r.content[0]?.text).toContain("demo");
    expect(r.content[0]?.text).toContain("2026-05-21"); // último pulse
  });

  test("janus_get_pulse returns the pulse content", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "janus_get_pulse", arguments: { project: "demo", date: "2026-05-21" } },
      },
      ctx,
    );
    const r = resp!.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(r.isError).toBeUndefined();
    expect(r.content[0]?.text).toContain("Día de prueba");
  });

  test("janus_get_pulse with non-existent date → isError true", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "janus_get_pulse", arguments: { project: "demo", date: "2099-01-01" } },
      },
      ctx,
    );
    const r = resp!.result as { content: Array<{ text: string }>; isError: boolean };
    expect(r.isError).toBe(true);
  });

  test("janus_get_spine returns the project's spine", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "janus_get_spine", arguments: { project: "demo" } },
      },
      ctx,
    );
    const r = resp!.result as { content: Array<{ text: string }> };
    expect(r.content[0]?.text).toContain("demo Spine");
  });

  test("janus_get_spine with non-existent project → isError true", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "janus_get_spine", arguments: { project: "no-existe" } },
      },
      ctx,
    );
    const r = resp!.result as { content: Array<{ text: string }>; isError: boolean };
    expect(r.isError).toBe(true);
  });

  test("janus_ask with empty FTS5 → no-results message (not an error)", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "janus_ask", arguments: { query: "queryqueguaranteenotfound1234" } },
      },
      ctx,
    );
    const r = resp!.result as { content: Array<{ text: string }> };
    expect(r.content[0]?.text).toContain("No results");
  });

  test("unknown tool → error -32602", async () => {
    const resp = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "janus_bogus", arguments: {} },
      },
      ctx,
    );
    expect(resp!.error?.code).toBe(-32602);
  });
});

describe("MCP tool definitions", () => {
  test("all tools have description and a valid inputSchema", () => {
    for (const t of TOOLS) {
      expect(t.def.name).toBeString();
      expect(t.def.description.length).toBeGreaterThan(20);
      expect(t.def.inputSchema).toMatchObject({ type: "object" });
    }
  });
});
