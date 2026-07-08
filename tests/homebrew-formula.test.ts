import { describe, expect, test } from "bun:test";
import {
  HOMEBREW_ASSETS,
  bumpFormula,
  parseSha256Sums,
} from "../src/core/homebrew-formula.ts";

const FORMULA = `class Janus < Formula
  desc "Personal historian for makers"
  homepage "https://github.com/crewtives/janus"
  version "0.2.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/crewtives/janus/releases/download/v#{version}/janus-macos-arm64"
      sha256 "OLD_macos_arm64"
    end
    on_intel do
      url "https://github.com/crewtives/janus/releases/download/v#{version}/janus-macos-x64"
      sha256 "OLD_macos_x64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/crewtives/janus/releases/download/v#{version}/janus-linux-arm64"
      sha256 "OLD_linux_arm64"
    end
    on_intel do
      url "https://github.com/crewtives/janus/releases/download/v#{version}/janus-linux-x64"
      sha256 "OLD_linux_x64"
    end
  end
end
`;

const SHA = {
  "janus-macos-arm64": "a".repeat(64),
  "janus-macos-x64": "b".repeat(64),
  "janus-linux-arm64": "c".repeat(64),
  "janus-linux-x64": "d".repeat(64),
} as const;

function sumsFile(): string {
  // Real `sha256sum` order is arbitrary; mix it up to prove mapping is by name.
  return [
    `${SHA["janus-linux-x64"]}  janus-linux-x64`,
    `${SHA["janus-macos-arm64"]}  janus-macos-arm64`,
    `${SHA["janus-linux-arm64"]} *janus-linux-arm64`,
    `${SHA["janus-macos-x64"]}  janus-macos-x64`,
    "",
  ].join("\n");
}

/** Independent check: the sha256 line right under an asset's url. */
function shaUnderUrl(formula: string, asset: string): string {
  const lines = formula.split("\n");
  const i = lines.findIndex((l) => l.includes(`/${asset}"`));
  const m = lines[i + 1]!.match(/sha256 "([^"]+)"/);
  return m![1]!;
}

describe("parseSha256Sums", () => {
  test("maps filename → hash, tolerates binary marker and whitespace", () => {
    const map = parseSha256Sums(sumsFile());
    expect(map.size).toBe(4);
    expect(map.get("janus-macos-arm64")).toBe(SHA["janus-macos-arm64"]);
    expect(map.get("janus-linux-arm64")).toBe(SHA["janus-linux-arm64"]); // had `*`
  });

  test("ignores non-matching lines", () => {
    const map = parseSha256Sums("not a checksum line\n# comment\n");
    expect(map.size).toBe(0);
  });
});

describe("bumpFormula", () => {
  test("bumps version and maps each sha256 to the correct platform block", () => {
    const { formula, applied } = bumpFormula(FORMULA, "0.2.8", parseSha256Sums(sumsFile()));

    expect(formula).toContain('version "0.2.8"');
    for (const asset of HOMEBREW_ASSETS) {
      expect(shaUnderUrl(formula, asset)).toBe(SHA[asset]);
      expect(applied[asset]).toBe(SHA[asset]);
    }
    // No stale placeholder survives.
    expect(formula).not.toContain("OLD_");
  });

  test("strips a leading v from the version", () => {
    const { formula } = bumpFormula(FORMULA, "v1.4.0", parseSha256Sums(sumsFile()));
    expect(formula).toContain('version "1.4.0"');
    expect(formula).not.toContain('version "v1.4.0"');
  });

  test("throws when a platform sum is missing — partial patch is unacceptable", () => {
    const partial = parseSha256Sums(
      `${SHA["janus-macos-arm64"]}  janus-macos-arm64\n`,
    );
    expect(() => bumpFormula(FORMULA, "0.2.8", partial)).toThrow(/missing entry for janus-macos-x64/);
  });

  test("throws when the formula has no version line", () => {
    expect(() => bumpFormula("class Janus < Formula\nend\n", "0.2.8", parseSha256Sums(sumsFile()))).toThrow(
      /no `version/,
    );
  });

  test("re-pins a hardcoded literal-version URL to v#{version} (the arm64 0.2.8 bug)", () => {
    const hardcoded = FORMULA.replace(
      "download/v#{version}/janus-macos-arm64",
      "download/v0.2.8/janus-macos-arm64",
    );
    expect(hardcoded).toContain("download/v0.2.8/janus-macos-arm64"); // fixture really is stale

    const { formula } = bumpFormula(hardcoded, "0.3.1", parseSha256Sums(sumsFile()));

    // the literal version is gone; every asset URL interpolates v#{version}
    // and still carries the freshly-mapped sha256 on the line below it.
    expect(formula).not.toContain("v0.2.8");
    for (const asset of HOMEBREW_ASSETS) {
      expect(formula).toContain(`download/v#{version}/${asset}`);
      expect(shaUnderUrl(formula, asset)).toBe(SHA[asset]);
    }
  });
});
