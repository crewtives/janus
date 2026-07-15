import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "retry",
    description: "Reprocess failed tasks from .janus/failed.jsonl",
  },
  args: {
    from: {
      type: "string",
      description: "Path to the dead-letter file (default: .janus/failed.jsonl)",
      default: ".janus/failed.jsonl",
    },
    force: {
      type: "boolean",
      description: "Reprocess entries already marked done (overwrites their pulse)",
      default: false,
    },
  },
  async run({ args }) {
    const { runRetry } = await import("../pipeline/orchestrator.ts");
    await runRetry({ from: args.from, force: args.force });
  },
});
