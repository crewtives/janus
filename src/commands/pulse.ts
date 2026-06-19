import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "pulse",
    description: "Generate the daily pulse for each configured project",
  },
  args: {
    backfill: {
      type: "string",
      description: "Backfill from N days ago (e.g. 7d)",
    },
    project: {
      type: "string",
      description: "Process only a specific project",
    },
    since: {
      type: "string",
      description: "Start date (YYYY-MM-DD)",
    },
    date: {
      type: "string",
      description: "Process exactly this date (YYYY-MM-DD), ignoring since/backfill",
    },
    "dry-run": {
      type: "boolean",
      description: "Write nothing, just show what would happen",
      default: false,
    },
    force: {
      type: "boolean",
      description: "Reprocess even if already done (overrides idempotency)",
      default: false,
    },
  },
  async run({ args }) {
    const { runPulse } = await import("../pipeline/orchestrator.ts");
    await runPulse({
      backfill: args.backfill,
      project: args.project,
      since: args.since,
      date: args.date,
      dryRun: args["dry-run"],
      force: args.force,
    });
  },
});
