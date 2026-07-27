# Janus MCP server

Janus exposes its synthesized content as an **MCP server** over stdio. From another Claude Code, Cursor, or Codex session, you can ask things like *"what did we do in Bar last week?"* and receive narrative with back-links — not raw logs.

## Launch it

```bash
bun janus mcp
```

Reads from stdin, writes to stdout (JSON-RPC 2.0 newline-delimited, MCP protocol `2024-11-05`). Logs to stderr.

## Connect it from Claude Code

Add to your `~/.claude/config.json` (or the MCP client's equivalent):

```json
{
  "mcpServers": {
    "janus": {
      "command": "bun",
      "args": ["run", "/Users/alice/projects/janus/bin/janus.ts", "mcp"]
    }
  }
}
```

After restarting Claude Code, the `janus_ask`, `janus_get_spine`, `janus_get_pulse`, `janus_list_projects` tools are available.

## Connect it from Codex CLI

Run `janus init` and accept **Install Janus automatic memory + MCP for Codex CLI**. Janus:

1. registers the `janus` MCP server with the exact config path selected by the wizard; and
2. adds an idempotent `SessionStart` hook in `$CODEX_HOME/hooks.json`.

On first use, Codex may ask you to trust the new hook. When a session starts inside a configured
`repoPath`, the hook resolves the most-specific tracked project and injects its spine. Outside all
tracked repositories it writes no stdout and adds no context. The MCP remains available for deeper
searches or as a manual fallback:

```text
Call janus_get_project_context with the current working directory, then use
janus_ask if the spine does not answer the question.
```

`janus doctor` checks that both the hook marker and the MCP registration exist. It cannot
pre-approve Codex's trust prompt.

## Exposed tools

### `janus_get_project_context(cwd)`

Resolves a canonical working directory against configured repositories. It returns the project
spine for a tracked repository, a recoverable `missing-spine` state, or only an `untracked`
discriminator. It never guesses from a sibling path with a shared prefix.

### `janus_ask(query, project?, kind?, since?, until?, limit?)`

FTS5 search over the vault. First-class filters. Returns results as narrative (snippets with highlights, score, back-link to `docId`).

**Example usage by an external agent:**
```
"What decisions were made in crewtives-janus last week?"
→ janus_ask({ query: "decision", project: "crewtives-janus", since: "2026-05-14", kind: "pulse" })
```

### `janus_get_spine(project)`

Returns the **project spine** — the project's continuous narrative note. The first thing a new agent should read when diving in.

### `janus_get_pulse(project, date)`

Returns the specific pulse. Looks in `pulse/` first, then `_archive/<YYYY-MM>/`.

### `janus_list_projects()`

Lists tracked projects with their status (active/paused/archived) and last-pulse date.

## When Janus vs when companion-agent

Both expose MCP. They are **complementary layers** of the "agent memory" stack — not competitors.

| Question | Right server | Why |
|---|---|---|
| "What did Claude tell me in the 2:30pm session about the OAuth bug?" | **companion-agent** | Raw memory — you need the text of the specific message. |
| "What did we do in project X this week?" | **Janus** | Synthesis — you want the arc, not the log. |
| "Show me the latest weekly of crewtives-acme." | **Janus** | Structured narrative (pulses, weeklies, spines). |
| "What tool calls did I make 5 minutes ago?" | **companion-agent** | Recent events, high granularity. |
| "What was the most referenced decision this year?" | **Janus** | Decision graph, aggregations. |
| "Spine of project Y." | **Janus** | Continuous narrative. |

**Quick rule:** if the question is about what **the system decided/produced**, use Janus. If it is about what **was discussed/attempted**, use companion-agent.

Future integration: companion-agent could ingest Janus's narrative as curated context for its own responses.

## Wire format (detail)

- Transport: stdio (stdin/stdout).
- Encoding: UTF-8.
- Framing: newline-delimited (one JSON message per line, terminated with `\n`).
- Protocol: JSON-RPC 2.0, MCP methods `initialize`, `tools/list`, `tools/call`, `ping`, and the `notifications/initialized` notification.
- Zero external dependencies — vanilla implementation in `src/mcp/server.ts` (~250 LOC).

Audit `src/mcp/server.ts` directly if you want to see the full handshake.

## Debugging

```bash
# Manual smoke test (no MCP client):
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | bun janus mcp
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | bun janus mcp
```

To see requests/responses live during a session, logs go to stderr — check the MCP client's logs.
