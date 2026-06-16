---
title: Pulse filenames use a single-dash separator after a fixed-width date prefix
date: 2026-05-24
category: conventions
module: core/obsidian
problem_type: convention
component: documentation
severity: medium
applies_when:
  - Parsing pulse filenames (any code that reads `<vault>/Projects/<name>/pulse/*.md`)
  - Generating wiki-links that point to pulses
  - Writing a new artifact whose filename includes a date and a slug
  - Importing an older vault backup (pre-2026-05-22) whose filenames use double-dash
tags: [filenames, vault, regex, parsing, wiki-links, naming]
related_components: [core/obsidian, core/search-index, core/daily, scripts]
---

# Pulse filenames use a single-dash separator after a fixed-width date prefix

## Context
Pulse filenames are `YYYY-MM-DD-<project>.md` — single-dash separator between the date and the project slug. The `YYYY-MM-DD` prefix is fixed-width (10 chars), which is what makes the single-dash form unambiguous even when both the date and the slug contain dashes (e.g., `2026-05-21-crewtives-acme-app.md`). Before 2026-05-22 the separator was double-dash (`YYYY-MM-DD--<project>.md`). The refactor in commit `7434155 refactor(pulse): single-dash separator in pulse filenames (#3)` flipped the convention.

## Guidance

### The format

```
YYYY-MM-DD-<project-slug>.md
^^^^^^^^^^               ^^^
fixed 10 chars           fixed .md extension
^^^^^^^^^^^^             
prefix anchor
            ^^^^^^^^^^^^^
            project slug (may contain dashes)
```

Examples:

| Date | Project | Filename |
|---|---|---|
| 2026-05-21 | janus | `2026-05-21-janus.md` |
| 2026-05-21 | crewtives-janus | `2026-05-21-crewtives-janus.md` |
| 2026-05-21 | crewtives-acme-app | `2026-05-21-crewtives-acme-app.md` |
| 2026-05-21 | fly-foo | `2026-05-21-fly-foo.md` |

### The regex anchor

Every parser anchors on `^\d{4}-\d{2}-\d{2}-`. Examples:

```ts
// Parse date + slug from filename
const m = filename.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
if (m) {
  const date = m[1];       // "2026-05-21"
  const slug = m[2];       // "crewtives-acme-app"
}
```

The match works because the date is exactly 10 chars. The slug "starts after the 11th char". No alternation, no ambiguity.

Do **not** relax the anchor:

```ts
// Wrong — accepts arbitrary date prefixes, breaks if slug starts with digits
/^(\d+-\d+-\d+)-(.+)\.md$/

// Wrong — greedy date, breaks on slugs that contain dashes
/^(\d+)-(.+)\.md$/
```

### Files that contain the regex

- `src/core/search-index.ts:401` — FTS5 indexer parses pulse paths
- `src/core/daily.ts:75` — daily rollup parses `<date>-<slug>.md` to group pulses by date
- `src/core/obsidian.ts:50` — `writePulse()` builds the path
- `src/core/previous-pulses.ts` — finds yesterday's pulse on disk
- `scripts/fix-pulse-anterior-links.ts` — post-process that repairs broken `Pulse anterior` lines
- `scripts/regenerate-dailys.ts` — backfill consolidator

Update all six together if the format ever changes (it shouldn't).

### Migration history

Before the rename: `YYYY-MM-DD--<project>.md` (double-dash). 118 files in the production vault were renamed and 271 wiki-links rewritten across 75 files in a single migration. Validated post-rename with `bun janus wrapped --year 2026 --dry-run`.

The migration script is gone (one-shot, not committed). If you ever import an older backup, reconstruct from git history of commit `7434155` or write a one-off rename + sed.

The `_archive/` directory follows the same convention. Pulses moved to `_archive/` by the monthly digest keep their original filename.

### Why single-dash works

The date is 10 chars, always. The slug starts at char 11. No matter how many dashes the slug contains, the parser splits at position 10 and the rest is the slug. The double-dash was a defensive choice from an era before the date prefix was anchored. With the anchor, the second dash is redundant — and visually noisier.

## Why This Matters
- Parsers in 6+ files all depend on the anchor. A relaxed regex in one place can shadow bugs in the others
- Wiki-link generation (`[[2026-05-21-crewtives-janus]]`) matches the filename verbatim; a separator mismatch produces broken links in Obsidian
- The single-dash is shorter, easier to type, and matches how humans write file names elsewhere

## When to Apply
- Any new artifact with a date-prefix filename should use the same format and the same regex anchor
- Importing an old backup with double-dash: rename first, do not try to make parsers accept both forms (the dual-mode parser was rejected during the refactor)
- Wiki-link generation: use the same `${date}-${slug}` shape; don't introduce a separator variable that could drift

## Examples

**Correct:**
```ts
const date = "2026-05-21";
const slug = project.name;   // e.g. "crewtives-acme-app"
const filename = `${date}-${slug}.md`;   // "2026-05-21-crewtives-acme-app.md"
```

**Correct parsing:**
```ts
const m = filename.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
```

**Wrong: legacy double-dash, won't parse with current code:**
```
2026-05-21--crewtives-acme-app.md
```

## Related
- AGENTS.md `### Filenames` section — the rule
- Commit `7434155 refactor(pulse): single-dash separator in pulse filenames (#3)`
- [Wiki-links race condition](../runtime-errors/wiki-links-race-from-parallel-dates.md) — related parsing concern
- `src/core/obsidian.ts` — `writePulse()` and friends
