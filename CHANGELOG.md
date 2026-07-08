# Changelog

All notable changes to Janus are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Homebrew installs on Apple Silicon no longer strand on a stale version.** `bumpFormula` now re-pins every asset URL to `v#{version}`, so a formula block that hardcodes a literal version can't keep serving an old binary past a release bump. The macOS `on_arm` URL had been pinned to `v0.2.8` since 0.2.8 — every `brew install/upgrade` on arm64 through 0.3.1 silently fetched that binary and failed the new release's checksum. (The live tap formula was fixed out-of-band.)

## [0.3.1] — 2026-07-08

### Added
- **Portfolio notes attach to the graph.** `janus note` now writes a `## Related` hub backlink and a `project/<id>` tag when the project is known — passed via `--project` or inferred from the dominant project in the gathered context — so a note is no longer a graph orphan hidden by `showOrphans:false`. Realizes the `R13 / OQ2·KD5` note attribution + hub backlink deferred in Fase 2.

### Changed
- **`note-draft` prompt v3 — project-anonymous drafts.** New `note-draft.v3.md` adds a mandatory "Anonymization & privacy" section, so a generated note's published body never names the project, product, domain, person, or internal identifiers. `note-draft.v2` kept in-tree per the prompt-versioning convention.

## [0.3.0] — 2026-07-08

### Added
- **`janus defuse`** — one-time deterministic, no-LLM graph de-fuse pass over all existing vault notes. Strips MOC footers and pulse date-chains, delinks pulse-to-pulse prose links, and stamps `prev`/`next` chronology plus canonical `type/<type>` and `project/<id>` tags. DRY-RUN by default; `--apply` writes, `--project` filters. Backup-first and idempotent (a second `--apply` is a byte-for-byte no-op).

### Changed
- **Graph de-fuse (Fase 2).** Generated notes no longer emit the shared `[[Decisions MOC]] · [[Risks MOC]] · [[Projects MOC]]` footer (pulses) or pulse-to-pulse date-chain wiki-links; chronological order moves to `prev`/`next` frontmatter properties instead of graph edges. Aggregators (daily/weekly/monthly) drop per-pulse transclusions, nav date-chains, and MOC footers. Every note gains **additive** canonical `type/<type>` + `project/<id>` tags — the bare `pulse` tag and scalar `type:` field are preserved, so every dashboard/MOC dataview is unchanged. New prompt versions: `daily-pulse.v9`, `daily-rollup.v6`, `weekly-rollup.v6`, `monthly-digest.v5`, `project-spine.v4`.
- **Pulses live only in the Obsidian vault.** The dual-write into each project repo's `docs/pulse/` was removed — the vault is the single source of truth.

### Fixed
- **`fix-related` no longer re-fuses the graph on every run.** It stamps `prev`/`next` frontmatter instead of re-inserting the `- Pulse anterior:` date-chain line, and canonicalizes the single hub up-link — so a scheduled run no longer undoes the de-fuse.

## [0.2.9] — 2026-06-19

### Added
- **`janus pulse --date <YYYY-MM-DD>` and `--force`** to reprocess a single day, ignoring the done-checkpoint. `--date` pins exactly one day (precedence over `--since`/`--backfill`); `--force` regenerates even when already marked done. Replaces the old workaround of hand-deleting rows from `.janus/state.db`.
- **`janus enrich` subcommand** — rebuilds vault docs (`_index`, `_roadmap`, `STRATEGY`) and the scaffold (hubs, MOCs, dashboards, fix-related) in-process and idempotently, without needing a successful pulse. Flags: `--project`, `--sync-roadmaps`, `--no-scaffold`.
- **`/daily-pulse` skill onboarding.** `janus init` now offers to symlink the skill into `~/.claude/skills` (Step 7.5, EN/ES), and the skill's commands call the `janus` binary on PATH so they work regardless of where the repo lives — dropping the hardcoded `~/janus` assumption. README and `install.sh` document it.

### Changed
- **Vault enrichment never leaves a broken roadmap.** When no `inferring` pulse is available, roadmap generation falls back to `syncRoadmaps` (repo `ROADMAP.md` mirror → "Vs Roadmap" pulse callout → `PENDIENTE` placeholder), so the `![[_roadmap]]` embed in `_index.md` always resolves. A roadmap that already carries inferred milestones is never downgraded.
- **`_index.md` is freezable.** Set `managed_by_janus: false` in its frontmatter to stop Janus from overwriting a hand-edited dashboard; the field is declared in the generated template.

### Fixed
- **Open-loop detection**: `track_lineage.status` is normalized to the enum at the persistence boundary, so weekly free-text "Status at close" prose no longer leaves tracks invisible to open-loop detection.
- **Wrapped**: corrected the `wrapped-yearly` `prompt_version` to v3, and embed the HTML/CSS templates so the compiled binary renders Wrapped.
- **Privacy**: repo paths collapse to `<repo>` in pulse prompts.

### CI / distribution
- Release builds now run a real binary smoke (`janus demo --no-open`) that loads the import-attribute-embedded templates from the binary's `$bunfs`, catching the historical `ENOENT /$bunfs/...` class of bug in CI instead of on a user's machine.
- Consolidated distribution docs: archived the superseded CI/distribution handoff and flagged the Homebrew formula template's `version`/`sha256` as placeholders by design.

## [0.2.8] — 2026-05-29

