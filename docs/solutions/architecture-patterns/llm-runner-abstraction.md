---
title: LLMRunner abstraction — neutral contract for CLI agents with capability flags
date: 2026-05-24
category: architecture-patterns
module: runners
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - Adding a new LLM provider (Qwen Code, Codex CLI, local model wrapper)
  - Changing how prompts are sent, how output is parsed, or how fallback works
  - Reviewing PRs that touch any `src/runners/*.ts` file
  - Reasoning about why a specific behavior lives in the adapter vs the orchestrator
tags: [llm-runner, abstraction, capabilities, adapter-pattern, fallback, redaction]
related_components: [runners/claude-code, runners/gemini, runners/with-fallback, runners/redacting, runners/registry]
---

# LLMRunner abstraction — neutral contract for CLI agents with capability flags

## Context
Janus invokes a coding-agent CLI in headless mode (`claude -p`, `gemini`, etc.) and gets back a single response text. The orchestrator should not care which CLI is on the other end. The `LLMRunner` abstraction (`src/runners/types.ts`) is the neutral contract: every adapter implements `run(opts: RunOptions): Promise<RunResult>` plus a static `capabilities` flag set. The factory in `src/runners/registry.ts` (`resolveRunner(config)`) builds the chain primary → fallback wrapper → redaction wrapper, and returns the single runner instance the orchestrator uses.

## Guidance

### The four-piece stack

`resolveRunner()` returns one `LLMRunner` per config. Three composable layers wrap the base adapter:

1. **Base adapter** (`ClaudeCodeRunner`, `GeminiRunner`): one class per CLI, implements `LLMRunner`.
2. **`withFallback(primary, secondary)`**: optional. Wraps the base when `config.fallbackProvider` differs from `config.provider`. Hybrid logic — defers to native CLI fallback when the primary supports it, else catches `retriable` errors and retries with the secondary.
3. **`redactingRunner(base, opts)`**: applied unless `config.privacy.enabled === false`. Runs `redact()` on `opts.prompt` before delegating. Single chokepoint — callers cannot bypass redaction even if they forget.

The order matters: redaction wraps the (possibly-fallback-wrapped) base. The redacted prompt is what the CLI sees.

### Capability flags, not LCD

`RunnerCapabilities` declares what each adapter supports:

```ts
export interface RunnerCapabilities {
  sessionResume: boolean;     // accepts sessionId, returns sessionId
  effortControl: boolean;     // maps low/medium/high/xhigh/max
  costTracking: boolean;      // reports USD in result
  addDirs: boolean;           // exposes extra dirs to the agent
  jsonStream: boolean;        // parseable line-by-line stream
  disableTools: boolean;      // can force text-only output
  fallbackModel: boolean;     // accepts native --fallback-model
}
```

The orchestrator does not collapse to LCD. Call sites pass `RunOptions` with optional fields (`effort`, `fallbackModel`, `addDirs`); adapters whose capabilities flag is `false` simply ignore those fields. New adapters declare honestly what they support.

Today's matrix:

| Capability | ClaudeCodeRunner | GeminiRunner |
|---|---|---|
| sessionResume | ✓ | ✓ |
| effortControl | ✓ | — |
| costTracking | ✓ | ✓ |
| addDirs | ✓ | — |
| jsonStream | ✓ | ✓ |
| disableTools | ✓ | — |
| fallbackModel | ✓ | — |

Janus's pulse generation requires `disableTools: true` (see [LLM subprocess Write tool corruption](../runtime-errors/llm-subprocess-write-tool-corruption.md)). An adapter without it cannot be used for pulses today.

### `RunnerError.retriable` is the only retry signal

The orchestrator's retry loop and `withFallback` both consult `err.retriable`. Adapters classify their own exit codes:

- Overload, rate-limit, network drop → `retriable: true`
- Auth missing, invalid input, exit code 1, `init` never seen → `retriable: false`

`ClaudeCodeRunner.run()` sets `retriable = (exitCode !== 1)` plus a hard `false` if the init message never arrived (CLI not installed / not authenticated). Other adapters follow the same pattern.

### Prompt always via STDIN

Universal across CLIs and avoids argv size limits. See [claude-p prompt via stdin](../runtime-errors/claude-p-prompt-via-stdin.md) for the failure mode that pinned this decision.

## Why This Matters
- Without capability flags, you either restrict the interface to the LCD (losing the strong-adapter features Janus actually uses) or pollute every call site with provider checks. Capability flags let the orchestrator stay neutral while adapters stay honest about their reach.
- Wrapping redaction in `resolveRunner()` makes privacy a structural property, not a discipline. The `redactingRunner` decorator preserves the underlying `id` and `capabilities` so callers can't tell they're talking to a wrapper.
- The `withFallback` hybrid (delegate to CLI when possible, wrap when not) avoids re-spawning subprocesses unnecessarily — important when each spawn is a Claude Max session.

## When to Apply
- Always go through `resolveRunner(config, repoRoot?)` — never instantiate adapters directly except in tests
- New adapter: implement `LLMRunner`, declare capabilities, classify retriability, send prompt via STDIN, parse output without leaking adapter-specific shape into `RunResult`
- New capability flag: add it to `RunnerCapabilities`, default to `false` in existing adapters, update the matrix in this doc

## Examples

**Resolve once, reuse:**
```ts
const runner = resolveRunner(config);
const result = await runner.run({
  prompt,
  cwd: project.repoPath,
  model: config.model,
  effort: config.effort,
  fallbackModel: config.fallbackModel,
  addDirs: [project.obsidianPath],
  sessionId,
  maxTurns: 30,
  timeoutMs: config.taskTimeoutMs,
});
```

The orchestrator in `src/pipeline/orchestrator.ts:388-400` does exactly this. `addDirs` is harmless for adapters that don't support it (Gemini ignores it).

**Testing — never spawn real CLIs:**
Tests use `runnerOverride: LLMRunner` to inject a fake. The fake returns deterministic `RunResult`. See [Testing patterns](../best-practices/testing-no-real-llm-no-real-vault.md).

## Related
- [Claude -p with OAuth Max](../tooling-decisions/claude-p-oauth-max.md)
- [Claude -p prompt via STDIN](../runtime-errors/claude-p-prompt-via-stdin.md)
- [LLM subprocess Write tool corruption](../runtime-errors/llm-subprocess-write-tool-corruption.md)
- `src/runners/types.ts` — the interface itself
- `tests/runners-registry.test.ts`, `tests/runners-with-fallback.test.ts`, `tests/runners-redacting.test.ts` — pin the contract
