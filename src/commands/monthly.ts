import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "monthly",
    description: "Generate the Monthly Digest for a month (YYYY-MM) and archive that month's pulses",
  },
  args: {
    month: {
      type: "string",
      description: "Month in YYYY-MM format. Default: month before today.",
    },
    "skip-archive": {
      type: "boolean",
      description: "Don't move pulses to _archive/ (useful for regenerating the monthly without touching files)",
      default: false,
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { writeMonthlyDigest } = await import("../core/monthly.ts");
    const config = await loadConfig();
    const month = (args.month as string | undefined) ?? defaultMonth();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new Error(`--month invalid: ${month} (expected YYYY-MM)`);
    }
    console.log(`[monthly] generating digest for ${month}`);
    const r = await writeMonthlyDigest({
      vaultPath: config.obsidianVault,
      month,
      config,
      skipArchive: args["skip-archive"] as boolean,
    });
    if (!r) {
      console.log(`[monthly] nothing generated (no dailys/weeklies in ${month})`);
      return;
    }
    console.log(`[monthly] ✓ ${r.path}`);
    console.log(`[monthly]   - ${r.weekliesUsed} weeklies + ${r.daysProcessed} dailys processed`);
    console.log(`[monthly]   - ${r.tracksMaterialized} tracks materialized`);
    if (!args["skip-archive"]) {
      console.log(`[monthly]   - ${r.pulsesArchived} pulses archived to _archive/${month}/`);
    }
  },
});

function defaultMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
