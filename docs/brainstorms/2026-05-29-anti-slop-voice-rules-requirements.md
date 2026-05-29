---
date: 2026-05-29
topic: anti-slop-voice-rules
---

# Anti-slop rules in the Janus voice

## Summary

Add an anti-slop rules section to `src/prompts/_voice.md` that imports the
copy-quality rules from [impeccable.style/slop](https://impeccable.style/slop/),
adapted to prose. The rules apply to every Janus output but at two strictness
tiers: hard for publication-bound copy, light-touch inside the narrative
pulses — with a floor that any single sentence lifted from a pulse into an
external post is publication-safe as-is.

## Problem Frame

The user maintains a Crewtives portfolio and assembles its posts by hand,
lifting fragments from Janus pulses (and from work that never made it into the
notes). Because those fragments go public verbatim, the quality of the internal
narrative is also the quality of the published post — there is no clean copy-edit
layer in between.

The impeccable.style slop rules are written for published web copy, and two of
them collide with Janus's *deliberate* voice: the voice leans on em-dashes as a
narrative device, and `_voice.md` itself opens with a fabricated-contrast triplet
("Not a reporter, not an analyst, not a dashboard") — exactly the cadence the
aphoristic-cadence rule penalizes. Meanwhile two other slop rules (buzzwords,
concreteness) already overlap existing voice rules 4 and 5. So the work is not a
blind import: it is reconciling four copy rules against an established voice whose
own examples partly violate them, while preserving the narrative flavor the user
wants to keep inside Obsidian.

## Key Decisions

- **Universal placement, tiered rigor.** The anti-slop rules live in one section
  of `_voice.md` (the single injection point, rendered into every prompt via
  `<%= it.voice %>`). They apply everywhere, but the section defines two tiers:
  strict for publication-bound copy, tolerant inside the narrative. One source of
  truth, two strictness levels — not two separate rule sets.

- **Tier boundary reuses rule 9's surface taxonomy.** Rule 9 already splits
  copy-paste/external content from internal Obsidian narrative. The anti-slop
  tiers hook onto that same distinction rather than inventing a new one: the
  strict tier = copy meant to be published (note-draft, copy-paste blocks); the
  tolerant tier = pulses, weeklies, monthlies, spines, wrapped read in Obsidian.

- **The tolerant tier still has a publication-safe floor.** "Tolerant inside" does
  not mean unconstrained. Because fragments get lifted verbatim into posts, the
  internal tier keeps narrative flavor (occasional em-dash, the established voice)
  but holds a baseline such that no single sentence carries an em-dash pileup, a
  buzzword, or a manufactured contrast.

- **Dedupe against existing rules, don't duplicate.** Marketing buzzwords overlap
  rule 4 (no empty adjectives); concreteness overlaps rule 5 (evidence). The new
  section references rules 4 and 5 for those and adds only what is genuinely new:
  em-dash discipline, aphoristic/manufactured-contrast cadence, and theater
  framing.

- **Soften the voice doc's own opener.** `_voice.md` line 3's "Not a reporter, not
  an analyst, not a dashboard" is the fabricated-contrast tell the new rule
  penalizes. Default decision: rewrite it to a plain statement so the spec obeys
  its own rules. (Alternative considered: keep it as identity framing and scope
  the rule to outputs only — rejected for consistency, but cheap to revisit.)

- **Web typography rules are out of scope.** Two of impeccable's six rules
  (oversized hero headline, repeated section kicker labels) are about web layout
  and have no analog in Obsidian prose. Not imported.

## Requirements

**New anti-slop rules (adapted to prose)**

- R1. Em-dash discipline. Publication-tier copy uses at most a couple of em-dashes
  per passage; commas, colons, periods, or parentheses otherwise. Internal-tier
  narrative may keep occasional em-dashes but must avoid pileups (no chains of
  dash-separated clauses in a single sentence).
- R2. No marketing buzzwords. Ban generic SaaS language ("streamline", "empower",
  "supercharge", "world-class", "enterprise-grade"); pick a concrete verb and noun
  that say what the work literally did. Cross-references rule 4.
- R3. No aphoristic / manufactured-contrast cadence. Avoid sections that land on a
  short rebuttal or a "not X, not Y — just Z" contrast triplet. Reserve such
  cadence sparingly; it reads as composed, not observed.
- R4. Theater framing (soft / opt-in). Prefer saying plainly what a thing does or
  does not do over dismissing it as "performative" or "theater".

**Application model**

- R5. The section defines two tiers and states which outputs fall in each, reusing
  rule 9's publication-vs-internal distinction. Each rule above states its
  publication-tier form and its internal-tier form where they differ (R1 differs;
  R2–R4 are effectively strict everywhere, only relaxed in degree).
- R6. The internal tier enforces a publication-safe floor: no single sentence,
  read alone, would fail the publication tier on em-dash pileup, buzzwords, or
  manufactured contrast.

**Integration with the existing voice**

- R7. The new section references rules 4 and 5 for buzzwords/concreteness instead
  of restating them. No rule in `_voice.md` contradicts another.
- R8. `_voice.md`'s own prose and examples obey the new rules at the tier
  appropriate to each (internal-tier for the narrative examples). At minimum, the
  line-3 opener is rewritten to a plain statement.

## Acceptance Examples

- AE1. Covers R1, R6. A pulse sentence reads "the split started but stalled when an
  OAuth callback issue surfaced — that's now the next blocker." One em-dash, lifts
  cleanly into a post → passes. A sentence with three dash-separated clauses →
  fails the internal floor and must be recast.
- AE2. Covers R3, R8. A weekly section ending "Not a sprint, not a slog — just
  steady" → fails (manufactured contrast). Recast to a plain observation → passes.
- AE3. Covers R2. "Streamlined the checkout to supercharge conversions" → fails.
  "Closed the MercadoPago checkout; the route is sandbox-ready" → passes.
- AE4. Covers R7. A draft of the new section that re-lists banned adjectives
  already in rule 4 → fails the dedupe requirement; it must reference rule 4
  instead.

## Scope Boundaries

- No new "portfolio post" output type — the user assembles the post by hand.
- No rework or version bump of `note-draft` for portfolio framing; it is the
  natural publication-tier exemplar but needs no change for this feature.
- No web typography rules (hero headline sizing, kicker labels).

## Success Criteria

- A fragment copied from any pulse into a Crewtives portfolio post reads as
  human-written prose, not AI cadence, without manual editing.
- `_voice.md` contains no internal contradiction and no example that violates its
  own rules at the relevant tier.
- The narrative flavor of the internal pulses (soft third-person, occasional
  em-dash, temporal continuity) is preserved — the change tightens, it does not
  flatten the voice.

## Sources / Research

- [impeccable.style/slop](https://impeccable.style/slop/) — source of the four
  copy rules and two (out-of-scope) typography rules.
- `src/prompts/_voice.md` — single source of truth for the voice; hard rules 1–9
  today. Rules 4 (no empty adjectives) and 5 (concreteness/evidence) overlap the
  buzzword and concreteness slop rules. Rule 9 establishes the
  publication-vs-internal surface taxonomy the tiers reuse.
- `src/core/template.ts` — `loadVoiceSpec()` injects `_voice.md` into every prompt
  via `<%= it.voice %>`, so a single edit propagates to all outputs. `_voice.md` is
  an unversioned bundled constant (edited in place; rule 9 was added this way),
  unlike the versioned `vN` prompt templates.
