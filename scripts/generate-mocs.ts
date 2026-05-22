#!/usr/bin/env bun
/**
 * Thin CLI wrapper. La lógica vive en src/core/scaffold/mocs.ts.
 *
 * Uso:
 *   bun run scripts/generate-mocs.ts
 *   bun run scripts/generate-mocs.ts --force
 */
import { generateMocs } from "../src/core/scaffold/mocs.ts";

const force = process.argv.includes("--force");
const summary = await generateMocs({ force });
console.log(
  `[mocs] resumen: ${summary.created} creados, ${summary.skipped} skipped (de ${summary.total})`,
);
