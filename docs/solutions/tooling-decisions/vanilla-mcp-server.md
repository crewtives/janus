---
title: Vanilla JSON-RPC MCP server — no SDK, no external dependencies
date: 2026-05-24
category: tooling-decisions
module: mcp/server
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - Adding a new MCP tool to Janus
  - Reviewing a PR that touches `src/mcp/server.ts`
  - Considering adding `@modelcontextprotocol/sdk` as a dependency
  - Debugging why Janus's MCP server behaves slightly differently than an SDK-based server
tags: [mcp, json-rpc, stdio, vanilla, zero-deps, dependency-discipline]
related_components: [mcp/server, core/search-index]
---

# Vanilla JSON-RPC MCP server — no SDK, no external dependencies

## Context
The MCP server (`src/mcp/server.ts`, ~361 LOC) exposes Janus as a stdio MCP server consumable from Claude Code, Cursor, Codex, etc. The implementation is hand-rolled JSON-RPC 2.0 over stdio with newline framing (NDJSON). It does NOT use `@modelcontextprotocol/sdk` or any other MCP framework. The decision was made explicitly when implementing Phase 1D.

## Guidance

### Rationale, in three bullets

1. **Zero external dependencies.** Adding the SDK would inflate `node_modules` and add a moving target (the SDK is still pre-1.0). Janus's MCP server has 4 tools; the framework overhead is not justified
2. **Full control of the wire format.** Janus owns the JSON-RPC framing, error codes, and serialization. A future protocol bump can be implemented in 30 minutes by reading the spec, not by tracking SDK releases
3. **Trivial to audit.** The whole server is one file, ~361 lines, no abstractions. A reviewer reads it top to bottom in 10 minutes

### The four tools

Defined as a flat array in `src/mcp/server.ts:75-...`:

| Tool | Purpose |
|---|---|
| `janus_ask(query, project?, kind?, since?, until?, limit?)` | FTS5 search over vault. Returns narrative with back-links, not raw logs |
| `janus_get_spine(project)` | Returns the project-spine markdown — the "Wikipedia page" of a project |
| `janus_get_pulse(project, date)` | Returns one specific pulse by `(project, date)`. Searches `pulse/` then `_archive/` |
| `janus_list_projects()` | Lists projects + status + last pulse date |

Each tool has a `ToolDefinition` (name, description, JSON schema for inputs) and a `ToolHandler` (async function). The `description` field is what the MCP client sees in its tool catalog; treat it as user-facing copy and keep it informative.

### Protocol shape

- Spec version: `"2024-11-05"` (constant at line 36)
- Server name: `"janus"`, version from `package.json` via Bun's JSON import attribute
- Wire framing: one JSON object per `\n`-terminated line on stdin/stdout
- stdout is reserved for protocol messages; stderr is reserved for logs
- Errors follow JSON-RPC 2.0 (`{ code, message, data? }`)

The `serverInfo.version` reads from `package.json`:

```ts
import pkg from "../../package.json" with { type: "json" };
const SERVER_VERSION = pkg.version;
```

This was added by `a74a71b fix(mcp): wire serverInfo.version to package.json` — earlier versions hardcoded the version string and drifted from `package.json`. Tests at `tests/mcp-server.test.ts` now assert version coherence.

### How to add a new tool

1. Define the `ToolDefinition` (name, description, inputSchema)
2. Define the `ToolHandler` (async function `(args, ctx) => Promise<ToolResult>`)
3. Add `{ def, handler }` to the `TOOLS` array
4. Add a test in `tests/mcp-server.test.ts` that exercises `tools/call` for the new tool

Do NOT extract a helper abstraction "to make adding tools easier". The flat array is intentional — every tool is visible in one place and reviewers see what the server exposes at a glance.

## Why This Matters
- Janus's dependency discipline (5 runtime deps) depends on rejecting frameworks where a hand-rolled implementation is small and stable
- The wire format never breaks under us — we control it
- An auditor or security reviewer can grep for `tools/call` and see every handler in 5 minutes
- The 0-deps shape means the MCP server compiles into the single-file binary trivially

## When to Apply
- Adding a new MCP tool: edit `TOOLS`, add a handler, add a test. Do not pull in the SDK
- Bumping the MCP spec version: read the spec, update `PROTOCOL_VERSION`, update any changed message shapes, add a regression test
- New JSON-RPC method (notifications, prompts, resources beyond tools): implement the handler in `handleRequest` directly. Resist the urge to extract a "method router" abstraction until there are 5+ methods of substantively different shape

## Examples

**Correct: add a new tool**
```ts
const TOOLS = [
  // ...existing
  {
    def: {
      name: "janus_get_track",
      description: "Return the materialized track file for a given slug.",
      inputSchema: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
    handler: async (args, ctx) => {
      const slug = String(args.slug);
      const path = join(ctx.config.obsidianVault, "MOCs", "Tracks", `${slug}.md`);
      const text = await Bun.file(path).text();
      return { content: [{ type: "text", text }] };
    },
  },
];
```

**Wrong: introducing the SDK**
```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
// + 30 lines of framework boilerplate, + ~2 MB of node_modules
```

## Related
- [Bun-native not Node](bun-native-not-node.md)
- `src/mcp/server.ts` — the whole server in one file
- `tests/mcp-server.test.ts` — pins the tool surface
- `docs/mcp.md` — user-facing MCP usage
- MCP spec: https://spec.modelcontextprotocol.io/
