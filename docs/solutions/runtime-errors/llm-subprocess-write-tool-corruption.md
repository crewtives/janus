---
title: claude -p subprocess writes corrupt 328-byte pulse summaries instead of returning markdown
date: 2026-05-24
category: runtime-errors
module: runners/claude-code
problem_type: runtime_error
component: tooling
symptoms:
  - Pulse files on disk are ~328 bytes when they should be 3–8 KB
  - Pulse content looks like a meta-summary ("I will write a pulse about X...") instead of the actual narrative
  - Subprocess exits 0, `cp.markDone()` runs, no error surfaced
  - State DB says success, vault content is garbage
root_cause: config_error
resolution_type: config_change
severity: critical
tags: [claude-code, subprocess, tools-flag, prompt-engineering, llm-runner]
related_components: [pipeline/orchestrator, prompts/daily-pulse]
---

# claude -p subprocess writes corrupt pulse summaries instead of returning markdown

## Problem
When `claude -p` is spawned without `--tools ""`, the subprocess has full tool access. The LLM detects a file path mentioned in the prompt (e.g. the target pulse file) and decides to call its own `Write` tool to create the file directly. It then returns a brief "result text" that summarizes what it would write — not the actual content. Janus's `writePulse()` overwrites the agent-written file with this ~328-byte summary, corrupting the output.

The state DB marks the run as done. The exit code is 0. Nothing alerts the operator. Detected only by inspecting actual file sizes after the fact.

## Symptoms
- File size of `<vault>/Projects/<name>/pulse/YYYY-MM-DD-<name>.md` is ~328 bytes (instead of typical 3–8 KB)
- Content reads like a third-person agent narration: "I will create a pulse describing..."
- `bun janus pulse` reports `✓ written` for every project
- No errors in `.janus/failed.jsonl`

## What Didn't Work
- Validating output length post-hoc — `validatePulse()` in `src/core/validate-pulse.ts` catches some malformed output but a 328-byte summary passes a length-only check
- Telling the prompt "do not write files, only return text" — the LLM agreed, then wrote the file anyway because Write was still available
- Trusting subprocess exit code — exit 0 doesn't mean the result text is the pulse

## Solution
Disable all tools at the CLI level. From `src/runners/claude-code.ts:151-172`:

```ts
const args: string[] = [
  "-p",
  "--output-format", "stream-json",
  "--verbose",
  "--max-turns", String(opts.maxTurns ?? 30),
  "--permission-mode", permissionMode,
  "--session-id", sessionId,
  // Disables ALL tools — the agent must return the markdown as the final
  // result text, instead of using Write/Edit/Bash to write the file itself.
  // Without this, claude detects a path in the prompt and uses Write, leaving
  // our writePulse() to overwrite later with the "result text" (which is
  // a summary of the pulse, not the pulse itself).
  "--tools", "",
];
```

The capability is declared in `CAPABILITIES.disableTools = true` (line 12 of the same file), which is part of the LLM Runner contract — adapters whose CLI doesn't support tool disabling cannot be used here without a wrapper.

## Why This Works
`--tools ""` strips the tool list passed to the agent, so it has no `Write`, `Edit`, `Bash`, or `Read` available. With no way to write a file, the LLM has only one channel for output: the result text emitted in the `result` message of the stream-json protocol. The orchestrator captures this as `claudeResult.resultText`, validates it, and `writePulse()` writes the actual content.

The prompt instruction ("return markdown only") is a belt-and-suspenders measure but is **not load-bearing** — the CLI flag is what enforces the behavior. Removing the flag and keeping the prompt instruction reproduces the bug.

## Prevention
- Never relax `--tools ""` in `buildArgs()` — the comment at line 160-164 explains why; do not remove it
- New runners must support `disableTools` capability (`RunnerCapabilities.disableTools: true` in `src/runners/types.ts`) before they can be used for pulse generation
- Test fixture: `runnerOverride` in command tests must return resultText, never write files itself, to keep test behavior aligned with production

## Related
- [LLM Runner abstraction](../architecture-patterns/llm-runner-abstraction.md)
- [Pulse via stdin](claude-p-prompt-via-stdin.md)
- `src/core/validate-pulse.ts` — catches malformed output but does NOT catch the tiny-summary case
