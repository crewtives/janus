import { loadConfig } from "../config/loader.ts";
import { writeWeeklyRollup } from "../core/weekly.ts";

export interface RunRollupOptions {
  week?: boolean | undefined;
  days?: string | undefined;
  endDate?: string | undefined;
}

export async function runRollup(opts: RunRollupOptions): Promise<void> {
  const config = await loadConfig();

  const days = opts.week ? 7 : opts.days ? parseInt(opts.days, 10) : 7;
  if (isNaN(days) || days < 1 || days > 60) {
    throw new Error(`--days invalid: ${opts.days} (1-60)`);
  }

  const endDate = opts.endDate ?? yesterdayLocal();
  const endD = new Date(`${endDate}T00:00:00`);
  const startD = new Date(endD);
  startD.setDate(startD.getDate() - (days - 1));
  const startDate = formatDate(startD);

  console.log(`[rollup] generating rollup of ${days} days: ${startDate} → ${endDate}`);

  const result = await writeWeeklyRollup({
    vaultPath: config.obsidianVault,
    startDate,
    endDate,
    config,
    projectNames: config.projects.map((p) => p.name),
  });

  if (result) {
    console.log(`[rollup] ✓ ${result.path} (${result.daysWithData} days with data)`);
  } else {
    console.log(`[rollup] nothing generated (no daily rollups in that period)`);
  }
}

function yesterdayLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDate(d);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
