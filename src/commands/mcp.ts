import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "mcp",
    description: "Launch the Janus MCP server (stdio). Connects Claude Code / Cursor / Codex as external agents.",
  },
  args: {
    config: {
      type: "string",
      description: "Absolute Janus config path selected during integration setup",
    },
  },
  async run({ args }) {
    const { runMcpServer } = await import("../mcp/server.ts");
    await runMcpServer({ configPath: args.config });
  },
});
