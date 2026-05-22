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
  },
  async run({ args }) {
    const { runRollup } = await import("../pipeline/rollup-runner.ts");
    await runRollup({
      week: args.week,
      days: args.days,
      endDate: args["end-date"],
    });
  },
});
