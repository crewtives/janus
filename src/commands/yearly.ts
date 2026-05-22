import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "yearly",
    description: "Generate the Yearly Retrospective by consolidating the 4 quarterlies of the year",
  },
  args: {
    year: {
      type: "string",
      description: "Year (YYYY). Default: year before the current one.",
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { writeYearlyRetro } = await import("../core/aggregations.ts");
    const config = await loadConfig();
    const year = (args.year as string | undefined) ?? String(new Date().getFullYear() - 1);
    if (!/^\d{4}$/.test(year)) {
      throw new Error(`--year invalid: ${year} (expected YYYY)`);
    }
    console.log(`[yearly] generating retro for ${year}`);
    const r = await writeYearlyRetro({ vaultPath: config.obsidianVault, year, config });
    if (!r) {
      console.log(`[yearly] no quarterlies for ${year} — run 'janus quarterly' first`);
      return;
    }
    console.log(`[yearly] ✓ ${r.path}`);
    console.log(`[yearly]   - ${r.quartersCovered} quarterlies consolidated`);
    console.log(`[yearly]   - ${r.tracksMaterialized} tracks materialized`);
  },
});
