---
title: "Handoff — Janus at the close of Phase 1+2+3"
created: 2026-05-22
last_updated: 2026-05-22 (post-CI + dash-rename session)
---

# Janus handoff

Self-contained document so another Claude Code session (or another coding agent) can continue the work without prior context. Read it in full before doing anything.

> **Update 2026-06-16 (v0.2.8) — read this first.** Several claims below were true
> on 2026-05-22 and have since changed. Corrections, with [`CHANGELOG.md`](../CHANGELOG.md)
> as the live source of truth:
> - **The repo is PUBLIC**, not private — the `curl | bash` installer one-liner works.
> - **The privacy/redaction layer EXISTS** (`src/core/privacy/`, wired in
>   `resolveRunner`). "Possible next steps · C" below is already shipped.
> - **Standalone-binary distribution is live**: prompts *and* the wrapped HTML/CSS
>   templates are embedded via import attributes, so `bun build --compile` produces
>   a working binary (pulse + wrapped, including `--format html`); `release.yml`
>   builds four platform binaries and bumps a public Homebrew tap. The "defer
>   distribution" notes in the session log and `HANDOFF-CI-DISTRIBUTION.md` are obsolete.
> - **Tests: 382 / 382** (the 348/349 figures below are stale).
> - Code-signing + `npm publish` stay scaffolded-but-off pending external credentials.

## The product in one line

Janus is **the maker's personal historian**: it reads your work (git + Claude Code sessions) and writes the **continuous narrative** of your projects in a temporal hierarchy (daily → weekly → monthly → quarterly → yearly → spine). That narrative is **queryable via MCP** by other agents — Claude Code in other sessions asks Janus "what did we do in X last week?" and gets synthesized context, not raw logs.

Starting with Phase 2, the system also **interrogates**: it detects open loops, escalates stuck patterns, anchors last year's memory, and surfaces anniversaries.

Starting with Phase 3, the system **harvests the narrative**: it generates the annual **Janus Wrapped** (yearly cross-project + per-project on anniversaries) in markdown / HTML / PNG.

## Coordinates

- **Repo**: https://github.com/crewtives/janus · **public**. To clone: `gh repo clone crewtives/janus`.
- **CI**: GitHub Actions, see `.github/workflows/ci.yml`. Green on ubuntu-latest + macos-latest as of merge of `#3`.
- **Typical local path**: `~/janus`. The installer one-liner (`curl | bash` via `scripts/install-binary.sh`) works for anonymous users now that the repo is public.
- **Obsidian vault**: `~/Obsidian` (default)
- **Janus state**: `<repo>/.janus/` (gitignored — checkpoint, search index, logs)
- **Primary provider**: Claude Code (`claude -p` headless, OAuth Max)
- **Fallback provider**: Gemini CLI

## Session log

### 2026-05-22 — CI + dash rename + bun-compile experiment

Three pieces of plumbing landed; see `docs/HANDOFF-CI-DISTRIBUTION.md` for the full investigation. TL;DR:

- **CI is live** (`#2`, merged). `.github/workflows/ci.yml` runs `bun install --frozen-lockfile`, `bunx tsc --noEmit`, `bun test`, and `scripts/smoke-validate-phase1.ts` on every push to `main` and every PR. Matrix `ubuntu-latest` + `macos-latest`, bun pinned to `1.3.14`, `fail-fast: false`. Branch protection deliberately NOT enabled — solo contributor still pushes to main; CI runs post-push as a safety net.
- **`bun build --compile` experiment**: produces a 61 MB macOS arm64 binary in ~200 ms that runs `--help` and `wrapped --dry-run` end-to-end (dynamic imports survive bundling). Fails on `pulse --dry-run` because `Bun.file("prompts/_voice.md")` resolves to `/$bunfs/prompts/_voice.md` which doesn't exist — `--compile` doesn't walk source for arbitrary `.md`. Distribution deferred until prompts are embedded via Bun import attributes (`import voiceSpec from "../prompts/_voice.md" with { type: "text" }`). README still points at `git clone + bun install`.
- **Pulse filenames switched** from `YYYY-MM-DD--<project>.md` to `YYYY-MM-DD-<project>.md` (`#3`, merged). Date prefix is fixed-width so the single-dash form still parses unambiguously. Vault was migrated out-of-band: 118 files renamed + 271 wiki-links rewritten across 75 files. Validated post-rename with `bun janus wrapped --year 2026 --dry-run`.

