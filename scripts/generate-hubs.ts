#!/usr/bin/env bun
/**
 * Thin CLI wrapper. La lógica vive en src/core/scaffold/hubs.ts y se
 * llama in-process desde el orchestrator (el binario compilado no tiene
 * acceso al filesystem `scripts/`).
 *
 * Uso:
 *   bun run scripts/generate-hubs.ts
 *   bun run scripts/generate-hubs.ts --force   # sobreescribe los existentes
 */
import { generateHubs } from "../src/core/scaffold/hubs.ts";

const force = process.argv.includes("--force");
const summary = await generateHubs({ force });
console.log(
  `[hubs] resumen: ${summary.created} creados, ${summary.skipped} skipped (de ${summary.total})`,
);
