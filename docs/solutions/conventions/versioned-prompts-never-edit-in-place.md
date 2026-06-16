---
title: Versioned prompts (vN.md) — never edit a shipped prompt in place
date: 2026-05-24
category: conventions
module: prompts
problem_type: convention
component: documentation
severity: high
applies_when:
  - Changing the wording, structure, or rules of any prompt under `src/prompts/`
  - Adding a new prompt for a new artifact
  - Reviewing a PR that touches a `.md` file in `src/prompts/`
  - Deciding whether a tweak deserves a version bump (answer: it does)
tags: [prompts, versioning, eta, immutability, eval, archaeology]
related_components: [prompts, core/template]
---

# Versioned prompts (vN.md) — never edit a shipped prompt in place

## Context
Prompts are the load-bearing artifact for Janus's output quality. Editing a shipped prompt in place loses the previous version (commit history is the only record), prevents A/B comparison, and makes "voice drift" debugging impossible. The convention: every prompt change creates a new file (`daily-pulse.v8.md`), updates the import site (`src/core/template.ts`), and leaves the previous version in tree.

## Guidance

### The naming pattern

`src/prompts/<name>.v<N>.md`. The version is part of the filename. Examples:

- `daily-pulse.v4.md` … `daily-pulse.v8.md` (current)
- `daily-rollup.v2.md` … `daily-rollup.v5.md` (current)
- `weekly-rollup.v2.md` … `weekly-rollup.v5.md` (current)
- `monthly-digest.v1.md` … `monthly-digest.v4.md` (current)
- `quarterly-retro.v1.md` … `quarterly-retro.v3.md`
- `yearly-retro.v1.md` … `yearly-retro.v3.md`
- `project-spine.v1.md` … `project-spine.v3.md`
- `note-draft.v1.md`, `note-draft.v2.md`
- `pattern-detection.v1.md`, `pattern-detection.v2.md`
- `wrapped-yearly.v1.md` … `wrapped-yearly.v3.md`
- `wrapped-personality.v1.md`, `wrapped-personality.v2.md`
- `wrapped-project.v1.md`, `wrapped-project.v2.md`

Plus `_voice.md` (no version — the shared spec is one file, edited in place because every prompt injects it; voice changes are coordinated).

### The bump procedure

1. Copy `name.vN.md` to `name.vN+1.md`
2. Make your changes in `name.vN+1.md`
3. Update the import site to point at `vN+1`:
   ```ts
   // Old (src/core/template.ts):
   import dailyPulseTemplate from "../prompts/daily-pulse.v7.md" with { type: "text" };
   export const PROMPT_VERSION = "v7" as const;

   // New:
   import dailyPulseTemplate from "../prompts/daily-pulse.v8.md" with { type: "text" };
   export const PROMPT_VERSION = "v8" as const;
   ```
4. Update any sites that reference `PROMPT_VERSION` (smoke check naturally follows because it imports the constant)
5. Run `bun test && bunx tsc --noEmit && bun run scripts/smoke-validate-phase1.ts`
6. Commit with scope `prompts`: `feat(prompts): bump daily-pulse to v8 — <one-line reason>`

The old file stays in tree. Do not delete it.

### Why old versions stay

- **Eval against real outputs.** `scripts/eval-prompt-voice.ts` can A/B test a vN vs vN+1 on the same corpus
- **Archaeology.** Voice evolves over time. A `git blame` on the prompt file shows when a rule was added, but reading `vN` vs `vN+1` side by side shows the qualitative shift
- **Backwards compatibility for re-runs.** `scripts/regenerate-dailys.ts --version vN` (if implemented) could regenerate historical pulses with the prompt of that era. Not used today, but the option exists because old versions weren't deleted

### When to bump

Bump if any of:
- Hard rule added, removed, or reworded
- Structural change (new section, removed section, reordered required-section list)
- Tone shift (e.g., from "describe what happened" to "identify what shifted")
- New input variable added to the prompt context
- Voice spec changed in a way that breaks prior outputs

Do not bump for:
- Pure typo fixes that don't change semantics
- Whitespace-only changes
- Comment-only changes in the Eta template

When in doubt: bump. Cheap to add, expensive to retro-fit.

### The rule for `_voice.md`

`_voice.md` is the shared spec. It is edited in place because:
- Every prompt injects it via `<%= it.voice %>`
- Versioning it would require coordinating bumps across ~13 prompts simultaneously
- Voice rules are additive (rule 9 was added without renumbering 1-8); no callers reference rule numbers by index

When `_voice.md` changes substantively, the convention is to bump the prompts that produce visible voice change (typically daily-pulse + daily-rollup), even if they don't change their own bodies. The bump makes the change visible in git log under the right scope.

## Why This Matters
- Voice drift is the failure mode that's hardest to debug. Versioned prompts make the drift visible and reversible
- The compounded binary (`bun build --compile`) embeds whatever version is imported. Deleting an old version on disk is fine; deleting from git history is what breaks eval
- New contributors see the version naming and understand the convention without being told. The pattern is self-documenting

## When to Apply
- Always when editing a prompt. There is no "small enough to skip" carve-out
- New prompt for new artifact: start at `v1`
- Voice spec changes: edit `_voice.md` in place, bump the prompts whose output noticeably shifts

## Examples

**Correct: bump for a tone change**
```bash
cp src/prompts/daily-pulse.v7.md src/prompts/daily-pulse.v8.md
# edit v8.md
# update src/core/template.ts to import v8 and set PROMPT_VERSION = "v8"
git add src/prompts/daily-pulse.v8.md src/core/template.ts
git commit -m "feat(prompts): bump daily-pulse to v8 — soften third-person narration"
```

**Wrong: edit in place**
```bash
$EDITOR src/prompts/daily-pulse.v7.md
git commit -am "tweak daily-pulse voice"
# now v7 is no longer what it was; eval against history is broken
```

## Related
- [Shared voice spec injection](../design-patterns/shared-voice-spec-injection.md)
- [bun-compile prompts](../integration-issues/bun-compile-prompts-md.md)
- [smoke-validate version pinning](../integration-issues/smoke-validate-version-pinning.md)
- AGENTS.md `### Prompts` section — the rule
- `src/core/template.ts` — current import site
- `scripts/eval-prompt-voice.ts` — A/B comparison harness
- `docs/eval/voice-overhaul.md` — first eval doc