Two test failures from the launchd suite on Linux runners (`installPlist` calls `assertMacOS()` which throws on non-darwin) were resolved by mirroring the platform-guard pattern that `init-systemd.test.ts` already uses — `if (process.platform !== "darwin") return;` per test plus one "non-darwin throws" assertion.

## Status as of 2026-05-22 — Phase 1 + 2 + 3 ✅ shipped

### Phase 1 — Foundations · ✅

| Sub-phase | Status | Summary |
|---|---|---|
| **1A Narrative voice** | ✅ | `src/prompts/_voice.md` shared spec + 7 prompts bumped |
| **1B Multi-source** | ⏸ DEFERRED | Cursor/Codex/Linear/voice memos/Calendar — not implemented |
| **1C Bookkeeping** | ✅ | `project_metadata`, `track_lineage`, `decision_graph` |
| **1D MCP server** | ✅ | `src/mcp/server.ts` vanilla JSON-RPC stdio, 4 tools |

Extras: cross-platform scheduler · installer one-liner · auto-pulse launchd · per-project serialization · automatic scaffold · Timeline restructure · `janus note`.

### Phase 2 — Reflection layer · ✅

| IU | Status | Files | Notes |
|---|---|---|---|
| **U1 — Open-loop tracks** | ✅ | `src/core/reflection/open-loops.ts` | Open tracks with `last_mentioned < now - 14d` |
| **U2 — Orphan decisions** | ✅ | `open-loops.ts` (shared) | ADRs with `created < 14d` and `last_referenced > 7d` |
| **U3 — Stuck blockers** | ✅ | `stuck-patterns.ts` + `blocker_history` table | Hash + count across consecutive weeklies |
| **U4 — Pattern detection LLM** | ✅ | `pattern-detector.ts` + prompt `pattern-detection.v2.md` | JSON output, filter by confidence ≥ 0.6 |
| **U5 — Reflection prompts (weekly)** | ✅ | `weekly-rollup.v5.md` + `question-preserve.ts` | Preserves user answers |
| **U6 — Reflection prompts (monthly)** | ✅ | `monthly-digest.v4.md` | Analogous to U5 |
| **U7 — Anniversary detection** | ✅ | `anniversaries.ts` + `daily-pulse.v8.md` | Trigger callout + per-project Wrapped |
| **U8 — "This day, last year" (daily)** | ✅ | `anchors.ts` | Lookup in `Timeline/Daily/<year-1>-MM-DD.md` |
| **U9 — Per-project anniversary anchor** | ✅ | `anchors.ts` (shared) | Lookup in `Projects/<x>/pulse/<year-1>-MM-DD-<x>.md` |

**New SQLite table**: `blocker_history(blocker_hash, project, first_seen, last_seen, weekly_count, sample_text)`.

**Prompts bumped in Phase 2**:
- `daily-pulse.v6.md → v7.md`
- `daily-rollup.v4.md → v5.md`
- `weekly-rollup.v4.md → v5.md`
- `monthly-digest.v3.md → v4.md`
- New: `pattern-detection.v2.md`

### Phase 3 — Janus Wrapped · ✅

