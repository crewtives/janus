# CLAUDE.md

Instructions for Claude Code working on this repository. This is the Claude-specific companion to [AGENTS.md](AGENTS.md). If you're another agent (Codex, Cursor, Aider), read AGENTS.md first.

If both files exist, **AGENTS.md is the source of truth for repo conventions**. This file adds Claude-Code-specific guidance on top.

## Read first

1. [AGENTS.md](AGENTS.md) — repo map, conventions, non-obvious decisions.
2. [docs/HANDOFF.md](docs/HANDOFF.md) — the single best onboarding document. Phase 1 + 2 + 3 history, session log, gotchas.
3. [CONTRIBUTING.md](CONTRIBUTING.md) — human contributor guide, useful for the dev loop and PR review expectations.

## Claude-specific tips

### Headless `claude -p` is the LLM Janus itself calls

Janus invokes Claude Code in headless mode via `claude -p` (see `src/runners/claude-code.ts`). The runner deliberately strips `ANTHROPIC_API_KEY` from the child env so Claude uses your OAuth Max subscription instead of burning API tokens. Two consequences for you as a contributor:

- **Don't reintroduce `ANTHROPIC_API_KEY` into the spawned env.** `cleanEnv()` in `src/runners/util.ts` is the chokepoint. There's a test pinning this — `tests/runners-util.test.ts`.
- **Don't run real `claude -p` from tests.** Use `runnerOverride` to inject a fake. Real LLM calls are slow, non-deterministic, and cost money.

### Slash commands and skills that help here

- `/test` then `bun test` — fastest signal.
- `/typecheck` then `bunx tsc --noEmit` — pairs with tests.
- `ce-commit`, `ce-commit-push-pr`, `ce-code-review` from the compound-engineering skills are configured in this user's environment and work well with this repo's conventional-commits convention.
- `ce-debug` is useful when a pulse generates unexpected output — instrument the renderer, don't guess.

### When you edit prompts

Prompts are at `src/prompts/<name>.v<N>.md` and imported with Bun import attributes:

```ts
import dailyPulseV7 from "../prompts/daily-pulse.v7.md" with { type: "text" };
```

**Never edit `vN` in place.** Create `vN+1`, update the import site, leave `vN` in-tree. Old prompts are valuable: they document how the voice evolved, and they make A/B evaluation possible (see `scripts/eval-prompt-voice.ts`).

If you're unsure whether a prompt change deserves a version bump: it does. Cheap to add, expensive to retro-fit.

### When you touch the runner abstraction

`LLMRunner` interface lives in `src/runners/types.ts`. Adapters in `src/runners/{claude-code,gemini,with-fallback}.ts`. Registry in `src/runners/registry.ts`. Tests in `tests/runners-*.test.ts`.

If you change the interface, all adapters must keep compiling and all `runners-*.test.ts` must stay green. Open an issue before the PR for any interface change — see AGENTS.md § "Open an issue first".

### When you touch MCP server code

`src/mcp/server.ts` implements vanilla JSON-RPC over stdio. No external dependencies. Four tools: `janus_ask`, `janus_get_spine`, `janus_get_pulse`, `janus_list_projects`. Tests at `tests/mcp-server.test.ts`. The wire format is hand-rolled — preserve it.

### When you touch init / launchd / systemd

These are the parts that bite hardest cross-platform. `src/core/init/launchd.ts` is macOS-only and throws `assertMacOS()` on non-darwin. `src/core/init/systemd.ts` is Linux-only with the analogous guard. Tests use the per-test platform-guard pattern (`if (process.platform !== "darwin") return;`) plus one "non-darwin throws" assertion. Mirror that pattern when you add tests.

The plist and service files use **absolute paths** (`process.execPath`) and `cleanEnv()`-enriched PATH because launchd/systemd-user inherit a minimal env. Do not collapse those into shell PATH lookups.

### Wrapped is the only output that costs real money

`bun janus wrapped --year YYYY` runs multiple LLM calls (yearly, per-project, personality). The trickle release window (T-7 → T-0 around Dec 31) and the `--deterministic-only` flag exist so a backfill doesn't accidentally run the full Wrapped on every project for every past year.

- Anniversary auto-trigger uses `deterministicOnly: true` for the same reason.
- If you're iterating on Wrapped prompts, work with `--dry-run` first. It runs the aggregator + deterministic personality but writes nothing and makes no LLM calls.

### Vault writes are real side effects

The vault default is `~/Obsidian`. Tests use `mkdtemp(tmpdir())` and never touch the real vault. If you're debugging end-to-end and need to touch a real vault, point at a throwaway directory via `obsidianVault` in `config.local.json` first. There's a backup at `~/Obsidian.backup-2026-05-21-pre-phase1/` for the rollback path described in `docs/HANDOFF.md`.

## Style: how to write code in this repo

- **Bun idioms, not Node.** `bun:sqlite`, `Bun.file`, `Bun.spawn`, `Bun.Glob`. Don't import `fs/promises` if a Bun equivalent exists.
- **Pure core, plumbed commands.** Business logic in `src/core/`, CLI plumbing in `src/commands/`. A `src/commands/<verb>.ts` file is short — it parses flags and calls into `src/core/`.
- **Types live with the code.** `src/types/` is for shared cross-cutting types only. Prefer co-located types.
- **No comments that restate the code.** Comments should explain *why* — the surprising constraint, the past incident, the workaround. The non-obvious decisions in AGENTS.md / docs/HANDOFF.md are good examples of comment-worthy reasoning. Don't paraphrase identifiers.
- **No new files unless needed.** Edit existing files where possible. New top-level docs need a real reason.
- **No emoji in code or commits** unless the user asks for them. The narrative voice is reserved, not cheerful.

## Style: how to communicate in PRs

- Lead with what the change *does*, not what files moved. Reviewers can read the diff.
- Call out anything that touches a non-obvious decision (AGENTS.md tail). One sentence is enough.
- Link the issue with `Closes #N` if there is one.
- The PR template in `.github/PULL_REQUEST_TEMPLATE.md` is intentionally short. Fill it; don't expand it.

## When in doubt

- If the change is non-trivial, read `docs/HANDOFF.md` first — it's the densest context per token in the repo.
- If you're about to add a dependency, write a SQLite migration, or change a prompt's shape in a way that breaks the previous version: stop and open an issue.
- If a test starts flaking, treat it as a real bug. Janus tests are deterministic. Flakes mean a real-clock dependency, a non-deterministic fixture, or a leaked global.
