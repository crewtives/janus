---
title: Deterministic fallback for LLM-dependent features
date: 2026-05-24
category: design-patterns
module: core/wrapped
problem_type: design_pattern
component: assistant
severity: medium
applies_when:
  - Adding a feature where an LLM is "the brain" but the system must always return some answer
  - The user-facing artifact has a structural guarantee (e.g., the Wrapped always has an archetype)
  - LLM output is rich (narrative) but a degraded numeric/heuristic answer is acceptable
  - The LLM can rate-limit, time out, or return invalid JSON
tags: [llm, fallback, deterministic, personality, pattern-detector, graceful-degradation]
related_components: [core/wrapped/personality, core/reflection/pattern-detector]
---

# Deterministic fallback for LLM-dependent features

## Context
Janus has features where the LLM produces the narrative quality but the user-facing artifact must always exist. The Wrapped's archetype ("The Marathonner", "The Explorer", "Hybrid: …") is the canonical example: a Wrapped without an archetype looks broken. If we depend purely on the LLM, a single rate-limit or 500-response leaves the user with a half-rendered Wrapped on Dec 31. Unacceptable.

The pattern is **deterministic fallback**: compute the answer in two phases. Phase 1 derives numeric signals from data Janus already has. Phase 2 asks the LLM for the narrative wrapper. If Phase 2 fails for any reason, a deterministic rule over Phase 1's signals produces a defensible (if less rich) answer.

## Guidance

### Two-phase pattern

**Phase 1: numeric signals (no LLM).** Compute facts from the data:

```ts
// src/core/wrapped/personality.ts (concept)
interface Signals {
  shipRatio: number;       // commits/sessions ratio
  refactorRatio: number;   // refactor commits / total
  exploreSpread: number;   // distinct tracks / sessions
  connectorRatio: number;  // cross-project references
  avgSessionLength: number;
}

const signals = computeSignals(wrappedData);
```

Signals are derived from `WrappedData` (`src/core/wrapped/types.ts`) — top tracks, biggest week, decision counts, anniversary counts. Pure functions. No external IO. Always succeed.

**Phase 2: LLM ask, with fallback.** The LLM call wraps Phase 1's signals into a narrative archetype. If the call fails or returns invalid JSON, fall back to a heuristic:

```ts
async function computePersonality(opts): Promise<Personality> {
  const signals = computeSignals(opts.data);

  if (opts.deterministicOnly) {
    return deterministicArchetype(signals);
  }

  try {
    const result = await runner.run({ prompt: renderPersonalityPrompt(signals), ... });
    return parsePersonality(result.resultText) ?? deterministicArchetype(signals);
  } catch {
    return deterministicArchetype(signals);
  }
}
```

`deterministicArchetype(signals)` is a rule table:

- `shipRatio > 0.6` → "The Marathonner"
- `exploreSpread > 0.5` and `connectorRatio > 0.3` → "The Explorer"
- `refactorRatio > 0.4` → "The Refiner"
- Else → "Hybrid: <top two>"

This is honest: the signals are real, the rules are auditable, the LLM only contributes the narrative voice when available.

### Where the pattern lives in Janus

| Feature | Phase 1 (deterministic) | Phase 2 (LLM) | What happens on LLM failure |
|---|---|---|---|
| `computePersonality` (Wrapped) | numeric signals over `WrappedData` | `wrapped-personality.v2.md` | `deterministicArchetype()` |
| `runPatternDetector` (Phase 2) | none — purely LLM | `pattern-detection.v2.md` | Returns `[]`, weekly still runs |
| `writeDailyConsolidated` | concatenated TL;DR embeds via transclusion | `daily-rollup.v5.md` for narrative | Falls back to a no-LLM "transclusion only" daily marked `[fallback]` in logs |

The pattern-detector is interesting: it has no deterministic answer because the feature is exactly "ask the LLM for cross-project patterns". The fallback there is "skip it" — the weekly rollup runs without the patterns block. This is also acceptable; missing patterns is preferable to a failed weekly.

### `deterministicOnly: true` is the per-call kill switch

When the anniversary trigger generates a per-project Wrapped automatically (`src/pipeline/orchestrator.ts:310-322`), it passes `deterministicOnly: true`. Rationale: backfills can trigger many anniversary Wrappeds at once; running an LLM call per project per year explodes cost. The deterministic-only path is honest about what it skips and produces a valid (if narrative-less) artifact.

The CLI flag `--deterministic-only` exposes the same switch for manual use during prompt iteration: `bun janus wrapped --year 2026 --deterministic-only` runs the aggregator + heuristic archetype, no LLM call, no writes if combined with `--dry-run`.

## Why This Matters
- Reliability: the Wrapped, the consolidated daily, the weekly rollup all degrade gracefully instead of crashing
- Cost control: backfills don't multiply LLM calls; the deterministic path is the explicit "don't burn quota" mode
- Honesty: the heuristics produce a defensible answer from real signals, not a fabricated one. The user can read the archetype "Hybrid" from the deterministic path and know it reflects the data, even if the narrative voice is missing
- Testability: Phase 1 is pure, Phase 2 is mocked. Tests cover both paths

## When to Apply
- Feature has a "must always produce something" user contract
- LLM output can fail (rate-limit, timeout, parse error) and the feature is on a critical path (annual artifact, scheduled job)
- The feature can be broken into "numeric signals" + "narrative wrapper" — if the narrative wrapper is the entire feature (e.g., the daily-pulse itself), there is no fallback, and the failure must propagate

## Examples

**Bad shape (LLM is the only path):**
```ts
async function computeArchetype(data) {
  const result = await llm.run(...);   // throws on failure
  return JSON.parse(result.resultText).archetype;   // throws on invalid JSON
}
```

**Good shape (current):**
```ts
async function computePersonality(opts) {
  const signals = computeSignals(opts.data);
  if (opts.deterministicOnly) return deterministicArchetype(signals);
  try {
    const result = await llm.run({ prompt: renderPrompt(signals), ... });
    return parsePersonality(result.resultText) ?? deterministicArchetype(signals);
  } catch {
    return deterministicArchetype(signals);
  }
}
```

## Related
- [LLM Runner abstraction](../architecture-patterns/llm-runner-abstraction.md)
- [Idempotency everywhere](../architecture-patterns/idempotency-everywhere.md)
- `src/core/wrapped/personality.ts` — `computePersonality()` and `deterministicArchetype()`
- `src/core/reflection/pattern-detector.ts` — best-effort pattern; failure → empty array, weekly continues
- `src/core/daily.ts` — `writeDailyConsolidated` with `[LLM]` / `[fallback]` tags in logs
