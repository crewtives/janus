# Changelog

All notable changes to Janus are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] — 2026-05-22

### Changed
- **`release.yml` builds the macOS x64 binary by cross-compile**, not on a separate `macos-13` Intel runner. The Bun runner toolchain supports `--target=bun-darwin-x64` from any host (verified locally: 3.5s compile, 67MB Mach-O x86_64). Removes the dependency on the soon-to-be-deprecated `macos-13` GitHub Actions runner and unblocks the release queue (Intel runners had been sitting in queued for 15+ min). Smoke `--help` still runs through Rosetta 2 on `macos-latest`.

## [0.2.1] — 2026-05-22

The launch-readiness pass: everything to take Janus from "private repo with v0.2.0 tagged" to "ready to flip public and announce." No new product surface; existing surfaces become friendlier to a first-time reader.

### Added
- **`janus demo`** — materializes a synthetic vault to a tmpdir (two hand-written pulses, a daily rollup, and the shipped deterministic Wrapped sample in Markdown + HTML) and opens the Wrapped HTML in the default browser. Lets evaluators see what Janus produces without installing Obsidian, configuring projects, or having a Claude Max subscription.
- **`docs/FAQ.md`** — common questions before and after install: Claude Max requirement, Obsidian dependency, macOS Gatekeeper quarantine, scheduler removal, provider switching, data flow, troubleshooting.
- **README "Who it's for / not for" section** — explicit exclusions (teams, non-Obsidian users, push-button-to-Notion expectations) to reduce "this isn't what I expected" noise after launch.
- **Homebrew formula template** at `docs/distribution/homebrew/janus.rb` plus a `homebrew-bump` job in `release.yml` (guarded by `if: false`). When activated, every release auto-PRs the formula in `crewtives/homebrew-tap` so `brew install crewtives/tap/janus` keeps working.
- **macOS code-signing + notarization scaffold** in `release.yml` (guarded). Activates once Apple Developer ID secrets are configured; eliminates the Gatekeeper quarantine on fresh installs.
- **`.github/workflows/npm-publish.yml`** (guarded) and `files` allowlist in `package.json` for an eventual `npm publish` so `bunx janus` / `npx janus` work.
- **`docs/distribution/LAUNCH-CHECKLIST.md`** — ordered list of remaining manual steps to flip the repo public and launch.
- **`docs/assets/`** — placeholder directory with capture recipes for the visual assets the README embeds expect (init GIF, Wrapped HTML screenshot, pulse-in-Obsidian screenshot).
- **`engines.bun`** field in `package.json` declaring the supported Bun version.

### Changed
- **macOS Gatekeeper notice in `scripts/install-binary.sh`** — previously two dim grey lines, now a yellow box with explanation ("this is normal because the binary is not yet signed") and the `xattr` command in green.
- **`docs/plans/` renamed to `docs/plans-internal/`** — clearer signal that the directory holds internal planning history (mixed Spanish/English) rather than current user-facing documentation. All cross-references updated in `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`, `docs/STATUS.md`, and `src/runners/types.ts`.
- **README documentation index** — adds FAQ between the top-level links and in the per-doc list.

## [0.2.0] — 2026-05-22

