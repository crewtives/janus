/**
 * Janus MCP server — Phase 1D.
 *
 * Implementación vanilla del protocolo MCP (Model Context Protocol) sobre
 * stdio. JSON-RPC 2.0 con framing newline-delimited (NDJSON), spec MCP
 * 2024-11-05 / 2025-06-18.
 *
 * Por qué vanilla en vez de `@modelcontextprotocol/sdk`:
 *  - 0 dependencias adicionales (Janus se mantiene liviano).
 *  - Control total del wire format.
 *  - Trivial de auditar para un servidor con 4 tools.
 *
 * Tools expuestos:
 *  - janus_ask         — FTS5 search sobre el vault, filtros tipados.
 *  - janus_get_spine   — devuelve el project-spine de un proyecto.
 *  - janus_get_pulse   — devuelve un pulse concreto por (project, date).
 *  - janus_list_projects — proyectos + status + último pulse.
 *
 * Uso desde la CLI: `bun janus mcp` (corre el server hasta que el cliente
 * cierra el stdio).
 *
 * Wire format:
 *  Cada mensaje JSON-RPC termina con `\n`. Stdout reservado para mensajes
 *  protocolares. Stderr para logs.
 */
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config/loader.ts";
import type { JanusConfig, ProjectConfig } from "../config/types.ts";
import { SearchIndex, type DocKind } from "../core/search-index.ts";

// ─── Protocol types ──────────────────────────────────────────────────────

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "janus";
const SERVER_VERSION = "0.2.0";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ToolHandler {
  (args: Record<string, unknown>, ctx: ServerContext): Promise<ToolResult>;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface ServerContext {
  config: JanusConfig;
}

// ─── Tools ────────────────────────────────────────────────────────────────

const TOOLS: Array<{ def: ToolDefinition; handler: ToolHandler }> = [
  {
    def: {
      name: "janus_ask",
      description: "Full-text search (FTS5) across your Obsidian vault: pulses, weeklies, monthlies, spines, ADRs. Returns synthesized narrative with back-links — not raw logs. Use it when you want to know 'what happened with X during period Y'. Complementary to companion-agent (which serves raw session memory).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "FTS5 query. Space=implicit AND, OR explicit, phrase between double quotes." },
          project: { type: "string", description: "Filter by exact project name (optional)." },
          kind: {
            type: "string",
            description: "Doc kind: pulse, daily, weekly, monthly, quarterly, yearly, track, index, adr, spine. Comma-separated for multiple. Optional.",
          },
          since: { type: "string", description: "Minimum date YYYY-MM-DD (optional)." },
          until: { type: "string", description: "Maximum date YYYY-MM-DD (optional)." },
          limit: { type: "number", description: "Max number of results (default 10).", default: 10 },
        },
        required: ["query"],
      },
    },
    handler: async (args, ctx) => {
      const query = String(args.query ?? "");
      if (!query.trim()) {
        return errorResult("query is required and must be non-empty");
      }
      const idx = SearchIndex.open(ctx.config.stateDir!);
      const kindArg = args.kind ? String(args.kind) : undefined;
      const kinds = kindArg
        ? (kindArg.split(",").map((k) => k.trim()).filter(Boolean) as DocKind[])
        : undefined;
      const hits = idx.search({
        query,
        project: args.project ? String(args.project) : undefined,
        kind: kinds,
        since: args.since ? String(args.since) : undefined,
        until: args.until ? String(args.until) : undefined,
        limit: typeof args.limit === "number" ? args.limit : 10,
      });
      idx.close();

      if (hits.length === 0) {
        return textResult("No results for that query.");
      }
      // Output as narrative with explicit back-links.
      const lines: string[] = [];
      lines.push(`${hits.length} result(s) for \`${query}\`:`);
      lines.push("");
      for (const h of hits) {
        const projTag = h.project ? `[${h.project}] ` : "";
        const kindTag = `(${h.kind})`;
        lines.push(`### ${h.date} ${kindTag} ${projTag}${h.title}`);
        lines.push(`${h.snippet}`);
        lines.push(`Source: \`${h.docId}\` · score=${h.score.toFixed(2)}`);
        lines.push("");
      }
      return textResult(lines.join("\n"));
    },
  },
  {
    def: {
      name: "janus_get_spine",
      description: "Returns the Project Spine of a project — the continuous narrative note that serves as the project's 'Wikipedia page'. The first thing an agent should read when diving into a project.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project name (must be in config)." },
        },
        required: ["project"],
      },
    },
    handler: async (args, ctx) => {
      const project = String(args.project ?? "");
      const proj = ctx.config.projects.find((p) => p.name === project);
      if (!proj) return errorResult(`Project ${project} is not in config. Available: ${ctx.config.projects.map((p) => p.name).join(", ")}`);
      const spinePath = join(proj.obsidianPath, `${proj.name}-spine.md`);
      if (!existsSync(spinePath)) {
        return errorResult(`No spine generated for ${project} yet. Generate one with \`bun janus spine --project ${project}\`.`);
      }
      const content = await readFile(spinePath, "utf-8");
      return textResult(content);
    },
  },
  {
    def: {
      name: "janus_get_pulse",
      description: "Returns a specific pulse for a project on a specific date.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project name." },
          date: { type: "string", description: "Date YYYY-MM-DD." },
        },
        required: ["project", "date"],
      },
    },
    handler: async (args, ctx) => {
      const project = String(args.project ?? "");
      const date = String(args.date ?? "");
      const proj = ctx.config.projects.find((p) => p.name === project);
      if (!proj) return errorResult(`Project ${project} is not in config.`);
      const filename = `${date}-${project}.md`;
      // Look in pulse/ first, then _archive/.
      const direct = join(proj.obsidianPath, "pulse", filename);
      if (existsSync(direct)) {
        return textResult(await readFile(direct, "utf-8"));
      }
      const archiveRoot = join(proj.obsidianPath, "_archive");
      if (existsSync(archiveRoot)) {
        const months = await readdir(archiveRoot);
        for (const month of months) {
          const candidate = join(archiveRoot, month, filename);
          if (existsSync(candidate)) {
            return textResult(await readFile(candidate, "utf-8"));
          }
        }
      }
      return errorResult(`Pulse not found: ${project} on ${date}.`);
    },
  },
  {
    def: {
      name: "janus_list_projects",
      description: "Lists all projects tracked by Janus with their status and last pulse date.",
      inputSchema: { type: "object", properties: {} },
    },
    handler: async (_args, ctx) => {
      const rows: string[] = [];
      rows.push(`Janus está trackeando ${ctx.config.projects.length} proyecto(s):`);
      rows.push("");
      for (const p of ctx.config.projects) {
        const last = await lastPulseDate(p);
        const status = p.status ?? "active";
        rows.push(`- **${p.name}** · status=${status} · último pulse: ${last ?? "(ninguno)"}`);
      }
      return textResult(rows.join("\n"));
    },
  },
];

