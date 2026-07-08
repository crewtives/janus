import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "rollup",
    description: "Generate weekly (or N-day) cross-project activity rollups",
  },
  args: {
    week: {
      type: "boolean",
      description: "Rollup of the last week (7 days ending yesterday)",
      default: false,
    },
    days: {
      type: "string",
      description: "Number of days (e.g. 14)",
    },
    "end-date": {
      type: "string",
      description: "End date of the range (YYYY-MM-DD). Default: yesterday.",
    },
    backfill: {
      type: "boolean",
      description: "Regenerate missing historical weeklies over a range (requires --since)",
      default: false,
    },
    since: {
      type: "string",
      description: "Backfill start date (YYYY-MM-DD). Enumerates Sunday-ending weeks from here.",
    },
    "skip-spines": {
      type: "boolean",
      description: "During --backfill, skip project-spine regeneration (the dominant cost)",
      default: false,
    },
  },
  async run({ args }) {
    // Backfill mode is cost-aware: it can fire ~1 LLM pass per project per week,
    // so it requires an explicit --since range rather than a silent default.
    if (args.backfill || args.since) {
      const since = args.since;
      if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        throw new Error("--backfill requires --since YYYY-MM-DD");
      }
      const { backfillWeeklies } = await import("../pipeline/rollup-runner.ts");
      await backfillWeeklies({ since, skipSpines: args["skip-spines"] });
      return;
    }

    const { runRollup } = await import("../pipeline/rollup-runner.ts");
    await runRollup({
      week: args.week,
      days: args.days,
      endDate: args["end-date"],
    });
  },
});