### Added
- **Binary distribution path** — `scripts/install-binary.sh` (curl-bash) downloads a verified release binary into `~/.local/bin/janus` without requiring Bun. The release workflow now produces four binaries (`macos-arm64`, `macos-x64`, `linux-x64`, `linux-arm64`) plus a `SHA256SUMS` manifest that the installer verifies against.
- **Privacy / PII redaction layer**, enabled by default. All outbound prompts pass through `redactingRunner` (`src/runners/redacting.ts`), which applies the patterns in `src/core/privacy/redact.ts` before the provider sees the text. Coverage in v1: Anthropic / OpenAI / GitHub PAT / AWS keys, JWTs, Discord and Slack webhook URLs, bearer tokens, OpenSSH-style private key blocks, emails (with a default allowlist for `noreply@anthropic.com` Co-Authored-By trailers), and home-directory paths. Configurable via the new `privacy` section in `config.local.json` — see [`docs/PRIVACY.md`](docs/PRIVACY.md). Existing users who don't add a `privacy` block get redaction on by default.
- **`docs/PRIVACY.md`** — what is redacted, what is explicitly out of scope, how to extend, how to verify, threat model.
- **`docs/examples/`** — synthetic Wrapped sample (Markdown + HTML) generated from fabricated `helios` / `kepler` / `atlas` projects. PNG export is opt-in via `bun run scripts/gen-wrapped-sample.ts --png` (requires `puppeteer`).
- **OSS-ready `package.json`** — `license`, `repository`, `homepage`, `bugs`, `keywords`, and `author` fields populated; `private: true` removed in preparation for opening the repository.
- **Binary smoke check** in `scripts/smoke-validate-phase1.ts` — compiles `bin/janus.ts` with `bun build --compile` and runs `pulse --dry-run` against a synthetic temp vault, guarding against future prompt-loading regressions in the bundled binary. Set `JANUS_SKIP_BINARY_SMOKE=1` to skip locally.
- **`.github/dependabot.yml`** — weekly updates for npm and GitHub Actions.
- **README badges** (CI, MIT license, Bun version) and a new **Cost** section that documents the Claude Max model (no API tokens billed).
- **Distribution path for `bun build --compile`.** Prompts are now embedded at build time via Bun import attributes (`with { type: "text" }`), so a single-file binary works end-to-end. See PR #4.
- **GitHub Actions CI** on `ubuntu-latest` + `macos-latest`, pinned to Bun 1.3.14. Runs `bun install --frozen-lockfile`, `bunx tsc --noEmit`, `bun test`, and `scripts/smoke-validate-phase1.ts` on every push and PR. See PR #2.
- **Phase 3 — Janus Wrapped** shipped: aggregator, yearly + per-project renderer, personality archetypes (deterministic + LLM), HTML export, opt-in PNG export via puppeteer, trickle-release window (T-7 → T-0), `bun janus wrapped` CLI with `--dry-run`, `--format`, `--deterministic-only`.
- **Phase 2 — Reflection layer** shipped: open-loop tracks, orphan decisions, stuck blockers, LLM pattern detection, weekly + monthly reflection prompts, anniversary detection, "this day, last year" anchors, per-project anniversary anchor.
- **MCP server** (`bun janus mcp`) — vanilla JSON-RPC stdio with 4 tools: `janus_ask`, `janus_get_spine`, `janus_get_pulse`, `janus_list_projects`.
- **Bookkeeping tables** in SQLite: `project_metadata`, `track_lineage`, `decision_graph`, `blocker_history`.
- **Shared voice spec** at `src/prompts/_voice.md` injected into 7 prompts; bumped prompt versions accordingly.
- **`janus note` command** for portfolio drafts with an observational first-person voice.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` — governance baseline for external contributors.
- `AGENTS.md` and `CLAUDE.md` — instructions for AI coding agents working on the repo.
- GitHub issue templates (bug report, feature request) and a pull request template.
- This `CHANGELOG.md`.
- `LICENSE` — MIT.

### Changed
- `bin/janus.ts` now reads its version from `package.json` via an import attribute instead of a hardcoded literal, so `--version` stays in sync with releases.
- **Daily pulse prompt bumped to `v8`** with one added paragraph instructing the model to treat opaque placeholders (`<email>`, `<github-pat>`, `<repo>`, `~`) as anonymized stand-ins. The data shape is unchanged; `v7` remains in-tree for A/B comparison and history.
- **Pulse filename separator switched from `--` to a single `-`** (PR #3). The `YYYY-MM-DD` prefix stays fixed-width so parsers anchor on `^\d{4}-\d{2}-\d{2}-`. Vault content was migrated out-of-band (118 files renamed, 271 wiki-links rewritten).
- **i18n sweep** — runtime, tests, and the init wizard rebranded to English with a bilingual entry point.

### Fixed
- **launchd platform-guard test** on Linux runners — `installPlist` calls `assertMacOS()` which throws on non-darwin; tests now mirror the per-test guard pattern used by `init-systemd.test.ts`.

## [0.1.0] — Phase 1 close

Initial public-ish release (private repo) covering the foundations:

- Bun + TypeScript + citty CLI scaffold.
- `init` wizard (Claude Max detection, vault + repo scan, idempotent `config.local.json`, optional scheduler install).
- Daily `pulse` per project with per-project serialization and cross-project concurrency via `p-queue` + `p-retry`.
- Weekly `rollup`, monthly digest, quarterly + yearly retrospectives, per-project `spine`.
- Cross-platform nightly scheduler — launchd (macOS), systemd-user timer (Linux + WSL).
- FTS5 search index (`bun janus ask`).
- `LLMRunner` abstraction with `claude-code` (primary) and `gemini-cli` (fallback) adapters; `with-fallback` composition.
- `doctor` command with provider-aware diagnostics.
- 268 passing tests at end of Phase 1.

[Unreleased]: https://github.com/crewtives/janus/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/crewtives/janus/releases/tag/v0.2.2
[0.2.1]: https://github.com/crewtives/janus/releases/tag/v0.2.1
[0.2.0]: https://github.com/crewtives/janus/releases/tag/v0.2.0
[0.1.0]: https://github.com/crewtives/janus/releases/tag/v0.1.0
