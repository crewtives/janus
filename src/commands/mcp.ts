import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "mcp",
    description: "Launch the Janus MCP server (stdio). Connects Claude Code / Cursor / Codex as external agents.",
  },
  args: {},
  async run() {
    const { runMcpServer } = await import("../mcp/server.ts");
    await runMcpServer();
  },
});
