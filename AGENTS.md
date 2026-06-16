# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex CLI, Cursor, Aider, etc.) working on this repository. Read this in full before editing anything. If you only read one section, read **Non-obvious decisions** at the bottom.

Human contributors: read [CONTRIBUTING.md](CONTRIBUTING.md) instead.

## What Janus is

Janus is a nightly agent that turns your work (git history + Claude Code session transcripts) into a continuous engineering narrative inside an Obsidian vault: daily → weekly → monthly → quarterly → yearly → spine. It also exposes itself as an MCP server so other agents can query that narrative.

The product surface is small and deliberate. Every output is **idempotent**, every prompt is **versioned**, and the **voice** of the narrative is the moat — not the universality of output. Refactors that "clean up" by collapsing those properties will be reverted.

## Repo map

```
bin/janus.ts                Entry point. citty command tree.
src/commands/               One file per `bun janus <verb>` subcommand.
src/core/                   Pure business logic — no CLI plumbing here.
  reflection/               Phase 2 — open loops, stuck patterns, anniversaries.
  wrapped/                  Phase 3 — Janus Wrapped (aggregator, renderer, html, png, trickle).
  init/                     Wizard internals (detect, config-merge, launchd, systemd, scheduler).
src/pipeline/               Orchestrator, p-queue, rollup runner.
src/prompts/                Versioned LLM prompts. Eta templates. `_voice.md` is the shared voice spec.
src/runners/                LLMRunner abstraction + adapters (claude-code, gemini, with-fallback).
src/mcp/                    JSON-RPC stdio MCP server.
src/templates/              HTML/CSS for the Wrapped HTML export.
src/types/                  Shared TypeScript types.
scripts/                    Maintenance + smoke-validate-phase1.ts.
tests/                      One `*.test.ts` per feature. `bun test` runs them all.
docs/                       ARCHITECTURE, STATUS, HANDOFF, mcp, plans, eval, pulse.
.janus/                     Runtime state (gitignored). SQLite DB, FTS5 index, logs, failed.jsonl.
```

## Toolchain

- **Bun 1.3.14+** is the runtime. Not Node. `bun:sqlite`, `Bun.file`, `Bun.spawn`, `Bun.Glob` are used directly — do not port to Node equivalents.
- **TypeScript** with `bunx tsc --noEmit` as the typecheck gate. Strict mode. No `any` unless you justify it in a comment.
- **citty** for the CLI tree, **@clack/prompts** for the wizard, **Eta** for prompt templating, **p-queue + p-retry** for the pipeline.
- **No new dependencies** without a strong reason and a maintainer sign-off. The install surface is intentionally small.

## The dev loop you must run

Before claiming a change is done, run all three:

```bash
bun test                                    # full test suite — must be green
bunx tsc --noEmit                           # typecheck — must be silent
bun run scripts/smoke-validate-phase1.ts    # 14 deterministic checks, no LLM
```

CI runs the same three on `ubuntu-latest` and `macos-latest`. If you can only run one before committing, run `bun test`.

## Conventions

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org). Scope is one of: `pulse`, `rollup`, `monthly`, `quarterly`, `yearly`, `spine`, `wrapped`, `mcp`, `init`, `discover`, `doctor`, `runners`, `prompts`, `pipeline`, `core`, `tests`, `ci`, `docs`, `chore`, `i18n`, `distribution`.

```
feat(wrapped): per-project Wrapped on anniversary
fix(search): sanitizeQuery rejects bare wildcards
refactor(pulse): single-dash separator in pulse filenames
docs(handoff): record CI + dash-rename + bun-compile session
```

### Branches

`<type>/<short-slug>` in kebab-case. Examples: `feat/wrapped-png-export`, `fix/launchd-platform-guard`, `chore/contribution-docs`.

### Tests

- One `tests/<feature>.test.ts` per feature. Mirror the source layout where it helps readability.
- Filesystem fixtures use `mkdtemp(tmpdir())`. Never touch the real `~/Obsidian` vault in a test.
- SQLite fixtures use `Checkpoint.openInMemory()`.
- LLM calls in command tests use the `runnerOverride` injection point — never call a real `claude -p` from a test.
- Platform-specific code (launchd, systemd) guards with `if (process.platform !== "darwin") return;` at the top of each test plus one explicit "non-darwin throws" assertion. Pattern lives in `tests/init-launchd.test.ts` and `tests/init-systemd.test.ts`.
- New feature → at least one happy-path test. Bug fix → a regression test that fails on `main` and passes on your branch.

### Prompts

Prompts are versioned files in `src/prompts/`. **Never edit a shipped prompt in place** — create the next version:

```
src/prompts/daily-pulse.v7.md         ← shipped, leave alone
src/prompts/daily-pulse.v8.md         ← your new version
```

Then update the import site to point at the new file. Old versions stay in-tree because they're embedded into the compiled binary via Bun import attributes:

```ts
import dailyPulseV8 from "../prompts/daily-pulse.v8.md" with { type: "text" };
```

Do NOT reintroduce `Bun.file(promptPath).text()` for prompt loading — it breaks `bun build --compile` because `--compile` doesn't walk source for arbitrary `.md` files. See `docs/HANDOFF-CI-DISTRIBUTION.md` for the bun-compile experiment.

