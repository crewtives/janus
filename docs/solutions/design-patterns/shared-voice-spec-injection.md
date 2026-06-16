---
title: Shared voice spec injected into every prompt via `<%= it.voice %>`
date: 2026-05-24
category: design-patterns
module: prompts
problem_type: design_pattern
component: documentation
severity: high
applies_when:
  - Adding a new prompt that should match Janus's narrative voice
  - Updating the voice rules (must happen in one file, not N)
  - Reviewing a PR that touches narrative consistency
  - Bumping a prompt version where the body needs to stay in sync with the voice
tags: [prompts, voice, eta, _voice.md, narrative, consistency]
related_components: [prompts, core/template]
---

# Shared voice spec injected into every prompt via `<%= it.voice %>`

## Context
Janus has ~13 versioned prompts that all need to write in the same voice (soft third-person narrator, prose > bullets, product-level language, etc.). Early prompts (v1–v4) each carried their own implicit voice conventions and drifted apart across versions. A voice change required N coordinated edits and any miss produced visibly inconsistent output. Phase 1A introduced `src/prompts/_voice.md` as a single voice spec injected into every prompt at render time.

## Guidance

### The spec lives in one file

`src/prompts/_voice.md` is the only voice spec. It is imported once via Bun import attributes:

```ts
// src/core/template.ts:4
import voiceSpec from "../prompts/_voice.md" with { type: "text" };
```

`loadVoiceSpec()` returns the bundled string. The signature is async (`Promise<string>`) for historical reasons — callers depend on it being awaitable. Do not refactor to sync; see AGENTS.md non-obvious decisions.

### Every prompt injects it at the top

Eta templates start with the voice block:

```eta
<%= it.voice %>

# YOUR ROLE
You are Janus, the personal historian...
```

Builders pass `voice: await loadVoiceSpec()` into the context object. The orchestrator does this at `src/pipeline/orchestrator.ts:301` as part of the parallel `Promise.all` that builds prompt context.

### Notes inject the same voice spec but with a different role frame

`note-draft.v2.md` (the `bun janus note` command) also starts with `<%= it.voice %>` and `src/core/notes.ts:138` calls `loadVoiceSpec()` like every other builder. The voice rules in `_voice.md` apply uniformly — what differs is the role framing the prompt sets after the voice block: notes are written in observational first-person ("I noticed", "I tried"), pulses in soft third-person ("the day centered on"). The split lives in the prompt body's role/task section, not in a separate voice file.

Earlier doc drafts described notes as carrying their own inline voice spec; that was incorrect — both v1 and v2 inject the shared spec. Don't refactor the notes prompt to remove the `<%= it.voice %>` injection thinking it's redundant.

### Hard rules (current) — 9 items

Summarized from `_voice.md`:

1. Prose > bullets (paragraph by default, bullets only for inherently list-like content)
2. Soft third-person narrator ("the day centered on", not "you did")
3. Product-level language, not file-level
4. No empty adjectives ("solid", "productive", "interesting")
5. Concreteness + evidence (every claim with a citable commit/session/date)
6. Cumulative temporal continuity
7. No disclaimers or meta-commentary
8. Honesty (if it was slow, say so)
9. Code blocks for copy-paste content vs callouts for narrative

Rule 9 was added in commit `dcfdf89 feat(voice): add rule 9 — code blocks for copy-paste content vs callouts for narrative` (2026-05-24). The numbering will keep growing — new rules append; existing rules don't get renumbered (call sites that quote rule numbers in PR discussion would otherwise rot).

## Why This Matters
- Voice consistency is the moat (per STATUS.md). A drifting voice across pulses, weeklies, and Wrapped breaks the perception that one narrator is writing the project history
- Single-file edit: tightening a rule means one PR, not 13
- Eval surface: A/B testing voice changes is straightforward — swap `_voice.md`, regenerate via `scripts/eval-prompt-voice.ts`, compare side-by-side
- Build-time embedding (via import attributes) means `bun build --compile` ships the same voice as `bun janus` from source — no path resolution at runtime, no skew

## When to Apply
- New prompt that produces narrative content → import voice via `loadVoiceSpec()`, inject as `<%= it.voice %>` at the top of the Eta template
- New voice rule → edit `_voice.md`, never duplicate the rule into individual prompts
- Voice rules that apply only to one prompt → put them inline in that prompt's body, not in `_voice.md`

## Examples

**Correct: shared voice + per-prompt rendering**
```ts
// In a builder function
const voice = await loadVoiceSpec();
const ctx = { voice, project, date, ... };
const prompt = await renderDailyPulsePrompt(ctx);
```

**Wrong: duplicating voice rules into the prompt body**
```eta
<!-- src/prompts/daily-pulse.v9.md -->
# Voice
1. Prose > bullets
2. Soft third-person
... (don't do this — diverges from _voice.md)
```

**Correct: same voice spec, different role framing (notes)**
```eta
<!-- src/prompts/note-draft.v2.md -->
<%= it.voice %>

---

# Your task — Note draft for the portfolio

... (180-380 words of body) ... — first-person observational, the founder's
voice thinking out loud about why something was built a certain way.
```

The shared voice spec still applies; what changes is the role framing in the task section below the spec.

## Related
- [Versioned prompts](../conventions/versioned-prompts-never-edit-in-place.md) — each prompt version is a new file
- [bun-compile prompts](../integration-issues/bun-compile-prompts-md.md) — _voice.md is embedded the same way
- `src/prompts/_voice.md` — the spec itself
- `scripts/eval-prompt-voice.ts` — side-by-side voice comparison
- `docs/eval/voice-overhaul.md` — original eval doc for Phase 1A
