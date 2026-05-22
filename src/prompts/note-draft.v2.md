<%= it.voice %>

---

# Your task — Note draft for the portfolio

Generate a **Note draft** for the user's public portfolio (style of `crewtives.com/notes/`). The draft is a short article (180-380 words of body) about **one concrete topic** from the user's recent work: a notable technical decision, an observed pattern, an approach change, a lesson learned.

This **is not a pulse**. A pulse is historical/factual; a Note is **reflective/opinionated** — first-person observational, the founder's voice thinking out loud about why something was built a certain way.

# CONTEXT

**User topic**: <%= it.topic %>

<% if (it.title) { %>**Suggested title**: <%= it.title %>
<% } %>**Slug**: <%= it.slug %>
**Date**: <%= it.date %>

# RAW MATERIAL

<% if (it.relevantPulses && it.relevantPulses.length > 0) { %>## Relevant pulses (last N days)

<% it.relevantPulses.forEach(function(p) { %>### [[<%= p.filename %>|<%= p.date %>]] · <%= p.project %>

```
<%= p.body %>
```

<% }) %>
<% } %>

<% if (it.relevantWeeklies && it.relevantWeeklies.length > 0) { %>## Relevant weeklies

<% it.relevantWeeklies.forEach(function(w) { %>### Weekly <%= w.date %>

```
<%= w.content %>
```

<% }) %>
<% } %>

<% if (it.relevantSpines && it.relevantSpines.length > 0) { %>## Spines of projects involved

<% it.relevantSpines.forEach(function(s) { %>### <%= s.project %>

```
<%= s.content %>
```

<% }) %>
<% } %>

<% if (it.relevantAdrs && it.relevantAdrs.length > 0) { %>## Relevant ADRs

<% it.relevantAdrs.forEach(function(a) { %>### [[<%= a.filename %>|ADR-<%= a.number %>: <%= a.title %>]]

```
<%= a.body %>
```

<% }) %>
<% } %>

# PORTFOLIO EXAMPLES (few-shot — replicate this voice)

These 4 examples are real notes from the user's portfolio. **Study them**: shape, length, tone, headers, transitions. Your output must match this register.

## Example 1 — "I built a night agent for myself" (Topic: Agent-native, 2026-05-21)

```
# I built a night agent for myself

**Topic:** Agent-native
**Date:** May 21, 2026

Janus runs every night, reads my projects, and writes the engineering narrative I won't remember on Friday — pulse per project, compounded into weekly, monthly, and a continuous per-project spine.

I have too many projects open at once. By Friday I genuinely can't tell you which one I unstuck on Tuesday. The information was always there — git logs, session transcripts, half-written plans — but the synthesis was not. So I built Janus: an agent that runs every night, reads each repo, and writes the narrative for me.

## A pulse isn't a changelog

A changelog says what shipped. A pulse says what was decided, what got stuck, and what got abandoned. The abandoned column is the most valuable — it's the cheapest possible record of "do not retry this path." Changelogs throw it away every release. The pulse keeps it, dated and attributed.

## Compounding into narrative

One pulse per project per day is fine. The value shows up at the rollup tier: weekly across projects, monthly themes, quarterly arcs, and a per-project "spine" written as continuous narrative instead of bullet lists. Of all those artifacts, the spine is the only one I re-read voluntarily — because it's the only one written as a story rather than a manifest. The generalization holds: bullets are for triage, narrative is for memory.

## Runs on agents or LLMs

Janus is built to drive either a coding-agent CLI (Claude Code, Gemini CLI) or a direct LLM, behind one runner interface. The reason matters: nightly runs across five projects would be prohibitive on per-token API billing, but viable when the orchestrator can route through an agent CLI on a flat-rate subscription. The abstraction makes both modes possible without rewriting any orchestration code — and lets the system survive whichever billing model the provider lands on next.
```

## Example 2 — "Provider-portable agent runtimes" (Topic: Architecture, 2026-05-20)

```
# Provider-portable agent runtimes

**Topic:** Architecture
**Date:** May 20, 2026

Each adapter declares its capabilities and execution method. The orchestrator remains agnostic to which CLI it invokes, enabling a one-line config change to swap providers. A fallback mechanism retries failed operations on secondary runners, with error classification residing in adapters rather than orchestration logic.

## A few things that turned out to matter

**Capability flags over lowest common denominator.** Adapters expose individual feature support — cost tracking, session resume, JSON streaming — rather than limiting all to shared features.

**Prompt via STDIN.** Command-line arguments hit size limits (~128KB). A long system prompt plus context breaks at the OS layer before the CLI processes it, making STDIN the more reliable approach.

**Authentic cost reporting.** When providers don't expose per-call costs, the cost field remains null rather than estimated, avoiding discrepancies from plan-tier discounts, free quota, and rate-limit penalties.

## The bigger point

The orchestration layer — not the runner itself — constitutes the core product value. Infrastructure decisions should accommodate provider changes without system-wide ripple effects.
```

## Example 3 — "Coding agents leave a paper trail — read it" (Topic: Tooling, 2026-05-18)

