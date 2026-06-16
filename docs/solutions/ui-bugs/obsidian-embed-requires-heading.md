---
title: Obsidian embed syntax only resolves headings, not callout labels
date: 2026-05-24
category: ui-bugs
module: prompts/daily-rollup
problem_type: ui_bug
component: documentation
symptoms:
  - "`![[YYYY-MM-DD-<project>#TL;DR]]` renders empty in the daily consolidated"
  - The pulse file has `> [!summary]+ TL;DR\n> ...` callout but no embed shows
  - Other embeds in the same vault work; only the TL;DR ones break
root_cause: wrong_api
resolution_type: documentation_update
severity: medium
tags: [obsidian, embed, callout, prompt, daily-rollup, wiki-links]
related_components: [prompts/daily-pulse, core/daily]
---

# Obsidian embed syntax only resolves headings, not callout labels

## Problem
Obsidian's transclusion / embed syntax (`![[file#anchor]]`) resolves the anchor against the target file's **headings**, not against callout labels. The initial daily-pulse prompt produced a TL;DR section as a callout only:

```markdown
> [!summary]+ TL;DR
> The day centered on ...
```

Then the daily-rollup template tried to transclude with `![[2026-05-21-crewtives-janus#TL;DR]]`. The embed rendered empty because there was no `## TL;DR` heading in the pulse file — only a callout label, which is a Markdown extension that doesn't create an anchor.

## Symptoms
- The consolidated daily file (`<vault>/Timeline/Daily/YYYY-MM-DD.md`) shows blank sections where per-project TL;DRs should appear
- Hovering the embed link in Obsidian shows "block not found" or simply renders empty
- The pulse file looks correct on its own; only the embed from the daily breaks

## What Didn't Work
- Using `![[file#summary]]` lowercased — same result, callout labels are not headings regardless of case
- `![[file#^block-id]]` block reference — would work, but requires generating a stable block ID and the LLM can't be trusted to produce one consistently
- Telling the prompt to "produce a TL;DR callout that Obsidian will embed" — the prompt followed the instruction, the file matched the description, the embed still failed because the constraint is structural

## Solution
Generate `## TL;DR` as a proper heading, with the callout nested inside the heading's body. The daily-pulse prompt now produces:

```markdown
## TL;DR

> [!summary]+
> The day centered on …
```

The `## TL;DR` heading creates the anchor that `![[file#TL;DR]]` resolves to. The callout is preserved for its visual styling inside Obsidian (the colored summary box).

The daily-rollup prompt then transcludes with `![[YYYY-MM-DD-<project>#TL;DR]]` and the embed picks up the callout body via the heading's content section.

## Why This Works
Obsidian builds its file index from Markdown headings (`#`, `##`, `###`) and explicit block IDs (`^block-id`). Callout labels (`> [!summary]+ TL;DR`) are syntax recognized by the renderer but not by the index. By promoting `TL;DR` to a heading, the anchor exists in the index and the embed resolves.

The callout-inside-heading pattern keeps both behaviors: the heading provides the anchor, the callout provides the styled summary box that makes the TL;DR visually distinctive in Obsidian.

## Prevention
- Any new prompt that produces content meant to be embedded elsewhere must use heading anchors, never callout labels
- The daily-pulse prompt has the heading-then-callout pattern locked in via the prompt template at `src/prompts/daily-pulse.v8.md`; preserve the order on future bumps
- Voice rule `_voice.md` rule 9 (`code blocks for copy-paste content vs callouts for narrative`) is the broader convention — callouts are for in-document highlighting, not for cross-document references

## Related
- [Versioned prompts](../conventions/versioned-prompts-never-edit-in-place.md)
- `src/prompts/_voice.md` — rule 9 covers when to use callouts vs code blocks
- `src/prompts/daily-rollup.v5.md` — consumer of the embed
- Obsidian docs: https://help.obsidian.md/Linking+notes+and+files/Embed+files (heading vs block ID, not callout)