| IU | Status | Files | Notes |
|---|---|---|---|
| **U1 — Aggregator** | ✅ | `src/core/wrapped/aggregator.ts` + `types.ts` | `WrappedData` with metrics, top tracks/decisions, biggest week, birthdays, themes |
| **U2 — Yearly renderer** | ✅ | `renderer.ts` + `wrapped-yearly.v2.md` | Output `<vault>/Wrapped/Wrapped-YYYY.md` |
| **U3 — Personality archetypes** | ✅ | `personality.ts` + `wrapped-personality.v2.md` | 6 archetypes + Hybrid. Deterministic + LLM. |
| **U4 — Per-project Wrapped** | ✅ | `renderer.ts` (project scope) + `wrapped-project.v2.md` | Auto-trigger on anniversary from orchestrator |
| **U5 — HTML output** | ✅ | `html.ts` + `src/templates/wrapped.html` + `.css` | Self-contained, embedded CSS, escapes XSS |
| **U6 — PNG export** | ✅ | `png.ts` (opt-in puppeteer) | `bun add -d puppeteer` to enable |
| **U7 — Trickle release** | ✅ | `trickle.ts` + wire in `daily.ts` | T-7/T-5/T-3/T-1/T-0 schedule |
| **U8 — `janus wrapped` CLI** | ✅ | `src/commands/wrapped.ts` | `--year`, `--project`, `--dry-run`, `--format`, `--deterministic-only` |

**New commands**:
```bash
bun janus wrapped --year YYYY                # yearly cross-project
bun janus wrapped --year YYYY --project NAME # per-project
bun janus wrapped --year YYYY --dry-run      # only aggregator + personality, no writes
bun janus wrapped --year YYYY --format html  # self-contained HTML
bun janus wrapped --year YYYY --format png   # PNG (requires puppeteer installed)
```

## Tests

**382 tests passing** (was 268 at end of Phase 1). Clean typecheck.

New test files in Phase 2 + 3:
- `tests/reflection-anniversaries.test.ts`
- `tests/reflection-anchors.test.ts`
- `tests/reflection-open-loops.test.ts`
- `tests/reflection-stuck-patterns.test.ts`
- `tests/reflection-question-preserve.test.ts`
- `tests/reflection-pattern-detector.test.ts`
- `tests/wrapped-aggregator.test.ts`
- `tests/wrapped-personality.test.ts`
- `tests/wrapped-renderer.test.ts`
- `tests/wrapped-html.test.ts`
- `tests/wrapped-png.test.ts`
- `tests/wrapped-trickle.test.ts`

```bash
bun test                                        # 382 tests, ~1s
bunx tsc --noEmit                               # typecheck
bun run scripts/smoke-validate-phase1.ts        # 14 checks, no LLM
```

## Main commands (Phase 3 close)

```bash
# Core
bun janus pulse [--backfill 7d] [--project <name>] [--dry-run]
bun janus rollup --week
bun janus monthly --month YYYY-MM
bun janus quarterly --quarter YYYY-Q?
bun janus yearly --year YYYY
bun janus spine [--project <name>]

# Wrapped (NEW in Phase 3)
bun janus wrapped --year YYYY [--project NAME] [--dry-run] [--format markdown|html|png]

# Search + agent memory
bun janus ask "<query>" [--project X] [--kind pulse,weekly,...] [--since YYYY-MM-DD]
bun janus mcp                                  # MCP server stdio

# Portfolio notes
bun janus note "<topic>" [--title "..."] [--project <name>] [--dry-run]

# Setup
bun janus init                                  # interactive wizard
bun janus doctor                                # validation

# Maintenance
bun janus discover [--apply]
bun janus retry --from .janus/failed.jsonl
bun janus adr {create,promote,list}
bun janus archive-tracks [--ttl-weeks N]
```

## Non-obvious decisions (gotchas)

### Absolute paths in plist/service (launchd + systemd)

launchd and systemd-user inherit a minimal PATH without `/opt/homebrew/bin` or `~/.local/bin`. `cleanEnv()` in `src/runners/util.ts` enriches the PATH. `renderPlist()` / `renderUnits()` use `process.execPath` (absolute path to bun). Do not revert.