async function lastPulseDate(project: ProjectConfig): Promise<string | null> {
  const pulseDir = join(project.obsidianPath, "pulse");
  if (!existsSync(pulseDir)) return null;
  try {
    const entries = await readdir(pulseDir);
    const dates: string[] = [];
    for (const name of entries) {
      const m = name.match(/^(\d{4}-\d{2}-\d{2})-/);
      if (m && m[1]) dates.push(m[1]);
    }
    dates.sort();
    return dates.at(-1) ?? null;
  } catch {
    return null;
  }
}

// ─── Protocol handlers ───────────────────────────────────────────────────

async function handleRequest(req: JsonRpcRequest, ctx: ServerContext): Promise<JsonRpcResponse | null> {
  // Notifications (sin id) no requieren respuesta.
  const isNotification = req.id === null || req.id === undefined;

  try {
    if (req.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: req.id ?? null,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      };
    }

    if (req.method === "initialized" || req.method === "notifications/initialized") {
      // Notification — no response.
      return null;
    }

    if (req.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id: req.id ?? null,
        result: { tools: TOOLS.map((t) => t.def) },
      };
    }

    if (req.method === "tools/call") {
      const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      const toolName = params?.name;
      const tool = TOOLS.find((t) => t.def.name === toolName);
      if (!tool) {
        return {
          jsonrpc: "2.0",
          id: req.id ?? null,
          error: { code: -32602, message: `Tool desconocido: ${toolName}` },
        };
      }
      const result = await tool.handler(params?.arguments ?? {}, ctx);
      return {
        jsonrpc: "2.0",
        id: req.id ?? null,
        result,
      };
    }

    if (req.method === "ping") {
      return { jsonrpc: "2.0", id: req.id ?? null, result: {} };
    }

    if (isNotification) return null;
    return {
      jsonrpc: "2.0",
      id: req.id ?? null,
      error: { code: -32601, message: `Método desconocido: ${req.method}` },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isNotification) return null;
    return {
      jsonrpc: "2.0",
      id: req.id ?? null,
      error: { code: -32603, message: `Internal error: ${message}` },
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

// ─── Entry point ─────────────────────────────────────────────────────────

export async function runMcpServer(opts?: { stat?: typeof stat }): Promise<void> {
  // stat se usa para evitar reasonable arg deps en tests; default = node:fs/promises
  void opts?.stat;

  const config = await loadConfig();
  const ctx: ServerContext = { config };

  process.stderr.write(`[janus-mcp] server starting · protocol=${PROTOCOL_VERSION} · ${TOOLS.length} tools\n`);

  // Lectura newline-delimited de stdin.
  let buffer = "";
  process.stdin.setEncoding("utf-8");

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(line) as JsonRpcRequest;
      } catch (err) {
        process.stderr.write(`[janus-mcp] parse error: ${err instanceof Error ? err.message : String(err)}\n`);
        continue;
      }
      void handleRequest(req, ctx).then((resp) => {
        if (resp) {
          process.stdout.write(JSON.stringify(resp) + "\n");
        }
      });
    }
  });

  process.stdin.on("end", () => {
    process.stderr.write(`[janus-mcp] stdin closed, exiting\n`);
    process.exit(0);
  });

  // Mantener el proceso vivo hasta que stdin cierre.
  await new Promise<void>(() => {});
}

// Exports para testing
export { handleRequest, TOOLS, type ToolResult, type JsonRpcRequest, type JsonRpcResponse, type ServerContext };
