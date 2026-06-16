---
title: Per-project serial, cross-project parallel — the queue invariant
date: 2026-05-24
category: architecture-patterns
module: pipeline/orchestrator
problem_type: architecture_pattern
component: development_workflow
severity: high
applies_when:
  - Adding a new artifact that cross-references the previous day (weekly continuity, spine sections)
  - Changing the p-queue concurrency setting
  - Refactoring `src/pipeline/orchestrator.ts` or `src/pipeline/queue.ts`
  - Reasoning about why pulses look correct only when the queue runs a specific shape
tags: [pipeline, p-queue, concurrency, serialization, wiki-links, idempotency]
related_components: [pipeline/queue, core/previous-pulses]
---

# Per-project serial, cross-project parallel — the queue invariant

## Context
The Janus pipeline processes `(project, date)` combinations. The naive design dispatches each combination as an independent p-queue task with `concurrency: 2`. This breaks: pulses cross-reference the previous day (`Pulse anterior: [[YYYY-MM-DD-<project>]]`), and parallel workers within the same project produced broken wiki-links because day N's prompt could not see day N-1's file on disk yet (it was being written concurrently). See [Wiki-links race from parallel dates](../runtime-errors/wiki-links-race-from-parallel-dates.md) for the failure mode.

The architectural answer: one p-queue task = one project, and within that task the dates loop runs serially in ascending order.

## Guidance

### The shape

```ts
// src/pipeline/orchestrator.ts:100-148
for (const project of projects) {
  const pendingDates: string[] = [...];   // filtered: idempotent skip removes done dates
  if (pendingDates.length === 0) continue;

  queue.add(async () => {
    pendingDates.sort();   // ascending: day N depends on day N-1
    for (const date of pendingDates) {
      try {
        const res = await withRetry(
          () => processProject({ project, date, config, cp, dryRun }),
          { retries: 2 },
        );
        // ...
      } catch (err) {
        // ... record to failed.jsonl, continue with next date
      }
      counter.completed += 1;
      await onDateMaybeComplete(date);
    }
  });
}
```

`p-queue` runs N projects in parallel (`config.concurrency`, default 2). Inside each task, the date loop is plain `for ... of`, awaiting each `processProject` before moving on. There is no concurrency inside a project.

### Why ascending order

`processProject()` calls `loadPreviousPulses({ obsidianPath, currentDate, daysBack: 7 })`. That function reads the actual pulse files from disk and returns `immediatePrevious`. If today is `2026-05-21`, it expects `2026-05-20-<project>.md` to exist on disk. With ascending serial processing, day N-1 was written before day N starts, so this read is always consistent.

If a future contributor sorts descending or interleaves dates, the wiki-links break again — even with serialization.

### Day-close detection happens cross-project

`onDateMaybeComplete(date)` is the post-condition: when **all** projects have finished a given date (ok, failed, or skipped), the orchestrator writes the consolidated daily for that date and pings Discord. The `dateCounters` map tracks `expected` and `completed` per date. Because projects run in parallel, completion order is non-deterministic across projects — but within a project, dates always advance in order, so the counter math is monotonic.

### Idempotent skip is a first-pass filter

Before enqueueing, `cp.isDone(project.name, date)` removes already-done dates. If all dates for a project are done, no task is enqueued. If `expected === 0` for some date because every project skipped, the day-close callback never fires (and that's fine — nothing to consolidate).

## Why This Matters
- Wiki-link integrity is structural, not best-effort. Without the per-project serialization, every backfill produces a vault with broken cross-references that requires `scripts/fix-broken-links.ts` to repair.
- The invariant is small and load-bearing. A future "let's parallelize within a project too" refactor will look attractive (more throughput per project) but will re-introduce the bug.
- Cross-project parallelism still gives most of the throughput benefit. With 7 projects and `concurrency: 2`, the queue is rarely the bottleneck; the LLM call dominates the runtime.

## When to Apply
- Any artifact that references the previous artifact in the same project (pulses → previous pulse, weekly → previous weekly, spine continuity) must respect this invariant
- New schedulers or queues that touch the same shape must follow the same pattern
- Test coverage: `tests/orchestrator-serial.test.ts` pins the invariant — do not delete or weaken

## Examples

**Correct (current):**
```ts
queue.add(async () => {
  pendingDates.sort();   // ASC
  for (const date of pendingDates) {
    await processProject({ project, date, ... });
  }
});
```

**Wrong (the original bug):**
```ts
for (const project of projects) {
  for (const date of dates) {
    queue.add(() => processProject({ project, date, ... }));  // parallel within project
  }
}
```

**Wrong in a subtle way (descending):**
```ts
queue.add(async () => {
  pendingDates.sort().reverse();   // DESC — day N runs before N-1
  for (const date of pendingDates) {
    await processProject({ project, date, ... });
  }
});
```

## Related
- [Wiki-links race from parallel dates](../runtime-errors/wiki-links-race-from-parallel-dates.md) — the failure mode
- [Idempotency everywhere](idempotency-everywhere.md) — first-pass skip filter
- `src/pipeline/orchestrator.ts:93-148` — the canonical shape
- `tests/orchestrator-serial.test.ts` — invariant test
- `src/core/previous-pulses.ts` — disk-read for `immediatePrevious`
