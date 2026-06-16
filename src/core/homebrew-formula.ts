/**
 * Pure Homebrew-formula patcher used by `scripts/bump-homebrew-formula.ts` and
 * the `homebrew-bump` job in `.github/workflows/release.yml`.
 *
 * Why this exists: the previous `mislav/bump-homebrew-formula-action` is
 * single-platform — it only rewrites the one `sha256` whose `download-url` it is
 * handed, leaving the other three blocks pointing at stale checksums while the
 * `version` label moves forward. `brew install` then fails the checksum on every
 * platform but one. That bug shipped live from v0.2.4. This patches `version`
 * plus ALL four per-platform `sha256` lines atomically from a release's
 * SHA256SUMS, and throws on any gap — a half-patched formula is the failure mode
 * we are fixing, so partial success must be a hard error.
 */

/** Release asset filenames; each appears verbatim in exactly one `url` line. */
export const HOMEBREW_ASSETS = [
  "janus-macos-arm64",
  "janus-macos-x64",
  "janus-linux-arm64",
  "janus-linux-x64",
] as const;

/**
 * Parse `sha256sum` output (`<64-hex>  <filename>`, optionally `*<filename>` for
 * binary mode) into a filename → hash map. Lines that don't match are ignored.
 */
export function parseSha256Sums(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m) map.set(m[2]!.trim(), m[1]!.toLowerCase());
  }
  return map;
}

export interface BumpResult {
  formula: string;
  /** asset → sha256 actually written, for logging. */
  applied: Record<string, string>;
}

/**
 * Return a new formula string with `version` bumped and each platform's `sha256`
 * (the line immediately following its `url`) replaced from `sums`. A leading `v`
 * on `version` is stripped (`v0.2.8` → `0.2.8`). Throws if the version line, any
 * asset's `url` block, or any expected sum is missing.
 */
export function bumpFormula(
  formula: string,
  version: string,
  sums: Map<string, string>,
  assets: readonly string[] = HOMEBREW_ASSETS,
): BumpResult {
  const cleanVersion = version.replace(/^v/, "");
  if (!/^\s*version\s+"[^"]*"/m.test(formula)) {
    throw new Error('formula has no `version "..."` line');
  }
  let out = formula.replace(/^(\s*version\s+)"[^"]*"/m, `$1"${cleanVersion}"`);

  const lines = out.split("\n");
  const applied: Record<string, string> = {};
  for (const asset of assets) {
    const sha = sums.get(asset);
    if (!sha) throw new Error(`SHA256SUMS missing entry for ${asset}`);
    const urlIdx = lines.findIndex((l) => l.includes(`/${asset}"`));
    if (urlIdx === -1) throw new Error(`formula has no url line for ${asset}`);
    const shaIdx = lines.findIndex((l, i) => i > urlIdx && /^\s*sha256\s+"/.test(l));
    // The sha256 sits directly under its url; a far-away match means the block
    // for this asset is malformed and we'd patch the wrong platform.
    if (shaIdx === -1 || shaIdx > urlIdx + 3) {
      throw new Error(`formula has no sha256 line right after url for ${asset}`);
    }
    lines[shaIdx] = lines[shaIdx]!.replace(/sha256\s+"[^"]*"/, `sha256 "${sha}"`);
    applied[asset] = sha;
  }
  return { formula: lines.join("\n"), applied };
}
