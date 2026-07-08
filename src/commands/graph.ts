import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "graph",
    description:
      "Write .obsidian/graph.json: per-project color clusters + bright hubs, preserving your display tuning",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Show what would be written without touching graph.json",
      default: false,
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { writeGraphConfig } = await import("../core/graph-config.ts");
    const config = await loadConfig();
    const r = await writeGraphConfig({ config, dryRun: args["dry-run"] });
    if (r.wrote) {
      console.log(`[graph] ✓ ${r.path} · ${r.projectGroups} color groups + bright overlay`);
    }
  },
});
