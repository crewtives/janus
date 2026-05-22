import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "quarterly",
    description: "Generate the Quarterly Retrospective by consolidating that quarter's monthlies",
  },
  args: {
    quarter: {
      type: "string",
      description: "Quarter in YYYY-QN format (Q1..Q4). Default: quarter before the current one.",
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { writeQuarterlyRetro, currentQuarterOf, previousQuarter } = await import("../core/aggregations.ts");
    const config = await loadConfig();
    const todayISO = new Date().toISOString().slice(0, 10);
    const quarter = (args.quarter as string | undefined) ?? previousQuarter(currentQuarterOf(todayISO));
    if (!/^\d{4}-Q[1-4]$/.test(quarter)) {
      throw new Error(`--quarter invalid: ${quarter} (expected YYYY-QN)`);
    }
    console.log(`[quarterly] generating retro for ${quarter}`);
    const r = await writeQuarterlyRetro({ vaultPath: config.obsidianVault, quarter, config });
    if (!r) {
      console.log(`[quarterly] no data for ${quarter}`);
      return;
    }
    console.log(`[quarterly] ✓ ${r.path}`);
    console.log(`[quarterly]   - ${r.monthsCovered} monthlies + ${r.weekliesUncovered} loose weeklies`);
    console.log(`[quarterly]   - ${r.tracksMaterialized} tracks materialized`);
  },
});
