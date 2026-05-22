<%= it.voice %>

---

# Tu tarea — draft de Note para el portfolio

Generar un **draft de Note** para el portfolio público del usuario (estilo `crewtives.com/notes/`). El draft es un artículo corto (180-380 palabras de body) sobre **un tema concreto** del trabajo reciente del usuario: una decisión técnica notable, un patrón observado, un cambio de approach, una lesson learned.

Esto **no es un pulse**. Un pulse es histórico/factual; una Note es **reflexiva/opinada** — primera persona observacional, voz del founder pensando en voz alta sobre por qué construyó algo de cierta manera.

# CONTEXTO

**Topic del usuario**: <%= it.topic %>

<% if (it.title) { %>**Título sugerido**: <%= it.title %>
<% } %>**Slug**: <%= it.slug %>
**Fecha**: <%= it.date %>

# MATERIAL CRUDO

<% if (it.relevantPulses && it.relevantPulses.length > 0) { %>## Pulses relevantes (últimos N días)

<% it.relevantPulses.forEach(function(p) { %>### [[<%= p.filename %>|<%= p.date %>]] · <%= p.project %>

```
<%= p.body %>
```

<% }) %>
<% } %>

<% if (it.relevantWeeklies && it.relevantWeeklies.length > 0) { %>## Weeklies relevantes

<% it.relevantWeeklies.forEach(function(w) { %>### Weekly <%= w.date %>

```
<%= w.content %>
```

<% }) %>
<% } %>

<% if (it.relevantSpines && it.relevantSpines.length > 0) { %>## Spines de proyectos involucrados

<% it.relevantSpines.forEach(function(s) { %>### <%= s.project %>

```
<%= s.content %>
```

<% }) %>
<% } %>

<% if (it.relevantAdrs && it.relevantAdrs.length > 0) { %>## ADRs relevantes

<% it.relevantAdrs.forEach(function(a) { %>### [[<%= a.filename %>|ADR-<%= a.number %>: <%= a.title %>]]

```
<%= a.body %>
```

<% }) %>
<% } %>

# EJEMPLOS DEL PORTFOLIO (few-shot — replicá esta voz)

Estos 4 ejemplos son notes reales del portfolio del usuario. **Estudialos**: shape, longitud, tono, headers, transiciones. Tu output debe estar en este mismo registro.

## Ejemplo 1 — "I built a night agent for myself" (Topic: Agent-native, 2026-05-21)

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

## Ejemplo 2 — "Provider-portable agent runtimes" (Topic: Architecture, 2026-05-20)

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

## Ejemplo 3 — "Coding agents leave a paper trail — read it" (Topic: Tooling, 2026-05-18)

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

## Ejemplo 4 — "Building Acme: lessons from an agent-native product" (Topic: Agent-native, 2026-05-15)

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

# INSTRUCCIONES DE OUTPUT

## Shape obligatorio

- **H1**: título evocativo, **NO técnico**. Captura la idea central como observación o decisión, no como descripción literal del feature. Si el user pasó título sugerido, usalo o iteralo. Si no, inventalo de cero.
- **Frontmatter mínimo** (después del H1):
  ```
  **Topic:** <one-word-or-two, type-cased>
  **Date:** <fecha en formato "May 21, 2026">
  ```
  El topic puede ser: `Agent-native`, `Architecture`, `Tooling`, `Process`, `Product`, `Workflow`, etc. Pensá qué categoría agrupa esto en el portfolio. Si no aplica ninguna, inventá una corta.

- **Lead paragraph** (sin heading): **1 párrafo de 2-4 oraciones** después del frontmatter. Captura la observación central. Sin preámbulos tipo "I want to talk about" — empezar directo en la idea.

- **2-4 secciones H2** con headers narrativos cortos. Los headers son frases-observación, no descriptivos de feature:
  - ✓ "A pulse isn't a changelog"
  - ✓ "Don't feed the whole blob to a model"
  - ✓ "The CLI is the documentation"
  - ✗ "Pulse generation pipeline"
  - ✗ "Database schema"
  - ✗ "Implementation details"

- **Cuerpo de cada sección**: 1-3 párrafos cortos. Si hay sub-decisiones discretas, podés usar bullets con `**Bold lead.** Frase explicativa.` (como en Ejemplo 2). Si no, prosa pura.

- **Cierre opcional** (última sección, header tipo "The bigger point" / "Treat it like X" / observación destilada): un párrafo que generaliza el insight más allá del caso concreto. Si la nota es 100% técnica sin generalización, omitilo.

## Voz

- **Primera persona observacional**. "I built X", "The team committed to Y", "The trick was". No "we" plural si es trabajo individual.
- **Inglés**. El portfolio es en inglés.
- **Sin marketing**. No "amazing", "powerful", "innovative", "cutting-edge", "game-changing". Si la idea es interesante, mostrá el insight; no lo declares.
- **Específico**. Números concretos cuando los tengas ("50–200KB JSONL", "roughly a week of schema work", "5h rate limit"). No "many", "a lot", "some".
- **Anti-jerga sin explicar**. Si usás acrónimos (MCP, ADR, OAuth), no los expandís — el portfolio asume audiencia técnica.
- **Headers como afirmaciones, no descripciones**.
- **Honestidad sobre el tradeoff**. Si una decisión tuvo costo, decilo ("required roughly a week of extra schema work", "prohibitive on per-token API billing").

## Longitud

**180-380 palabras de body** (sin contar H1 + frontmatter). Cortar es disciplina — si te pasás de 380, recortá.

## Output

- Empezá con el `# <Título>`. **No** uses frontmatter YAML (los Topic/Date van como markdown bold después del H1, NO en un bloque `---` arriba).
- **No envolver en code fence**. Output es markdown directo.
- **No tools**. Solo devolvé el markdown como texto.
- **No incluyas la palabra "Lead" o "Abstract"** como header — el lead va sin heading, directo después del frontmatter.

## Resultado

Empezá DIRECTO con `# `. Sin preámbulo. El output ES el archivo final que se guarda en `<vault>/Notes/<%= it.slug %>.md`.
