---
title: claude -p hangs silently with large prompts passed via argv
date: 2026-05-24
category: runtime-errors
module: runners/claude-code
problem_type: runtime_error
component: tooling
symptoms:
  - "`claude -p` subprocess hangs for 13+ minutes with ~1.1s CPU time"
  - No stdout, no stderr, no error message — subprocess just sits there
  - Pulses for projects with rich context (~13 KB prompts) never complete
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [claude-code, subprocess, stdin, llm-runner, bun-spawn]
related_components: [pipeline/orchestrator, runners/util]
---

# claude -p hangs silently with large prompts passed via argv

## Problem
The first working implementation of the Claude runner passed the rendered prompt as a positional argument to `claude -p`. Prompts of ~13 KB (Janus's typical pulse context: voice spec + git diff + sessions + previous pulses + roadmap) caused the subprocess to hang silently — 13 minutes wall, ~1.1s CPU — never returning output, never failing.

## Symptoms
- `bun janus pulse --project <name>` blocks indefinitely on a single project
- `ps` shows `claude -p ...` with the full prompt visible in the argv (sometimes truncated)
- No init message, no result, no exit code
- Killing the parent leaves orphan `claude` processes

## What Didn't Work
- Increasing `taskTimeoutMs` — the subprocess never makes progress, more time doesn't help
- Retrying the same call — argv-passed prompts of this size hang every time, not intermittently
- Stripping ANSI/special characters from the prompt — size is the trigger, not content

## Solution
Pass the prompt via STDIN. The current implementation in `src/runners/claude-code.ts:45-58`:

```ts
const proc = Bun.spawn(["claude", ...args], {
  cwd: opts.cwd,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  env,
  timeout: opts.timeoutMs ?? 30 * 60_000,
  killSignal: "SIGTERM",
});

const stdin = proc.stdin;
if (!stdin) throw new Error("Bun.spawn did not return a stdin pipe");
stdin.write(opts.prompt);
await stdin.end();
```

Note that `buildArgs()` in the same file (lines 151–172) never appends the prompt to argv. `args` is purely flags (`-p`, `--output-format`, `--model`, etc.).

The Gemini adapter (`src/runners/gemini.ts`) follows the same convention — prompt via STDIN, never argv — for the same reason.

## Why This Works
`claude -p` reads from STDIN when invoked without a positional prompt argument. Argv has a documented size limit (`ARG_MAX`, typically 256 KB on macOS / 2 MB on Linux), but well below that, large argv values interact poorly with shell argv parsing inside the CLI, producing the observed hang. Piping via STDIN sidesteps both the size limit and the CLI's argv-parsing path.

## Prevention
- Never reintroduce a positional prompt argument to `claude` or `gemini` adapters
- New `LLMRunner` adapters must follow the STDIN convention — document it in `src/runners/types.ts` if a future adapter has a different shape
- The contract is asserted in `src/runners/claude-code.ts:30` comment block: "Prompt via STDIN (avoids argv size limit)" — do not remove this comment

## Related
- [LLM Runner abstraction](../architecture-patterns/llm-runner-abstraction.md)
- [Claude -p with OAuth Max](../tooling-decisions/claude-p-oauth-max.md)
- `src/runners/types.ts` — `LLMRunner` interface declares `prompt: string` in `RunOptions`, callers send via STDIN at the adapter level
