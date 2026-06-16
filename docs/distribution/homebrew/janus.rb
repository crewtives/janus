# Homebrew formula template for Janus.
#
# This file is the template that lives at Formula/janus.rb in the
# crewtives/homebrew-tap repo. It does not live in the Janus repo at
# runtime — Homebrew loads it from the tap when a user runs:
#
#   brew install crewtives/tap/janus
#
# How the file gets updated:
#   - On every Janus release (tag push), the `homebrew-bump` job in
#     .github/workflows/release.yml runs scripts/bump-homebrew-formula.ts, which
#     reads the release's SHA256SUMS and patches `version` plus ALL FOUR
#     per-platform `sha256` lines below atomically, then commits straight to the
#     tap's main branch. (The earlier mislav/bump-homebrew-formula-action only
#     patched one block, leaving the other three stale — see the script header.)
#
# Manual bootstrap steps (one-time, before the auto-bump can work):
#   1. Create the tap repo:    gh repo create crewtives/homebrew-tap --public
#   2. In the tap repo:        mkdir -p Formula && cp <this-file> Formula/janus.rb
#   3. Edit `version` + `sha256` values below to match the current Janus release.
#   4. Commit + push to the tap repo's main branch.
#   5. Verify locally:         brew install crewtives/tap/janus

class Janus < Formula
  desc "Personal historian for makers — synthesizes git + Claude Code sessions into Obsidian"
  homepage "https://github.com/crewtives/janus"
  version "0.2.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/crewtives/janus/releases/download/v#{version}/janus-macos-arm64"
      sha256 "REPLACE_WITH_SHA256_OF_janus-macos-arm64"
    end
    on_intel do
      url "https://github.com/crewtives/janus/releases/download/v#{version}/janus-macos-x64"
      sha256 "REPLACE_WITH_SHA256_OF_janus-macos-x64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/crewtives/janus/releases/download/v#{version}/janus-linux-arm64"
      sha256 "REPLACE_WITH_SHA256_OF_janus-linux-arm64"
    end
    on_intel do
      url "https://github.com/crewtives/janus/releases/download/v#{version}/janus-linux-x64"
      sha256 "REPLACE_WITH_SHA256_OF_janus-linux-x64"
    end
  end

  def install
    asset = "janus-#{OS.mac? ? "macos" : "linux"}-#{Hardware::CPU.arm? ? "arm64" : "x64"}"
    bin.install asset => "janus"
  end

  test do
    assert_match "janus", shell_output("#{bin}/janus --help")
  end
end