```
# Coding agents leave a paper trail — read it

**Topic:** Tooling
**Date:** May 18, 2026

Git reveals what shipped. Session transcripts from coding agents show what was decided, attempted, and abandoned — where the engineering narrative truly exists.

## What git deliberately throws away

Commits represent the final state after squashing, rebasing, and message refinement. The actual journey — failed attempts, type errors, reverts due to conflicts — disappears. Session transcripts preserve these dead ends, which offer valuable guidance on paths to avoid.

## Don't feed the whole blob to a model

Raw session files (50–200KB in JSONL format) overwhelm AI models with noise. Extracting three core signals — user request, decisions made, and blockers — compresses sessions to a few hundred tokens while maintaining readability. This requires both regex pattern-matching and contextual prompting to distinguish genuine decisions from exploratory thinking.

## Treat it like telemetry

Viewing agent sessions as IDE instrumentation enables teams to build extraction pipelines once, then automatically backfill useful engineering data across all future projects at no additional cost.
```

## Example 4 — "Building Acme: lessons from an agent-native product" (Topic: Agent-native, 2026-05-15)

```
# Building Acme: lessons from an agent-native product

**Topic:** Agent-native
**Date:** May 15, 2026

Most products add agent capabilities as an afterthought. Acme inverted this approach: the CLI came before the workbench, the MCP server came before the React app. Three architectural decisions drove this.

## Same contract, three surfaces

The team committed to a unified OpenAPI specification consumed by the workbench, CLI, and MCP server. This required roughly a week of extra schema work up front but paid dividends immediately. Adding endpoints required a single pull request and schema update across all three interfaces. The philosophy shifted so that releasing features to only one surface began to feel wrong.

## Auth has to be invisible

Agent systems fail when authentication is friction-heavy. The solution: if a human can sign in once and forget, an agent should get the same access on the same credentials. The MCP server and workbench share bearer tokens through one OAuth flow, eliminating separate agent authentication steps — inherently incompatible with agent design.

## The CLI is the documentation

The help system functions as the primary reference: every command has a one-line description, a verbose help block, and at least one runnable example. Agents reference these examples as few-shot prompts when selecting commands, and commands lacking examples show roughly 50% misuse rates.
```

# OUTPUT INSTRUCTIONS

## Required shape

- **H1**: evocative title, **NOT technical**. Capture the central idea as an observation or decision, not a literal feature description. If the user passed a suggested title, use it or iterate. Otherwise invent it from scratch.
- **Minimal frontmatter** (after the H1):
  ```
  **Topic:** <one-word-or-two, type-cased>
  **Date:** <date in "May 21, 2026" format>
  ```
  The topic can be: `Agent-native`, `Architecture`, `Tooling`, `Process`, `Product`, `Workflow`, etc. Think which category groups this in the portfolio. If none fit, invent a short one.

- **Lead paragraph** (no heading): **1 paragraph of 2-4 sentences** after the frontmatter. Capture the central observation. No preambles like "I want to talk about" — start directly in the idea.

- **2-4 H2 sections** with short narrative headers. Headers are observation-phrases, not feature descriptions:
  - ✓ "A pulse isn't a changelog"
  - ✓ "Don't feed the whole blob to a model"
  - ✓ "The CLI is the documentation"
  - ✗ "Pulse generation pipeline"
  - ✗ "Database schema"
  - ✗ "Implementation details"

- **Body of each section**: 1-3 short paragraphs. If there are discrete sub-decisions, you can use bullets with `**Bold lead.** Explanatory sentence.` (as in Example 2). Otherwise, plain prose.

- **Optional closing** (last section, header like "The bigger point" / "Treat it like X" / a distilled observation): a paragraph that generalizes the insight beyond the concrete case. If the note is 100% technical without generalization, omit it.

## Voice

- **First-person observational**. "I built X", "The team committed to Y", "The trick was". No plural "we" if it's individual work.
- **English**. The portfolio is in English.
- **No marketing**. No "amazing", "powerful", "innovative", "cutting-edge", "game-changing". If the idea is interesting, show the insight; don't declare it.
- **Specific**. Concrete numbers when you have them ("50–200KB JSONL", "roughly a week of schema work", "5h rate limit"). No "many", "a lot", "some".
- **Anti-jargon without explanation**. If you use acronyms (MCP, ADR, OAuth), don't expand them — the portfolio assumes a technical audience.
- **Headers as statements, not descriptions**.
- **Honesty about the tradeoff**. If a decision had a cost, say it ("required roughly a week of extra schema work", "prohibitive on per-token API billing").

## Length

**180-380 words of body** (excluding H1 + frontmatter). Cutting is discipline — if you go over 380, trim.

## Output

- Start with `# <Title>`. **Do not** use YAML frontmatter (Topic/Date go as markdown bold after the H1, NOT in a `---` block above).
- **Do not wrap in a code fence**. Output is direct markdown.
- **No tools**. Just return the markdown as text.
- **Do not include the word "Lead" or "Abstract"** as a header — the lead goes without a heading, directly after the frontmatter.

## Result

Start DIRECTLY with `# `. No preamble. The output IS the final file saved at `<vault>/Notes/<%= it.slug %>.md`.
