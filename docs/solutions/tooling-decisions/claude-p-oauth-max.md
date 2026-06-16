---
title: claude -p headless with OAuth Max — strip ANTHROPIC_API_KEY, no API costs
date: 2026-05-24
category: tooling-decisions
module: runners/claude-code
problem_type: tooling_decision
component: tooling
severity: high
applies_when:
  - Reviewing changes to `src/runners/util.ts` or the claude-code adapter
  - Adding a new runner that should reuse the user's Claude Max subscription
  - Debugging why `claude -p` is suddenly billing API tokens
  - Considering whether to introduce `ANTHROPIC_API_KEY` somewhere for testing
tags: [claude-code, oauth, max-subscription, anthropic-api-key, headless, environment, llm-runner]
related_components: [runners/claude-code, runners/util]
---

# claude -p headless with OAuth Max — strip ANTHROPIC_API_KEY, no API costs

## Context
Janus runs nightly across multiple projects. With Anthropic API tokens, this would be ~$5–$30/day depending on backfill volume — misaligned with "personal agent for makers". The chosen path is `claude -p` headless using the user's Claude Max OAuth subscription, which they already pay for once. The mechanism that makes this work: `cleanEnv()` strips `ANTHROPIC_API_KEY` from the subprocess env before spawn, forcing the CLI to fall back to its OAuth-stored credentials.

## Guidance

### The chokepoint

`src/runners/util.ts:61` defines `cleanEnv()`. The claude-code adapter calls it at spawn time:

```ts
// src/runners/claude-code.ts:41
const env = cleanEnv(process.env, ["ANTHROPIC_API_KEY"]);
```

`cleanEnv()` copies `process.env`, drops the listed keys, and enriches PATH (see [launchd minimal PATH](../integration-issues/launchd-systemd-minimal-path.md)). The dropped key is what forces OAuth: if `ANTHROPIC_API_KEY` is set in the parent env (because a developer has it in their shell rc, or CI exports it for unrelated reasons), the child `claude` process would prefer it over the OAuth-stored Max credentials and bill API tokens. Stripping it removes the choice.

The test `tests/runners-util.test.ts` pins this — it asserts the key is removed and that other env values pass through.

### Where the OAuth credentials live

Claude Max stores its OAuth tokens in the macOS Keychain (`security` API). The `claude` CLI reads them at startup. Janus never sees them, never persists them, never logs them. Janus only reads `process.env` (which lacks the OAuth tokens) and passes a cleaned copy to the subprocess.

This is why `bun janus doctor` checks `claude auth status` — verifies the Keychain has Max credentials, separately from any API key in env.

### Why `--bare` was rejected

An early proposal added `--bare` to the spawn args. `--bare` disables OAuth/keychain authentication entirely, so the CLI would fall back to `ANTHROPIC_API_KEY` (which we just stripped) and crash with no credentials. Caught before shipping. The trade-off: without `--bare`, the subprocess loads the global `CLAUDE.md` (the user's `~/.claude/CLAUDE.md`). Accepted, because Janus prompts are self-contained and don't conflict with user-level instructions.

### Why `--max-budget-usd` is a kill-switch, not cost control

`--max-budget-usd` was proposed at $5 per run. With a Max subscription, the budget is not real dollars — it's a quota burndown approximation. Kept as a runaway kill-switch (LLM gets stuck in a loop, eats the entire daily quota), not as cost control. Current value is set per-call in `RunOptions` if the adapter exposes it; not enforced at the orchestrator level today.

### Adapter responsibility

Every runner must either strip `ANTHROPIC_API_KEY` (Anthropic-based adapters) or document that it doesn't apply (Gemini, Qwen, etc.). The pattern is per-adapter, not in the wrapper, because the relevant variable name is provider-specific.

## Why This Matters
- Janus's economic model depends on zero per-call billing. A regression that re-introduces `ANTHROPIC_API_KEY` to the spawned env could rack up hundreds of dollars in a single backfill
- The test `tests/runners-util.test.ts` is the structural defense — do not relax
- Future contributors will copy-paste the adapter pattern; the comment block at `src/runners/util.ts:48-60` explains the rationale so they don't simplify the function

## When to Apply
- Always for `claude -p` invocations
- When adding a new adapter that wraps a CLI with an API-key fallback (Gemini has `GEMINI_API_KEY`, Codex has `OPENAI_API_KEY`) — decide explicitly whether your adapter should prefer subscription auth over API tokens, and document the choice in the adapter file
- Doctor / smoke checks must verify the auth shape the runtime actually uses (e.g., `claude auth status`, not `echo $ANTHROPIC_API_KEY`)

## Examples

**Correct:**
```ts
const env = cleanEnv(process.env, ["ANTHROPIC_API_KEY"]);
const proc = Bun.spawn(["claude", ...args], { env, ... });
```

**Wrong — passes raw env, may bill API tokens:**
```ts
const proc = Bun.spawn(["claude", ...args], { env: process.env, ... });
```

**Wrong — would force API token usage instead of OAuth:**
```ts
const env = { ...process.env, ANTHROPIC_API_KEY: "sk-..." };
```

## Related
- [LLM Runner abstraction](../architecture-patterns/llm-runner-abstraction.md)
- [Claude -p prompt via stdin](../runtime-errors/claude-p-prompt-via-stdin.md)
- [launchd minimal PATH](../integration-issues/launchd-systemd-minimal-path.md)
- AGENTS.md non-obvious decisions section
- `src/runners/claude-code.ts:24-33` — docstring summarizing all four behaviors
- `tests/runners-util.test.ts` — pins the strip behavior
