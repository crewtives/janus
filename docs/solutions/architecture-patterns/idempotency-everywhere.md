---
title: Idempotency everywhere — every artifact survives re-runs unchanged
date: 2026-05-24
category: architecture-patterns
module: pipeline/orchestrator
problem_type: architecture_pattern
component: development_workflow
severity: high
applies_when:
  - Adding a new artifact (pulse, rollup, MOC, hub, dashboard, ADR, spine section, Wrapped, note)
  - Reviewing PRs that touch the checkpoint, FTS5 index, vault writes, or scaffolding
  - Reasoning about whether a re-run will duplicate, overwrite, or corrupt existing state
  - Designing a new scheduled task
tags: [idempotency, checkpoint, sqlite, state, vault, scaffolding, fts5]
related_components: [core/checkpoint, core/obsidian, core/search-index, core/scaffold]
---

# Idempotency everywhere — every artifact survives re-runs unchanged

## Context
Janus runs nightly. A bad night (network hiccup, machine asleep, Claude Max rate-limit) must be safe to re-run the next morning. Manual `--backfill 7d` must be safe at any moment. A user re-running `bun janus rollup --week` after editing a vault file must not lose the edit. The rule is: **every output is idempotent**. Re-running the same input is a no-op or a deterministic overwrite that doesn't duplicate or break anything.

## Guidance

### Three layers of idempotency

**1. State DB skip — `pulse_state` table**

The checkpoint at `.janus/state.db` (bun:sqlite) tracks `(project, date) → status`. Before enqueueing a date, `cp.isDone(project.name, date)` returns true if the row exists with `status = "done"`. Already-done dates never re-enter the queue.

```ts
// src/pipeline/orchestrator.ts:106-110
if (cp.isDone(project.name, date) && !opts.dryRun) {
  console.log(`[${project.name}/${date}] skip — already done`);
  continue;
}
```

`--force` flag (not implemented today but reserved) would bypass this — for now, idempotency is mandatory.

**2. Stable disk paths — overwrite, not append**

Each artifact has a deterministic vault path:

| Artifact | Path |
|---|---|
| Pulse | `<vault>/Projects/<name>/pulse/YYYY-MM-DD-<name>.md` |
| Daily consolidated | `<vault>/Timeline/Daily/YYYY-MM-DD.md` |
| Weekly | `<vault>/Timeline/Weekly/YYYY-MM-DD-week.md` (Monday) |
| Monthly | `<vault>/Timeline/Monthly/YYYY-MM-monthly.md` |
| Spine | `<vault>/Projects/<name>/<name>-spine.md` |
| Wrapped | `<vault>/Wrapped/Wrapped-YYYY.md` or `<vault>/Projects/<name>/<name>-wrapped-YYYY.md` |
| ADR | `<vault>/Decisions/ADR-NNN-<slug>.md` |

The same `(project, date)` always resolves to the same file. Writes overwrite. There is never an `append` mode.

**3. Doc-ID-stable indices — `pulse_docs.doc_id`**

The FTS5 index keys on the vault-relative path (e.g., `Projects/crewtives-janus/pulse/2026-05-21-crewtives-janus.md`). `SearchIndex.upsert({ docId, ... })` inserts new or replaces existing — never duplicates. Re-indexing on `bun janus index` rebuilds the same row count.

### User edits are preserved across re-runs

Two mechanisms:

1. **Frontmatter flag `needs_review`** — enrich operations (`_index.md`, `_roadmap.md`, `STRATEGY.md`) check the frontmatter before overwriting. If `needs_review: false` (the user reviewed and confirmed), the file is left alone. This is the "user touch" lock.
2. **Baseline diff for pulses** — `cp.saveBaseline({ project, date, generatedContent })` stores what Claude generated. On the next pulse for that project, `loadUserEdits()` reads the current file from disk and diffs against the baseline. Non-empty diffs become "user edits" injected into the next prompt as feedback — the LLM sees what the user changed and incorporates it. Answers in the "Questions for you" callout are preserved verbatim (see `src/core/reflection/question-preserve.ts`).

### Scaffolding is idempotent

Generators (`generateHubs`, `generateMocs`, `generateDashboards`, `fixAllRelated`) check existence before writing. From `src/pipeline/orchestrator.ts:178-208`:

```ts
const hubsSummary = await generateHubs({ config });
console.log(`[janus] [hubs] resumen: ${hubsSummary.created} creados, ${hubsSummary.skipped} skipped (de ${hubsSummary.total})`);
```

The `skipped` counter tells you how many already existed. A fresh vault: 7 created, 0 skipped. A repeat run: 0 created, 7 skipped.

`fixAllRelated` is the one exception — it deterministically rewrites `Pulse anterior:` lines based on actual disk state, so it always changes broken links and leaves correct links alone.

### Failures don't poison idempotency

Failed runs go to `.janus/failed.jsonl` plus `pulse_state.status = "failed"` (not `"done"`). Next run picks them up because `isDone()` only returns true for `status = "done"`. `bun janus retry --from .janus/failed.jsonl` is the manual replay path.

## Why This Matters
- Operational safety: any agent (human or scheduled) can re-run any command without losing data or producing duplicates
- Composability: backfill + nightly + manual all share the same code path, because the same code path is safe by design
- Testability: tests can run the same command twice in succession and assert no change — this is exactly the shape of `tests/checkpoint.test.ts`, `tests/orchestrator-serial.test.ts`, and several others
- User trust: a user who hand-edits a roadmap and re-runs Janus tomorrow keeps the edit. Without idempotency + needs_review, every nightly run would clobber yesterday's manual work and people would stop using the tool

## When to Apply
- New artifact: write the idempotency test before writing the writer (AGENTS.md `### Idempotency` rule)
- New mutation of existing artifact: confirm the artifact has either a frontmatter lock or a baseline diff before changing it
- New table or column in `.janus/state.db`: open an issue first (AGENTS.md rule) and ensure existing rows survive migration
- New scaffolding generator: existence check first, then write; report `created`/`skipped` counts in logs

## Examples

**Idempotent generator pattern:**
```ts
async function generateOneHub(path: string, content: string): Promise<"created" | "skipped"> {
  if (await Bun.file(path).exists()) return "skipped";
  await Bun.write(path, content);
  return "created";
}
```

**Baseline-diff feedback pattern (excerpt from `src/core/user-edits.ts`):**
```ts
const baseline = cp.loadBaseline({ project, date });
const onDisk = await readPulse(...);
if (baseline && baseline !== onDisk) {
  // User edited the file. Inject the diff as feedback into the next prompt.
  userEdits.push(diff(baseline, onDisk));
}
```

**The wrong shape (don't do this):**
```ts
// Appending breaks idempotency — re-running duplicates lines.
await appendFile(spinePath, newSection);
```

## Related
- [Per-project serial, cross-project parallel](per-project-serial-cross-project-parallel.md)
- [Versioned prompts](../conventions/versioned-prompts-never-edit-in-place.md) — even prompts respect this (new file, not in-place edit)
- `src/core/checkpoint.ts` — `pulse_state`, `pulse_baseline`, `pulse_index`, `project_metadata`, `track_lineage`, `decision_graph`, `blocker_history`
- `tests/checkpoint.test.ts` — idempotency tests for the state DB
- AGENTS.md `### Idempotency` — the rule itself
