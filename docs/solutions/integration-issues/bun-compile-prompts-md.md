---
title: bun build --compile fails to bundle .md prompt files
date: 2026-05-24
category: integration-issues
module: prompts
problem_type: integration_issue
component: tooling
symptoms:
  - "`ENOENT: no such file or directory, open '/$bunfs/prompts/_voice.md'`"
  - "`bun build --compile` produces a binary that runs `--help` and `wrapped --dry-run` but crashes on `pulse --dry-run`"
  - The compiled binary fails any code path that reads a prompt file at runtime
  - Failure is silent during build, only surfaces at runtime in the compiled binary
root_cause: missing_tooling
resolution_type: code_fix
severity: high
tags: [bun, compile, distribution, prompts, import-attributes, single-file-binary]
related_components: [prompts, core/template, runners]
---

# bun build --compile fails to bundle .md prompt files

## Problem
`bun build --compile` bundles JS/TS modules into a single executable mounted at `/$bunfs`, but it does **not** walk the source tree for arbitrary `.md` files read via `Bun.file(path).text()`. Every prompt loader call (`PROMPT_DIR = join(import.meta.dir, "..", "prompts")`) resolves to a `/$bunfs/prompts/...` path that doesn't exist inside the binary, crashing the first time the runner needs a prompt.

## Symptoms
- Build succeeds in ~200ms: `bun build bin/janus.ts --compile --outfile dist/janus` → 61 MB macOS arm64 Mach-O
- `./dist/janus --help` works (lists 17 subcommands)
- `./dist/janus wrapped --year 2026 --dry-run` works (exercises ~10 dynamic imports + SQLite vault index)
- `./dist/janus pulse --dry-run --project <name>` fails with `ENOENT: ... /$bunfs/prompts/_voice.md`
- Same failure for any command that touches `loadVoiceSpec()`, `renderDailyPulsePrompt()`, monthly, weekly, spine, notes, wrapped-personality, anchors, trickle

## What Didn't Work
- Shipping `prompts/` next to the binary and resolving relative to `process.execPath` — kills the single-file distribution model, defeating the purpose
- Adding `--external "*.md"` to the build — Bun's `--compile` doesn't accept it
- `Bun.file()` with absolute paths under the binary's working directory — `process.cwd()` at runtime is wherever the user ran the binary from, not the build dir

## Solution
Embed prompts at build time using Bun import attributes. The pattern (`src/prompts/_voice.md` → consumed by `src/core/template.ts`):

```ts
// Old (breaks --compile):
const voiceSpec = await Bun.file(join(PROMPT_DIR, "_voice.md")).text();

// New (works in --compile and in dev):
import voiceSpec from "../prompts/_voice.md" with { type: "text" };
```

The `with { type: "text" }` attribute tells Bun's bundler to read the file at build time and inline it as a string constant in the compiled module. No runtime IO, no `/$bunfs` path resolution needed.

This was shipped in commit `cde8c0f feat(distribution): embed prompts so bun build --compile works (#4)`. The current `import ... with { type: "text" }` call sites (verify with `grep -rn 'with { type: "text" }' src/`):

| File | Imports |
|---|---|
| `src/core/template.ts` | `_voice.md`, `daily-pulse.v8.md` |
| `src/core/daily.ts` | `daily-rollup.v5.md` |
| `src/core/weekly.ts` | `weekly-rollup.v5.md` |
| `src/core/monthly.ts` | `monthly-digest.v4.md` |
| `src/core/aggregations.ts` | `quarterly-retro.v3.md`, `yearly-retro.v3.md` |
| `src/core/spine.ts` | `project-spine.v3.md` |
| `src/core/notes.ts` | `note-draft.v2.md` |
| `src/core/wrapped/renderer.ts` | `wrapped-yearly.v3.md`, `wrapped-project.v2.md` |
| `src/core/wrapped/personality.ts` | `wrapped-personality.v2.md` |
| `src/core/reflection/pattern-detector.ts` | `pattern-detection.v2.md` |
| `src/commands/demo.ts` | `wrapped-2026-sample.md`, `wrapped-2026-sample.html` (demo assets) |

Any future prompt or asset that needs to ship inside the compiled binary follows the same shape.

## Why This Works
Bun's import attribute mechanism is a build-time directive. The bundler resolves `../prompts/_voice.md` relative to the importing module's path at compile time, reads the file, and emits a JS module that exports the file's contents as a default string. The compiled binary contains the prompt as bytes inside the JS bundle — no filesystem access needed at runtime.

## Prevention
- New prompts must be imported via `import X from "../prompts/X.vN.md" with { type: "text" }`, never loaded with `Bun.file(...)`
- AGENTS.md `### Prompts` section documents this; do not relax the rule
- If a future contributor wants prompt content at runtime (e.g., for `--show-prompt`), expose it via the imported string — never re-introduce filesystem reads
- The `docs/_archive/HANDOFF-CI-DISTRIBUTION.md` decision log records the discovery; preserve it

## Related
- [Versioned prompts never edit in place](../conventions/versioned-prompts-never-edit-in-place.md)
- [Bun-native not Node](../tooling-decisions/bun-native-not-node.md)
- `docs/_archive/HANDOFF-CI-DISTRIBUTION.md` — section B5 "Decision" captures the investigation
- Commit `cde8c0f` for the full migration diff
