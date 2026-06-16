---
title: launchd and systemd inherit a minimal PATH that doesn't find bun, claude, or gemini
date: 2026-05-24
category: integration-issues
module: runners/util
problem_type: integration_issue
component: tooling
symptoms:
  - "Nightly `bun janus pulse` runs from launchd/systemd fail with `env: bun: No such file or directory`"
  - Subprocess spawn errors with `Executable not found in $PATH`
  - Interactive `bun janus pulse` works fine; only the scheduled run breaks
  - Logs at `.janus/logs/launchd-err.log` show the missing-bun error
root_cause: incomplete_setup
resolution_type: code_fix
severity: high
tags: [launchd, systemd, path, subprocess, env, bun, claude-code]
related_components: [core/init/launchd, core/init/systemd, runners/claude-code]
---

# launchd and systemd inherit a minimal PATH that doesn't find bun, claude, or gemini

## Problem
launchd (macOS) and systemd-user (Linux) launch processes with a minimal PATH that lacks `/opt/homebrew/bin`, `/usr/local/bin`, `~/.bun/bin`, and `~/.local/bin`. The interactive shell finds `bun`, `claude`, and `gemini` because the user's `.zshrc`/`.bashrc` enriches PATH at login. The scheduler bypasses login entirely, so binaries installed in those locations are invisible.

This bites twice: once when launchd tries to invoke `bun run bin/janus.ts pulse` (the parent process) and again when Janus spawns `claude -p` or `gemini` as a child of the already-spawned bun.

## Symptoms
- macOS: `.janus/logs/launchd-err.log` contains `env: bun: No such file or directory`
- Linux: `journalctl --user-unit janus.service` shows `bun: command not found`
- Errors only on scheduled runs; manual `bun janus pulse` works
- Subprocess errors from runners: `RunnerError: claude never emitted an 'init' message — probably did not start`

## What Didn't Work
- Hardcoding `/opt/homebrew/bin/bun` in the plist — breaks Intel Macs where bun lives at `/usr/local/bin/bun`
- Adding `<key>EnvironmentVariables</key>` to the plist with PATH — gets clobbered or merged incorrectly depending on macOS version
- Symlinking `bun` into `/usr/bin/` — requires sudo, fragile, doesn't help with claude/gemini

## Solution
Two complementary fixes.

**For the parent process (launchd/systemd → bun):** Use `process.execPath` to put the absolute path to the running bun into the plist/unit. From `src/core/init/launchd.ts:64-77`:

```ts
const bunPath = opts.bunPath ?? (typeof process !== "undefined" ? process.execPath : "");

const programArgs = bunPath && bunPath.startsWith("/")
  ? [bunPath, "run", opts.binPath, "pulse"]
  : ["/usr/bin/env", "bun", "run", opts.binPath, "pulse"];
```

`process.execPath` at install time is the absolute path to whatever bun the user just ran (`bun janus init`), so the plist always points at a bun that actually exists. This decision is documented in the docstring at lines 41–50.

**For child processes (bun → claude / gemini):** `cleanEnv()` in `src/runners/util.ts` enriches PATH at runner-spawn time. From `src/runners/util.ts:91-110`:

```ts
export function enrichPath(currentPath: string, home?: string): string {
  const segments = currentPath.split(":").filter(Boolean);
  const seen = new Set(segments);

  const candidates = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    home ? `${home}/.local/bin` : null,
    home ? `${home}/.bun/bin` : null,
    home ? `${home}/.cargo/bin` : null,
  ].filter((p): p is string => p !== null);

  for (const c of candidates) {
    if (!seen.has(c)) {
      segments.push(c);
      seen.add(c);
    }
  }
  return segments.join(":");
}
```

The enrichment is additive (preserves the original PATH at the front), never removes dirs, and is the default for `cleanEnv()` (opt-out via `enrichPath: false`).

## Why This Works
- Absolute path bypasses launchd/systemd's PATH lookup — works regardless of inherited environment
- `cleanEnv()` runs in-process before each subprocess spawn, so the child inherits an enriched PATH even when the parent inherited a minimal one
- The pattern handles both Apple Silicon (`/opt/homebrew/bin`) and Intel Mac / Linux (`/usr/local/bin`) without conditional logic

## Prevention
- Never simplify `cleanEnv()` to a plain `process.env` copy — the comment block at `src/runners/util.ts:48-60` documents why
- Never hardcode a specific Homebrew prefix — `process.execPath` is the only correct path-to-bun for plists
- New runner adapters must use `cleanEnv()` in their `Bun.spawn()` call, not a raw `process.env` reference
- AGENTS.md non-obvious decisions section mentions this; do not relax

## Related
- [LLM Runner abstraction](../architecture-patterns/llm-runner-abstraction.md)
- [Bun-native not Node](../tooling-decisions/bun-native-not-node.md)
- `src/core/init/launchd.ts` — plist generation with XML-escaping
- `src/core/init/systemd.ts` — Linux unit generation with the analogous fix
