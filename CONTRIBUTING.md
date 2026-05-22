# Contributing to Janus

Thanks for your interest. Janus is a small but ambitious tool — contributions that improve correctness, narrative quality, or developer ergonomics are very welcome. This document is the contract between you and the maintainer: read it once, then the actual work follows the patterns that already exist in the codebase.

## Before you start

- Check the [open issues](https://github.com/crewtives/janus/issues) for context on what's already being discussed.
- For non-trivial changes (new commands, new prompts, new artifact types, schema migrations), **open an issue first** describing the motivation. The maintainer will confirm scope before you spend hours on it.
- For typo fixes, doc improvements, obvious bug fixes (with a failing test that proves it): just open a PR.
- Read [docs/HANDOFF.md](docs/HANDOFF.md) — it's the single-document onboarding for any new contributor or agent. It explains the product, the phases shipped, and the non-obvious decisions you'd otherwise revert by accident.

## Local setup

Requirements:

- **[Bun](https://bun.sh) 1.3.14+** — primary runtime. `curl -fsSL https://bun.sh/install | bash`.
- **git 2.x+** — required at runtime for project birth date detection and commit aggregation.
- **[Claude Code CLI](https://claude.com/claude-code)** — only needed if you want to run real pulses end-to-end with a live LLM. Tests do NOT need it.

```bash
gh repo clone crewtives/janus
cd janus
bun install
bun test                                  # 343+ pass, ~1 s
bunx tsc --noEmit                         # silent
bun run scripts/smoke-validate-phase1.ts  # 14/14 OK
```

Optional, if you'll touch the binary distribution path:

```bash
bun run build                             # produces dist/janus (~61 MB)
./dist/janus --help
```

## The dev loop

For any change:

1. **Branch off `main`**: `git checkout -b <type>/<short-slug>` where `<type>` is one of `feat`, `fix`, `refactor`, `chore`, `docs`, `test`. Use kebab-case.
2. **Make the change**. Touch one concern per branch. Bundle related cleanup if it stays small; split if it grows.
3. **Add or update tests**. Janus has 47+ test files. Existing patterns:
   - `tests/<feature>.test.ts` — unit-level (template rendering, pure functions, SQLite ops).
   - `tests/<command>.test.ts` — command integration with mocked runners (`runnerOverride`).
   - Tests use `mkdtemp(tmpdir())` for filesystem fixtures and `Checkpoint.openInMemory()` for SQLite. Don't hit the real `~/Obsidian` vault.
4. **Run the full local gate**:
   ```bash
   bun test && bunx tsc --noEmit && bun run scripts/smoke-validate-phase1.ts
   ```
5. **Commit** using [Conventional Commits](https://www.conventionalcommits.org). Examples from the actual history:
   - `feat(notes): janus note command for portfolio drafts`
   - `fix(search): sanitizeQuery more conservative`
   - `refactor(pulse): single-dash separator in pulse filenames`
   - `docs(handoff): record CI + dash-rename session`
   - `ci: add GitHub Actions workflow for tests + typecheck + smoke`

   The convention is not enforced by a hook — yet — but PR reviewers will ask you to reword non-conforming messages before merge.
6. **Push and open a PR** against `main`. Fill the PR template. Link the issue with `Closes #N`.

## Pull request review

CI runs `bun install --frozen-lockfile`, `bunx tsc --noEmit`, `bun test`, and the smoke validation on every PR — on both `ubuntu-latest` and `macos-latest` (matrix). CI must be green before merge.

The maintainer reviews for:

- **Correctness** — does it do what the PR claims? Edge cases handled?
- **Scope** — does the change stay inside its stated goal? Unrelated refactors get pushed back ("nice but file it separately").
- **Idempotency** — every output Janus writes is idempotent. New outputs must preserve that property.
- **No-regression** — existing prompts and vault layouts are stable. Bumping a prompt version (`v7 → v8`) is fine; mutating `v7` in place is not.
- **Test coverage** — bugs need a regression test. New features need at least one test for the happy path.

Squash-merge is the default. Your commit history inside the branch can be messy; the merge commit will be clean.

## What kinds of contributions are welcome

**Welcome and likely to be merged**:
- Bug fixes with a failing test.
- New `bun janus <command>` subcommands that fit the temporal-narrative model.
- New prompt versions (always create a new file, e.g. `daily-pulse.v8.md`, never edit a shipped version).
- New runner adapters (`src/runners/`) for additional LLM providers behind the existing `LLMRunner` interface.
- New MCP tools in `src/mcp/server.ts` exposing already-indexed data.
- Documentation improvements: README clarity, ARCHITECTURE diagrams, examples.
- Cross-platform fixes (especially Linux/WSL — macOS gets the most testing).

**Discuss in an issue first**:
- New SQLite tables or columns (schema migrations need coordination).
- Changes to the `claude -p` invocation contract or the `LLMRunner` interface.
- Anything that touches the Wrapped output format or the temporal hierarchy.
- New external dependencies (Janus deliberately runs on a small dependency set — `citty`, `eta`, `@clack/prompts`, `p-queue`, `p-retry`). Adding to this list needs a strong justification.

**Generally not accepted**:
- Exporters to other tools (Notion, Linear, Roam, etc) — Janus deliberately owns the narrative layer and doesn't fan out to other knowledge bases.
- Migrations from Bun to Node.js — the codebase is Bun-native (`bun:sqlite`, `Bun.file`, `Bun.spawn`, `Bun.Glob`). Switching runtimes is a separate project, not a contribution.
- AI-generated boilerplate PRs that don't address a real bug or feature.

## Non-obvious things to know

The codebase has several deliberate design choices that look like oversights until you understand them. Before submitting a refactor that "fixes" any of these, read [docs/HANDOFF.md § Non-obvious decisions](docs/HANDOFF.md):

- Pulse filenames use a **single-dash separator** (`YYYY-MM-DD-<project>.md`). The date prefix is fixed-width (10 chars) so parsers anchor on `^\d{4}-\d{2}-\d{2}-`. Don't relax that anchor.
- Per-project serialization in the queue is intentional. Within a project, dates run sequentially; cross-project, they run concurrently.
- FTS5 sanitization is conservative on purpose. `agent-native` becomes `agent native`.
- Prompts are embedded at build time via Bun import attributes (`with { type: "text" }`). Don't reintroduce `Bun.file(promptPath).text()` — it breaks `bun build --compile`.
- The `loadVoiceSpec()` function is still async even though it returns a synchronous constant. Don't change the signature; callers depend on it.

## Reporting bugs

Open a GitHub issue using the bug-report template. Include:

- Your platform (`uname -a` on Unix, OS version on Windows/WSL).
- Bun version (`bun --version`).
- Exact command that failed.
- Full error output.
- What you expected to happen.

If you can produce a minimal repro (e.g. a synthetic vault that triggers the bug), even better.

## Reporting security issues

Do NOT open a public issue. Email `crewtives@protonmail.com` with the subject `[janus security]` and a description. See [SECURITY.md](SECURITY.md) for the full policy.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be excellent to each other.

## License

By submitting a contribution, you agree that your work is licensed under the [MIT License](LICENSE), the same license that covers the project.