### Per-project serialization in the queue

`src/pipeline/orchestrator.ts` enqueues **ONE task per project**. Inside the task there's a sequential loop over the dates. `concurrency: 2` parallelizes **projects**, not dates. Do not revert — it's covered by `tests/orchestrator-serial.test.ts`.

### Conservative FTS5 sanitize

`sanitizeQuery()` in `src/core/search-index.ts` only allows alphanum + spaces + `"` (phrase) + `*` (prefix wildcard). Explicit tradeoff: queries like `agent-native` become `agent native`.

### Idempotency everywhere

Every output is idempotent. If you add a new output, make sure re-running doesn't duplicate or break anything.

### Shared voice spec

`src/prompts/_voice.md` is the single source of truth for the narrative voice. Notes (`note-draft.v2`) have their OWN inline voice spec — observational first-person, distinct from pulses (soft third-person).

### Anniversary trigger for the per-project Wrapped (Phase 3 U4)

`src/pipeline/orchestrator.ts` checks for anniversary BEFORE generating the daily pulse. If it detects an anniversary AND the `<project>-wrapped-YYYY.md` file does NOT exist → it generates it with `deterministicOnly: true` (no LLM, avoids cost explosion on backfills). Idempotent: re-running does not regenerate.

### Deterministic stuck-blocker hash

`hashBlocker()` in `stuck-patterns.ts` normalizes the text (lowercase, no punctuation, no wiki-links, no code). SHA-256 hash truncated to 16 chars. Changing the normalization requires migrating the `blocker_history` table (existing hashes stop matching).

### Question-preserve heuristic

`preserveQuestionAnswers` in `src/core/reflection/question-preserve.ts` replaces the entire "Questions for you" block when it detects user-written text (non-callout lines or previous block > 1.3× the regenerated one). It does NOT merge field by field — it preserves the whole block. Tradeoff: if the LLM rotates the questions, the previous questions + previous answers are preserved verbatim. Acceptable because answers are what the system must NEVER lose.

### Trickle release schedule (Phase 3 U7)

Schedule: T-7 (Dec 24), T-5 (Dec 26), T-3 (Dec 28), T-1 (Dec 30), T-0 (Dec 31). Other days within the window → silent. `config.wrapped.trickle.enabled = false` to opt out.

### Puppeteer is opt-in

`png.ts` does a dynamic `import("puppeteer")`. It's NOT in `package.json` to avoid inflating the install by ~280MB. If the user wants PNG export:
```bash
bun add -d puppeteer
bun janus wrapped --year 2026 --format png
```
If it's not installed, the error message explains how to install it.

### Pulse filename separator is a single dash

Pulse filenames are `YYYY-MM-DD-<project>.md`. The `YYYY-MM-DD` prefix is fixed-width (10 chars) so `<date>-<slug>` parses unambiguously even when both parts contain `-` (e.g. `2026-05-21-crewtives-acme-app`). All regex parsers anchor on `^\d{4}-\d{2}-\d{2}-` for that reason — don't relax that anchor. Before 2026-05-22 the separator was `--`; vault content was migrated, but if you ever import an older backup, run a one-shot rename + wiki-link rewrite first (the script is gone; reconstruct from git history of commit `7434155` if needed).

### Deterministic vs LLM personality

`computePersonality()` runs in 2 steps: (1) compute deterministic numeric signals (shipRatio, refactorRatio, exploreSpread, connectorRatio, avgSessionLength), (2) LLM call. If the LLM fails → deterministic fallback (heuristic over the signals). The Wrapped always has an archetype. Acceptable because the signals themselves are honest.

## How to start the new session

1. Read this file (`docs/HANDOFF.md`).
2. Verify the baseline: `bun test && bunx tsc --noEmit`.
3. For any launchd/systemd scheduler change: also read `src/core/init/scheduler.ts` + `docs/STATUS.md`.

## Inventory at the close of Phase 3

