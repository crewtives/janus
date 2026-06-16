---
title: Dev loop — bun test, bunx tsc --noEmit, smoke validate
date: 2026-05-24
category: best-practices
module: development_workflow
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - About to claim a change is done
  - Before opening a PR
  - Before pushing to main (solo flow)
  - Debugging CI failure to reproduce locally
tags: [testing, typecheck, smoke, ci, dev-loop, three-gates]
related_components: [tests, scripts/smoke-validate-phase1, ci]
---

# Dev loop — bun test, bunx tsc --noEmit, smoke validate

## Context
Janus has three local gates that must pass before a change can be claimed done. CI runs the same three on `ubuntu-latest` and `macos-latest` for every push to `main` and every PR. The cost of running them locally is < 30 seconds; the cost of pushing red is one CI cycle (~45–60 seconds) and the cognitive overhead of context-switching back. Always run all three.

## Guidance

### The three commands

```bash
bun test                                    # full test suite — must be green
bunx tsc --noEmit                           # typecheck — must be silent
bun run scripts/smoke-validate-phase1.ts    # 14 deterministic checks, no LLM
```

Typical runtimes:
- `bun test`: ~1 second for the full suite (~49 test files)
- `bunx tsc --noEmit`: ~3–5 seconds depending on cache state
- `bun run scripts/smoke-validate-phase1.ts`: ~30 seconds (includes compiled binary smoke if not skipped)

The smoke validator is the slowest because it runs a `bun build --compile` and exercises the binary end-to-end. Set `JANUS_SKIP_BINARY_SMOKE=1` to skip the compile step locally during iteration; CI does the full check.

### What each gate catches

| Gate | What it catches |
|---|---|
| `bun test` | Behavior regressions, broken contracts, idempotency violations, bad fixtures |
| `bunx tsc --noEmit` | Type drift, missing imports, removed exports still referenced elsewhere |
| `smoke-validate-phase1.ts` | Voice spec missing, prompt files unreadable, MCP tools broken, compiled binary fails on dry-run |

The smoke gate is the only one that exercises the **whole chain** (template + prompts + MCP + binary) without invoking an LLM. It catches things tests miss because tests mock the runner.

### CI mirror

`.github/workflows/ci.yml`:

```yaml
- run: bun install --frozen-lockfile
- run: bunx tsc --noEmit
- run: bun test
- run: bun run scripts/smoke-validate-phase1.ts
```

Matrix: `ubuntu-latest` + `macos-latest`, `fail-fast: false`, Bun pinned to `1.3.14`. Branch protection is deliberately NOT enabled — solo contributor pushes directly to main, CI runs post-push as a safety net.

When you push and CI fails on Linux but not local macOS, the usual culprits:
1. Platform-guard missing in a new test that calls `installPlist` or `installUnits` (see [platform-guard pattern](platform-guard-pattern.md))
2. Filesystem case sensitivity (Linux is case-sensitive, macOS is not)
3. Missing `bun.lock` commit (CI requires `--frozen-lockfile`)

### Running a subset

When iterating on a single area:

```bash
bun test tests/runners-with-fallback.test.ts          # one file
bun test --test-name-pattern "fallback"               # by name
bunx tsc --noEmit src/runners/with-fallback.ts        # one file's deps
```

But before claiming done, run the full three. A passing subset is not a passing dev loop.

### What NOT to do

- **Don't `git commit --no-verify`** to skip a pre-commit hook (there isn't one today, but the principle stands)
- **Don't ship if `bun test` is red and "it's unrelated"** — the failure is your responsibility once you've added the commit on top
- **Don't ship if typecheck has any error**, even if the runtime works — TypeScript errors degrade IDE help for the next contributor
- **Don't add `// @ts-ignore`** without a one-line comment explaining why and a link to a tracked issue

## Why This Matters
- The three gates are the cheapest signal we have. Skipping them turns CI into the dev loop and slows everyone down
- Solo flow today, multi-contributor later. Establishing the gate discipline now means contributors inherit it
- CI's job is to catch the cross-platform issues local can't see (Linux runners, fresh checkout). Local's job is to catch everything else first

## When to Apply
- Before claiming any change done — even one-line edits
- Before pushing to main
- Before opening a PR
- When debugging a CI red — reproduce locally with the same three commands first

## Examples

**Correct flow:**
```bash
# ... made edits ...
bun test && bunx tsc --noEmit && bun run scripts/smoke-validate-phase1.ts
# all green
git add -p
git commit -m "fix(runner): handle empty stderr in error wrapping"
git push
```

**Wrong flow:**
```bash
git add -A && git commit -am "fix" && git push
# CI fails 60s later; now context-switch back
```

## Related
- [Platform-guard pattern](platform-guard-pattern.md)
- [Testing no real LLM no real vault](testing-no-real-llm-no-real-vault.md)
- AGENTS.md `## The dev loop you must run` section
- `.github/workflows/ci.yml` — the CI source of truth
- `scripts/smoke-validate-phase1.ts` — the slowest gate