### Added
- **Voice rule 10 — anti-slop prose.** The shared voice spec (`src/prompts/_voice.md`) now imports the copy-quality checklist from [impeccable.style/slop](https://impeccable.style/slop/), adapted to prose, and applies it to every output through the single `<%= it.voice %>` injection point. Two tiers keyed to rule 9's surface split: strict for publication-bound copy (`note-draft`, copy-paste blocks), tolerant inside the Obsidian narrative but held to a floor so any single sentence lifted into a post is publication-safe. Covers em-dash discipline, manufactured-contrast cadence, marketing buzzwords, and theater framing; defers concreteness to rule 5 and buzzwords-as-adjectives to rule 4 instead of duplicating. The doc's own line-3 opener — itself a fabricated-contrast triplet the rule penalizes — was softened so the spec obeys its own rules.
- **Voice rule 9 — code blocks for copy-paste content vs callouts for narrative.** Anything the reader is expected to copy elsewhere (a social post draft, a commit-message proposal, landing copy) renders in a fenced `text` block instead of a blockquote, so Obsidian's one-click copy button works and publish-ready text doesn't render broken inside a callout. Pulses, weeklies, monthlies, spines, and wrapped keep their callout formatting.

## [0.2.7] — 2026-05-23

### Changed
- **`sync-roadmaps` now prefers the project repo as the source of truth for each `_roadmap.md`.** Before, the only source was the `[!check] Vs Roadmap` callout in the latest non-idle pulse, parsed for bullets with emojis (✅ 🚧 ⏸️ ❓). That callout drifted to prose after the Phase 1A voice overhaul, leaving 0/7 projects parseable. The new flow per project is:
  1. If `_roadmap.md` has `needs_review: false` → leave it alone (user-edited).
  2. If `<repoPath>/ROADMAP.md` or `<repoPath>/docs/ROADMAP.md` (also lowercase variants) exists → mirror it into the vault. The repo file is the source of truth.
  3. Fallback to the legacy bullet-with-emoji pulse parser.
  4. Otherwise → write a visible `PENDIENTE` placeholder explaining what's missing and where to put it.

  The API renamed `syncRoadmapsFromPulses` → `syncRoadmaps`. The old name is kept as an alias for back-compat.

### Added
- `syncRoadmaps` now requires `repoPath` on each project (already present in `ProjectConfig`). The script `scripts/sync-roadmaps.ts` was updated; the orchestrator's auto-trigger path is unchanged in surface.

## [0.2.6] — 2026-05-23

### Fixed
- **Post-pulse scaffolding now runs from the compiled binary.** The orchestrator used to invoke the four scaffolding scripts (`generate-hubs`, `generate-mocs`, `generate-dashboards`, `fix-pulse-anterior-links`) via `Bun.spawn(["bun", "run", scripts/X.ts])`. That failed two ways from a `bun build --compile` binary running under launchd: `bun` is not on launchd's minimal PATH, and the `.ts` source files do not exist in the binary's filesystem to begin with. Hubs, MOCs, dashboards and the post-pulse `Related` repair therefore never ran from a brew-installed Janus. Refactor: the four scripts now thin-wrap importable modules under `src/core/scaffold/` (`hubs.ts`, `mocs.ts`, `dashboards.ts`, `fix-related.ts`), and the orchestrator calls them in-process. The compiled binary bundles the new modules, the scaffolding actually runs, and the warning `scaffold failed (non-fatal): Executable not found in $PATH: "bun"` is gone.

### Changed
- The standalone CLI form of each scaffolding script still works (`bun run scripts/generate-hubs.ts`, `bun run scripts/generate-mocs.ts`, etc.) — the scripts now delegate to the new modules but expose the same flags (`--force`, `--dry-run`, `--project`).

## [0.2.5] — 2026-05-23

### Fixed
- **`janus mcp` now reports the real release version** in `serverInfo.version` instead of the hardcoded `0.2.0` literal that had been frozen since the MCP server first shipped in Phase 1D. Discovered while smoke-testing the MCP handshake against v0.2.4. The constant is now wired to `package.json` via the same import-attribute pattern `bin/janus.ts` already uses, and the MCP test suite asserts `serverInfo.version === pkg.version` so a regression makes the build fail.

## [0.2.4] — 2026-05-23

First release with the `homebrew-bump` job in `release.yml` un-guarded. Going forward, every tag push opens a PR against `crewtives/homebrew-tap/Formula/janus.rb` with the new version and SHA256 sums automatically — no more manual tap edits.

### Changed
- **`.github/workflows/release.yml`** — removed the `if: false` guard on the `homebrew-bump` job. Activation needed the `HOMEBREW_TAP_GITHUB_TOKEN` secret (fine-grained PAT with `Contents: read/write` on the tap repo), which is now configured.

## [0.2.3] — 2026-05-23

Re-release. No source changes; only the binary distribution layer.

### Fixed
- **Homebrew tap formula now matches the published release.** The `Formula/janus.rb` shipped against v0.2.2 declared SHA256 sums that did not match the four binaries actually published to the GitHub release (the assets were rebuilt after the formula was generated, and the `homebrew-bump` job is still guarded by `if: false` pending the `HOMEBREW_TAP_GITHUB_TOKEN` secret). `brew install crewtives/tap/janus` failed with "Formula reports different checksum". v0.2.3 cuts a fresh set of binaries and updates the tap by hand so the install path works again.

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
