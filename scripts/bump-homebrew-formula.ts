#!/usr/bin/env bun
/**
 * Patch the Homebrew tap formula after a release: bump `version` and all four
 * per-platform `sha256` lines from the release's SHA256SUMS. Replaces the
 * single-platform `mislav/bump-homebrew-formula-action` wired before — see
 * `src/core/homebrew-formula.ts` for the why. Run by the `homebrew-bump` job in
 * `.github/workflows/release.yml`, but works locally too against a checked-out
 * tap (useful to re-bump a live formula left stale by the old action).
 *
 * Uso:
 *   bun run scripts/bump-homebrew-formula.ts \
 *     --version 0.2.8 --sums SHA256SUMS --formula tap/Formula/janus.rb
 */
import { readFile, writeFile } from "node:fs/promises";
import { bumpFormula, parseSha256Sums } from "../src/core/homebrew-formula.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const version = arg("version");
const sumsPath = arg("sums");
const formulaPath = arg("formula");
if (!version || !sumsPath || !formulaPath) {
  console.error(
    "usage: bump-homebrew-formula.ts --version <X> --sums <path> --formula <path>",
  );
  process.exit(1);
}

const sums = parseSha256Sums(await readFile(sumsPath, "utf-8"));
const formula = await readFile(formulaPath, "utf-8");
const { formula: patched, applied } = bumpFormula(formula, version, sums);
await writeFile(formulaPath, patched);

console.log(`[bump-homebrew] version → ${version.replace(/^v/, "")}`);
for (const [asset, sha] of Object.entries(applied)) {
  console.log(`[bump-homebrew] ${asset.padEnd(20)} ${sha}`);
}
