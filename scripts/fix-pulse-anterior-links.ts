#!/usr/bin/env bun
/**
 * Thin CLI wrapper. La lógica vive en src/core/scaffold/fix-related.ts.
 *
 * Uso:
 *   bun run scripts/fix-pulse-anterior-links.ts            # repara y reporta
 *   bun run scripts/fix-pulse-anterior-links.ts --dry-run  # solo reporta
 *   bun run scripts/fix-pulse-anterior-links.ts --project NAME
 */
import { fixAllRelated } from "../src/core/scaffold/fix-related.ts";

// Re-export para tests que ya importan desde este path.
export { fixRelatedSection } from "../src/core/scaffold/fix-related.ts";

interface CliArgs {
  dryRun: boolean;
  project: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let dryRun = false;
  let project: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--project") project = args[++i] ?? null;
  }
  return { dryRun, project };
}

if (import.meta.main) {
  const args = parseArgs();
  const result = await fixAllRelated({ dryRun: args.dryRun, projectFilter: args.project });
  console.log(
    `[fix-prev] ${args.dryRun ? "DRY-RUN" : "ejecutando"} sobre ${result.perProject.length} proyectos`,
  );
  console.log("");
  for (const { project, result: r } of result.perProject) {
    if (r.scanned === 0) {
      console.log(`  ${project}: sin pulses`);
      continue;
    }
    const tag = r.changed > 0 ? (args.dryRun ? "would fix" : "fixed") : "OK";
    console.log(`  ${project}: ${r.scanned} pulses · ${tag} ${r.changed}`);
    for (const res of r.results.filter((x) => x.changed)) {
      console.log(`    · ${res.pulseFile} → ${res.reason}`);
    }
  }
  console.log("");
  console.log(
    `[fix-prev] ${args.dryRun ? "would-fix" : "fixed"} ${result.totalChanged}/${result.totalScanned} pulses`,
  );
}