The shared voice spec is `src/prompts/_voice.md`. Notes (`note-draft.v2`) carry their own inline voice spec — observational first-person, distinct from the soft third-person used for pulses. Don't merge them.

### Idempotency

Every artifact Janus writes (pulse, rollup, monthly, yearly, spine, Wrapped, hub, MOC) is idempotent. Re-running on the same inputs must not duplicate output. If you add a new artifact, write the idempotency test before the writer.

### Filenames

Pulse filenames are `YYYY-MM-DD-<project>.md` — **single-dash separator**. The `YYYY-MM-DD` prefix is fixed-width (10 chars) so regex parsers anchor on `^\d{4}-\d{2}-\d{2}-` and the `<project>` slug can itself contain dashes (e.g. `2026-05-21-crewtives-acme-app`). Don't relax the anchor and don't go back to `--`.

### SQLite

The state DB lives at `.janus/state.db` (gitignored). Tables: `project_metadata`, `track_lineage`, `decision_graph`, `blocker_history`, plus FTS5 virtual tables for search.

New tables or columns are a schema migration. **Open an issue first** before adding one — they need coordination because existing vaults must keep working.

## What kinds of contributions agents should make

Welcome:
- Bug fixes with a failing test.
- New `bun janus <verb>` subcommands that fit the temporal-narrative model.
- New prompt versions (always a new file).
- New `LLMRunner` adapters in `src/runners/`.
- New MCP tools in `src/mcp/server.ts` exposing data Janus already indexes.
- Cross-platform fixes — especially Linux/WSL, since macOS gets the most testing.
- Documentation improvements.

Open an issue first:
- New SQLite tables or columns.
- Changes to the `claude -p` invocation contract or the `LLMRunner` interface.
- Changes to the Wrapped output format or the temporal hierarchy.
- New external dependencies.

Generally not accepted:
- Exporters to other tools (Notion, Linear, Roam). Janus owns the narrative layer; it doesn't fan out.
- Migrations from Bun to Node. The codebase is Bun-native by design.
- AI-generated boilerplate PRs that don't address a real bug or feature.

## Non-obvious decisions

These look like oversights until you understand them. Read [docs/HANDOFF.md § Non-obvious decisions](docs/HANDOFF.md) before submitting a refactor that "fixes" any of them.

- **Per-project serialization in the queue.** `src/pipeline/orchestrator.ts` enqueues one task per project. Inside the task, dates run sequentially. `concurrency: 2` parallelizes projects, not dates. Covered by `tests/orchestrator-serial.test.ts`. Do not revert.
- **Conservative FTS5 sanitize.** `sanitizeQuery()` in `src/core/search-index.ts` only allows alphanum + spaces + `"` (phrase) + `*` (prefix wildcard). `agent-native` becomes `agent native` on purpose.
- **Async `loadVoiceSpec()` returning a sync constant.** The signature stays async because callers depend on it. Don't simplify.
- **Absolute paths in plist/service files.** launchd and systemd-user inherit a minimal PATH. `cleanEnv()` in `src/runners/util.ts` enriches it; `renderPlist()` / `renderUnits()` use `process.execPath`. Don't revert.
- **Anniversary trigger generates per-project Wrapped with `deterministicOnly: true`.** Avoids cost explosion on backfills. Idempotent.
- **Deterministic stuck-blocker hash.** `hashBlocker()` in `src/core/reflection/stuck-patterns.ts` normalizes text (lowercase, no punctuation, no wiki-links, no code) before hashing. Changing the normalization requires migrating `blocker_history`.
- **Question-preserve replaces the entire "Questions for you" block** when it detects user-written text. It does not merge field by field. Tradeoff: if the LLM rotates the questions, the previous block (with the user's answers) is preserved verbatim. Answers are sacred.
- **Puppeteer is opt-in.** `png.ts` does a dynamic `import("puppeteer")`. Not in `package.json` to avoid the ~280 MB install. If absent, the error message tells the user to `bun add -d puppeteer`.
- **Deterministic vs LLM personality.** `computePersonality()` computes numeric signals first, then asks the LLM. If the LLM fails, deterministic fallback. The Wrapped always has an archetype.
- **Trickle release window.** T-7, T-5, T-3, T-1, T-0 around Dec 31. Other days are silent. `config.wrapped.trickle.enabled = false` opts out.
- **Prompts are embedded at build time** via Bun import attributes (`with { type: "text" }`). Required so `bun build --compile` produces a working single-file binary.

## Reference docs

- [README.md](README.md) — user-facing overview.
- [CONTRIBUTING.md](CONTRIBUTING.md) — human contributor guide.
- [docs/HANDOFF.md](docs/HANDOFF.md) — the single best onboarding document. Read it before any non-trivial change.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — diagrams, technical decisions, vault layout.
- [docs/STATUS.md](docs/STATUS.md) — what's shipped per phase.
- [docs/mcp.md](docs/mcp.md) — MCP server usage.
- [docs/solutions/](docs/solutions/) — documented solutions to past problems (bugs, best practices, conventions, architecture patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas (runners, pipeline, MCP, prompts, scaffolding, init, distribution).

## Communication

- Speak in plain English in commits, PRs, and code comments.
- If a change touches the non-obvious decisions list above, write one sentence in the PR description explaining why the change is safe.
- If you're uncertain about scope, open an issue before you spend an hour coding. The maintainer would rather spend 5 minutes confirming scope than 30 minutes asking you to split a PR.
