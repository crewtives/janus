---
title: Tests never spawn real claude/gemini and never touch the real Obsidian vault
date: 2026-05-24
category: best-practices
module: tests
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - Writing any new `tests/*.test.ts`
  - Reviewing a PR that adds or modifies a test
  - Debugging a flaky test (the flakiness is almost certainly a real-world dependency that snuck in)
  - Considering a "quick integration test" that calls an external CLI
tags: [testing, fixtures, mocks, runner-override, mkdtemp, in-memory-sqlite, hermetic-tests]
related_components: [tests, runners, core/checkpoint, core/obsidian]
---

# Tests never spawn real claude/gemini and never touch the real Obsidian vault

## Context
Janus's tests are deterministic, fast, and hermetic. Three rules enforce this:
1. **No real LLM calls.** Tests inject a `runnerOverride: LLMRunner` to return fixed responses
2. **No production vault writes.** Tests use `mkdtemp(tmpdir())` for filesystem fixtures
3. **No production SQLite.** Tests use `Checkpoint.openInMemory()` for state-DB fixtures

Breaking any of these turns the test suite into something slow, expensive, and unreliable. The cost of a flaky test is hours of debugging the test instead of the bug it should have caught.

## Guidance

### Rule 1: `runnerOverride` for any code that calls an LLM

Commands that touch the runner (`pulse`, `rollup`, `monthly`, `wrapped`, `note`, etc.) accept an optional `runnerOverride: LLMRunner` parameter for tests. The fake runner returns deterministic `RunResult` objects:

```ts
const fakeRunner: LLMRunner = {
  id: "fake",
  capabilities: ALL_TRUE_CAPS,
  async run({ prompt }) {
    return {
      sessionId: "fake-session",
      resultText: FIXTURE_PULSE,
      totalCostUsd: null,
      durationMs: 0,
      numTurns: 1,
      exitCode: 0,
    };
  },
};

await runPulse({ ..., runnerOverride: fakeRunner });
```

Tests can assert what prompt was passed by capturing `runOpts.prompt` inside the fake. They can simulate retriable failures by throwing `RunnerError(...)` with `retriable: true`.

There is **never** a `claude` or `gemini` binary call in a test. Tests that need to exercise the real runner (smoke validation, manual integration) live in `tests/*-smoke.ts` (not `.test.ts`) and are run by hand or in `scripts/smoke-validate-phase1.ts`.

### Rule 2: `mkdtemp(tmpdir())` for filesystem fixtures

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "janus-test-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});
```

Every filesystem-touching test creates its own throwaway directory. The path is unique per test. Never write to `~/Obsidian` or `process.env.HOME` in a test.

If you're debugging end-to-end against a real vault, point `obsidianVault` at a throwaway directory in `config.local.json` — don't change the test convention.

### Rule 3: `Checkpoint.openInMemory()` for SQLite fixtures

```ts
import { Checkpoint } from "../src/core/checkpoint.ts";

const cp = Checkpoint.openInMemory();
cp.markDone({ project: "demo", date: "2026-05-21", outputPath: "/fake" });
expect(cp.isDone("demo", "2026-05-21")).toBe(true);
cp.close();
```

The in-memory mode uses bun:sqlite's `":memory:"` database — fast, isolated, no disk IO. Tests never touch `.janus/state.db`.

### Platform-specific tests use early-return guards

See [platform-guard pattern](platform-guard-pattern.md). Tests for launchd code skip on non-darwin and assert non-darwin throws. Tests for systemd code skip on non-linux.

### Smoke tests are NOT regular tests

Files in `tests/` with `-smoke` in their name (e.g., `tests/claude-smoke.ts`, `tests/discord-smoke.ts`, `tests/claude-bigprompt-smoke.ts`) are NOT picked up by `bun test`. They are manual integration checks that DO call real binaries, real webhooks, real LLMs. Run them by hand:

```bash
bun run tests/claude-smoke.ts
```

The `.ts` extension instead of `.test.ts` is the convention — `bun test` only matches `*.test.ts`.

### Mock data lives next to the test

Test fixtures (JSON, markdown samples) live in the same file as the test using them, inline as string constants. Avoid separate fixture files unless the data is genuinely large (> 50 lines). Inline fixtures are easier to update with the test that uses them.

## Why This Matters
- Test suite runs in ~1 second. A real-LLM test would add 30+ seconds per run, breaking the dev loop
- Real LLM calls cost money and depend on network — tests would be expensive and flaky
- Hermetic tests can be re-run in any order, on any machine, by any contributor — no shared global state
- A test that touches `~/Obsidian` could corrupt the user's actual vault on a botched run

## When to Apply
- Always. There is no carve-out for "just this one integration test"
- New command file that calls the runner: thread `runnerOverride?` through to the orchestrator
- New filesystem-touching code: write the test with `mkdtemp` from day one
- New SQLite-touching code: write the test with `Checkpoint.openInMemory()` from day one

## Examples

**Correct: runner override**
```ts
import { test, expect } from "bun:test";

test("runPulse uses the override runner", async () => {
  const calls: string[] = [];
  const fake: LLMRunner = {
    id: "fake",
    capabilities: ALL_TRUE_CAPS,
    async run({ prompt }) {
      calls.push(prompt.slice(0, 50));
      return { sessionId: "s", resultText: FIXTURE, totalCostUsd: null, durationMs: 0, numTurns: 1, exitCode: 0 };
    },
  };
  await runPulse({ ..., runnerOverride: fake });
  expect(calls).toHaveLength(1);
});
```

**Wrong: spawning real claude**
```ts
test("integration", async () => {
  const result = await Bun.spawn(["claude", "-p", "..."]);  // NO — never in tests
  expect(result).toBeDefined();
});
```

**Wrong: touching the real vault**
```ts
test("write pulse", async () => {
  await writePulse({ obsidianPath: "/Users/me/Obsidian/Projects/janus", ... });
  // NO — would write to the real vault if I ran this with $HOME set
});
```

## Related
- [Dev loop three gates](dev-loop-three-gates.md)
- [Platform-guard pattern](platform-guard-pattern.md)
- [LLM Runner abstraction](../architecture-patterns/llm-runner-abstraction.md)
- AGENTS.md `### Tests` section — the rules
- `tests/orchestrator-serial.test.ts` — example of all three rules applied
- `tests/checkpoint.test.ts` — example of `openInMemory()` usage
