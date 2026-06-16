---
title: Platform-guard pattern for launchd (macOS-only) and systemd (Linux-only) tests
date: 2026-05-24
category: best-practices
module: tests/init
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - Adding a test for code that calls `installPlist`, `installUnits`, or any other macOS- or Linux-only function
  - Diagnosing a CI failure where five `installPlist` tests fail on Linux runners
  - Reviewing a PR that touches `src/core/init/launchd.ts` or `src/core/init/systemd.ts`
  - Adding a new scheduler adapter for another platform (FreeBSD, Windows)
tags: [tests, platform, launchd, systemd, ci, cross-platform, assertion]
related_components: [core/init/launchd, core/init/systemd, tests/init-launchd, tests/init-systemd]
---

# Platform-guard pattern for launchd (macOS-only) and systemd (Linux-only) tests

## Context
Janus has platform-specific scheduler code: `src/core/init/launchd.ts` is macOS-only and throws `assertMacOS()` from each public function; `src/core/init/systemd.ts` is Linux-only with the analogous guard. When CI matrix runs `ubuntu-latest` + `macos-latest`, the launchd tests must skip on Linux (the functions throw at module load) and the systemd tests must skip on macOS. The pattern is: early-return per test plus one explicit "non-darwin throws" assertion at the bottom of each file. This was caught when the first CI run failed five `installPlist` tests on the Linux runner.

## Guidance

### The pattern

```ts
// tests/init-launchd.test.ts
import { test, expect } from "bun:test";
import { installPlist, renderPlist, ... } from "../src/core/init/launchd.ts";

test("renderPlist contains the absolute bun path", () => {
  if (process.platform !== "darwin") return;  // <-- early return on non-darwin
  const xml = renderPlist({ binPath: "/repo/bin/janus.ts", repoPath: "/repo" });
  expect(xml).toContain(process.execPath);
});

test("installPlist writes the plist to ~/Library/LaunchAgents", () => {
  if (process.platform !== "darwin") return;
  // ... rest of test
});

// ... more tests, each starting with the early-return guard

// One last test that asserts the guard itself works on the wrong platform
test("installPlist throws on non-darwin", () => {
  if (process.platform === "darwin") return;
  expect(() => installPlist({ ... })).toThrow(/macOS-only|launchd/i);
});
```

The mirror exists in `tests/init-systemd.test.ts`:

```ts
test("installUnits throws on non-linux", () => {
  if (process.platform === "linux") return;
  expect(() => installUnits({ ... })).toThrow(/Linux-only|systemd/i);
});
```

### Why early-return, not test-skip

Bun's test framework has a `test.skipIf(cond)` but the early-return form is preferred here because:
- It's universal: works in `bun test`, `node --test`, vitest, jest — no framework-specific API
- It's visually obvious: the first line of the test body is the platform check
- It composes with conditional setup (e.g., create a temp dir only on the matched platform) without needing `beforeEach.skipIf`

`bun test` does report the test as "passed" rather than "skipped" when the early-return fires. This is acceptable — the test ran, it just had no assertions to check. The "throws on non-darwin" assertion at the bottom is what gives us positive coverage that the guard exists at all.

### What this pattern catches

The CI first-run failure: `tests/init-launchd.test.ts` ran on the Linux runner, called `installPlist(...)`, which called `assertMacOS()`, which threw. Five test files fell over. The fix was to apply the pattern uniformly (not just to one or two tests where it was easy to remember).

### When to apply the pattern

Apply the early-return guard:
- Every test file in `tests/init-*` that imports from a platform-specific module
- Any new test that calls a function known to throw on the wrong platform
- Helper functions consumed by such tests (e.g., a helper that builds a fake plist path)

Don't apply the guard to:
- Tests that exercise platform-agnostic logic (`tests/init-detect.test.ts`, `tests/init-config-merge.test.ts`, `tests/init-scheduler.test.ts` for the cross-platform dispatcher)
- Renderer-only tests that produce a string and don't call `installPlist` / `installUnits` (the renderer itself is pure and platform-agnostic; only the install action requires the platform check)

### The dispatcher pattern (cross-platform layer)

`src/core/init/scheduler.ts` is the cross-platform entry point. It detects platform and delegates to either `installPlist` or `installUnits`. Tests for the dispatcher should:
- Mock the platform via dependency injection if possible
- Or test only the dispatch decision (which function it routed to), not the side effects

`src/core/init/scheduler.ts` is the place to add a third platform if needed (FreeBSD's `cron`, Windows Task Scheduler). Don't add an `assertMacOS()` shape to scheduler — keep the platform branching in the dispatcher, not in the leaf modules' callers.

## Why This Matters
- CI is the ultimate cross-platform check. Local macOS development hides Linux-only failures; the platform-guard pattern is what makes the Linux CI run useful instead of red-by-default
- Tests should never throw "wrong platform" errors when run on a non-matching platform — that's noise, not signal
- The "throws on non-X" assertion at the bottom is the structural defense: if the guard is removed from the source, the test catches it

## When to Apply
- Every test for `src/core/init/launchd.ts` → guard `if (process.platform !== "darwin") return;`
- Every test for `src/core/init/systemd.ts` → guard `if (process.platform !== "linux") return;`
- Add the "throws on non-platform" test at the bottom of each file
- Don't gate tests for `src/core/init/scheduler.ts` (the cross-platform dispatcher) — its job is to route correctly on any platform

## Examples

**Correct (current `tests/init-launchd.test.ts`):**
```ts
test("renderPlist escapes special XML characters", () => {
  if (process.platform !== "darwin") return;
  const xml = renderPlist({ binPath: "/repo&path/bin/janus.ts", ... });
  expect(xml).toContain("&amp;");
  expect(xml).not.toContain("&path");
});

test("installPlist throws on non-darwin", () => {
  if (process.platform === "darwin") return;
  expect(() => installPlist({ ... })).toThrow();
});
```

**Wrong (causes CI red on Linux):**
```ts
test("renderPlist escapes special XML characters", () => {
  // No platform guard
  const xml = renderPlist({ binPath: "/repo&path/bin/janus.ts", ... });
  // This call is fine — renderPlist is pure. But if a test calls installPlist
  // without a guard, it throws on Linux and the suite fails.
});
```

## Related
- [Dev loop three gates](dev-loop-three-gates.md)
- [Testing patterns](testing-no-real-llm-no-real-vault.md)
- [launchd minimal PATH](../integration-issues/launchd-systemd-minimal-path.md)
- AGENTS.md `### Tests` section, last bullet
- `tests/init-launchd.test.ts`, `tests/init-systemd.test.ts` — canonical examples
- `docs/HANDOFF-CI-DISTRIBUTION.md` decision log entry for 2026-05-22 — first CI failure that pinned the pattern