```
src/core/reflection/
├── anchors.ts            (U8 + U9)
├── anniversaries.ts      (U7)
├── open-loops.ts         (U1 + U2)
├── pattern-detector.ts   (U4)
├── question-preserve.ts  (U5 + U6 helper)
└── stuck-patterns.ts     (U3)

src/core/wrapped/
├── aggregator.ts         (U1)
├── html.ts               (U5)
├── personality.ts        (U3)
├── png.ts                (U6)
├── renderer.ts           (U2 + U4)
├── trickle.ts            (U7)
└── types.ts              (shared)

src/templates/
├── wrapped.html
└── wrapped.css

src/commands/wrapped.ts   (U8)

src/prompts/ (new in Phase 2+3)
├── daily-pulse.v8.md
├── daily-rollup.v5.md
├── weekly-rollup.v5.md
├── monthly-digest.v4.md
├── pattern-detection.v2.md
├── wrapped-yearly.v2.md
├── wrapped-project.v2.md
└── wrapped-personality.v2.md
```

## Possible next steps

With Phase 1+2+3 closed, the original roadmap is complete. Potential directions:

### A — Phase 1B (Multi-source)
Deferred in Phase 1. Cursor/Codex/Linear/voice memos/Calendar. Requires interactive setup per user.

### B — Eval and LLM output polish
Phase 3 introduces 3 new prompts (`wrapped-yearly`, `wrapped-project`, `wrapped-personality`) and 1 from Phase 2 (`pattern-detection`). Side-by-side eval against real outputs is still pending before the first real Wrapped (Dec 2026). Reuse `scripts/eval-prompt-voice.ts` as the pattern.

### C — Privacy / redaction layer ✅ SHIPPED
Redacts PII / secrets and collapses paths in every prompt before it reaches the
LLM. Lives in `src/core/privacy/redact.ts`, wired bypass-resistant via
`src/runners/redacting.ts` in `resolveRunner()`. Opt out with
`config.privacy.enabled = false`. See `docs/PRIVACY.md`. Follow-up (optional):
broaden the pattern set (Stripe/Twilio/etc.) and add per-pattern hit counts.

### D — Minimal landing + public demo
Real Wrapped as the viral hook. Needs 1 year of data + 1 real Wrapped for a demo. The first real Wrapped is Dec 2026 (~7 months).

### E — Multi-year comparative Wrapped
"Vs last year" in the Wrapped — compare archetype, top tracks, biggest week year-over-year. Defer to follow-up of the original plan.

## Existing backups (vault and state)

- `~/Obsidian.backup-2026-05-21-pre-phase1/` — vault pre-Phase 1
- `~/projects/crewtives/janus/.janus.backup-2026-05-21/` — state pre-Phase 1

If the new session introduces a catastrophic bug, there's a rollback path to pre-Phase 1.

## TL;DR of the handoff

- Phase 1 + 2 + 3 SHIPPED. Original roadmap complete.
- CI on GitHub Actions (ubuntu + macOS) is green and required reading: every PR runs it.
- 382 / 382 tests passing on `main` (as of 2026-06-16; was 349 at the Phase 3 close). Clean typecheck.
- Pulse filenames use single-dash separator (`YYYY-MM-DD-<project>.md`) as of `7434155` (2026-05-22).
- Janus moved from "passive historian" to "reflective coach" (Phase 2) and to "narrator with annual harvest" (Phase 3).
- The Wrapped CLI works end-to-end against production vault data (dry-run validated post-rename).
- `bun build --compile` works for everything except prompt loading — see `docs/HANDOFF-CI-DISTRIBUTION.md` for the path forward on distribution.
- The closest thing to "ready for external users" — still missing LLM output polish (Wrapped and patterns), privacy/redaction layer, and the prompt-embedding step that unlocks a standalone binary.
- Do not revert the non-obvious decisions listed above without understanding the context.
- Tests + typecheck before any change.
