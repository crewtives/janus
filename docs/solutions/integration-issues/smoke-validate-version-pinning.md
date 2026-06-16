---
title: smoke-validate-phase1.ts breaks every time a prompt version is bumped
date: 2026-05-24
category: integration-issues
module: scripts/smoke-validate-phase1
problem_type: integration_issue
component: testing_framework
symptoms:
  - "`bun run scripts/smoke-validate-phase1.ts` fails after a prompt version bump"
  - CI fails with `❌ daily-pulse.vN renders` even though the new file exists
  - Local smoke check is green but CI red after merging a prompt change
root_cause: config_error
resolution_type: code_fix
severity: medium
tags: [smoke-tests, prompts, ci, version-pinning, prompt-versions]
related_components: [prompts, core/template]
---

# smoke-validate-phase1.ts breaks every time a prompt version is bumped

## Problem
The smoke validation script hardcodes prompt version numbers in its check labels (`daily-pulse.v8 renders with a mock context`, etc.) and pulls the version from `PROMPT_VERSION` exported by `src/core/template.ts`. When a prompt is bumped (e.g., `daily-pulse.v7.md` → `daily-pulse.v8.md`), the import site in `template.ts` updates and `PROMPT_VERSION` reflects the new version, but the check label string in `smoke-validate-phase1.ts` is stale — it still says `v7`. The check passes (the new prompt does render) but the label lies. Worse: when the old prompt file is later deleted, the smoke script's import still points to a path that no longer exists if anyone reintroduces a direct path-based load.

Bumped twice during Phase 2 + i18n sweep — once when Phase 2 moved `daily-pulse` v6 → v7, once when i18n bumped to v8. The fix each time was to update the version constant.

## Symptoms
- Check name in output reports an older version than the actually-loaded prompt
- `PROMPT_VERSION` constant from `src/core/template.ts` does not match the version named in the smoke script's check string
- CI reports "14 checks OK" with a misleading label

## What Didn't Work
- Manually keeping the version constant in `smoke-validate-phase1.ts` in sync with template.ts — relies on human memory, fails every prompt bump
- Auto-detecting the version from the loaded file's frontmatter — prompts don't have frontmatter; the version is in the filename

## Solution
Reference `PROMPT_VERSION` (re-exported from `src/core/template.ts`) directly in check labels and assertions. From `scripts/smoke-validate-phase1.ts:22`:

```ts
import { loadVoiceSpec, PROMPT_VERSION, buildPromptContext, renderDailyPulsePrompt } from "../src/core/template.ts";

// Use PROMPT_VERSION in check names and detail strings, never hardcode "v7"/"v8"
await check("voice spec loads without error", async () => {
  const v = await loadVoiceSpec();
  // ...
  return `${v.length} chars, prompt_version=${PROMPT_VERSION}`;
});
```

When introducing a new prompt that needs a version pin, expose the version constant from the module that imports the prompt (the same way `PROMPT_VERSION` is exported from `template.ts`), and reference that constant from the smoke check — never write `"v8"` as a string literal.

## Why This Works
The version constant lives next to the prompt import. Bumping a prompt means changing the import line and updating the exported constant in the same file — both updates happen in one commit. The smoke script imports the constant, so it stays in sync mechanically without human intervention.

## Prevention
- New prompts whose version is checked in smoke must export their version constant alongside the import in the consuming module
- AGENTS.md `### Prompts` section documents the versioning convention; the smoke check is a downstream consumer that must follow it
- When deleting an old prompt file, search for direct path references (`"prompts/daily-pulse.v7.md"` as a string) before removing — there shouldn't be any, but the search confirms

## Related
- [Versioned prompts never edit in place](../conventions/versioned-prompts-never-edit-in-place.md)
- [bun-compile bundles prompts](bun-compile-prompts-md.md)
- `src/core/template.ts` — exports `PROMPT_VERSION`, the single source of truth
