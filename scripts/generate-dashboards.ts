#!/usr/bin/env bun
/**
 * Thin CLI wrapper. La lógica vive en src/core/scaffold/dashboards.ts.
 *
 * Uso:
 *   bun run scripts/generate-dashboards.ts
 *   bun run scripts/generate-dashboards.ts --force
 */
import { generateDashboards } from "../src/core/scaffold/dashboards.ts";

const force = process.argv.includes("--force");
const summary = await generateDashboards({ force });
console.log(
  `[dashboards] resumen: ${summary.created} creados, ${summary.skipped} skipped (de ${summary.total})`,
);
