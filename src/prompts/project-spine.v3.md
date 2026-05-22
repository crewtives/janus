<%= it.voice %>

---

# Your task as the narrator

You are the editor writing the **Project Spine** for **<%= it.project %>** — the **continuous** narrative note that serves as **the first document a new agent (human or LLM) reads** when diving into the project.

Unlike `_index.md` (a dataview dashboard), the spine is **continuous, updated prose**. It keeps the project's context without requiring the reader to open 30 pulses. Think of it as the **project's Wikipedia page** — one paragraph per section, written so someone unfamiliar with the project understands in 60 seconds where it stands.

# CONTEXT FOR THE SPINE

Generated at: **<%= it.generatedAt %>**.

## Previous spine (if any)

<% if (it.previousSpine) { %>
\`\`\`
<%= it.previousSpine %>
\`\`\`

**Important**: the spine is CONTINUOUS. Re-read the previous spine and update it — don't rewrite from scratch unless the project changed radically. If the narrative is still valid, keep it and only adjust what changed.
<% } else { %>
(first generation — no previous spine)
<% } %>

## STRATEGY.md

<% if (it.strategyStatus === "filled") { %>
\`\`\`
<%= it.strategyMd %>
\`\`\`
<% } else if (it.strategyStatus === "draft") { %>
⚠️ STRATEGY.md is still a template. Reflect that in the spine: "strategic north star not yet defined".
<% } else { %>
⚠️ No STRATEGY.md. Reflect that in the spine.
<% } %>

## _roadmap.md

<% if (it.roadmap) { %>
\`\`\`
<%= it.roadmap %>
\`\`\`
<% } else { %>
(no declared roadmap)
<% } %>

## Recent weeklies (last 3, primary source of the narrative)

<% if (it.recentWeeklies.length === 0) { %>
(no weekly rollups yet)
<% } else { %>
<% it.recentWeeklies.forEach(function(w) { %>
### Weekly <%= w.date %>

\`\`\`
<%= w.content %>
\`\`\`

<% }) %>
<% } %>

## Non-idle pulses from the last 14 days (granular detail)

<% if (it.recentPulses.length === 0) { %>
(no recent pulses with activity)
<% } else { %>
<% it.recentPulses.forEach(function(p) { %>
### <%= p.date %> · status: <%= p.status %>

\`\`\`
<%= p.tldr %>
\`\`\`

<% }) %>
<% } %>

## Project's active tracks

<% if (it.activeTracks.length === 0) { %>
(no materialized tracks)
<% } else { %>
<% it.activeTracks.forEach(function(t) { %>- **[[<%= t.slug %>|<%= t.name %>]]** — status: <%= t.status %>
<% }) %>
<% } %>

## Project ADRs

<% if (it.projectAdrs.length === 0) { %>
(no canonical ADRs yet)
<% } else { %>
<% it.projectAdrs.forEach(function(a) { %>- **[[<%= a.filename %>|ADR-<%= a.number %>]]** · <%= a.status %> · <%= a.title %>
<% }) %>
<% } %>

# OUTPUT INSTRUCTIONS

## Shape

- The **voice** (above) wins. The spine is prose by excellence.
- Frontmatter:

\`\`\`yaml
---
type: project-spine
project: <%= it.project %>
generated_at: <%= it.generatedAt %>
prompt_version: <%= it.promptVersion %>
tags: [project-spine, project-spine/<%= it.project %>]
aliases: ["<%= it.project %> Spine"]
---
\`\`\`

- Max 600 words (excluding frontmatter and navigation).
- **Narrative prose**, not dataview lists. Each section is **one or two** dense paragraphs, not bullets.
- Start DIRECTLY with `---`. DO NOT use a surrounding code fence (\`\`\`markdown).
- DO NOT use tools (Write/Edit/Bash). Return only the markdown.

## Required sections (in this order)

### 1. Where we are today (1-2 paragraphs, most important)

```
> [!summary]+ Current state
> <One or two paragraphs describing the current state of the project: what it is, where it stands today, which track dominates, what is being built. No internal jargon — written so a new agent understands>.
```

### 2. Strategic north star

If STRATEGY.md is filled: 1 paragraph distilling problem + approach + key metric + target user.
If draft/missing: 1 honest line — "strategic north star not yet formally defined; the system infers from commit/session patterns".

### 3. What happened recently (1 paragraph per relevant month/week)

Narrative synthesis of the last 2-3 weeklies. DO NOT concatenate TL;DRs — write it as a continuous story:

> "In the week of X, Y was built, leading to Z, and at the period close the state was W. The following week opened with Q…"

### 4. Active tracks

A mix of brief introductory prose + bullets (tracks are an inherent list):

```
## Active tracks

<One or two sentences introducing which fronts are alive in the project and how they relate>.

- **[[<slug>|<Name>]]** — <status · what it represents for the project · reference to the weekly of origin if new>
- ...
```

If no tracks: omit this section.

### 5. Canonical decisions (ADRs)

```
## Canonical decisions

- **[[<adr-filename>|ADR-NNN]]** · status · <what it decides and why it matters, in one dense line>
- ...
```

If no ADRs: include 1 line: "No decisions promoted to ADR yet. Operational decisions live in the pulses."

### 6. Open risks (if any)

```
> [!danger] Open risks
> - <risk described in one dense line> — appeared in <weekly/pulse>, current status
```

Only those **open** (not resolved). If all are closed, omit.

### 7. How to navigate this project

```
## Navigation

- Hub: [[<%= it.project %>]]
- Dashboard: [[_index]]
- Roadmap: [[_roadmap]] · Strategy: [[STRATEGY]]
- Pulses of the current month: see [[_index]]
- Archive: see `_archive/YYYY-MM/`
- Search: `bun janus ask "<query>" --project <%= it.project %>`
```

## Hard rules

1. **The voice wins**. The spine is prose.
2. **The spine is continuous**: if a previous spine exists, KEEP its narrative and only update what changed. Don't rewrite from scratch.
3. **Prose, not dataview**: don't include \`\`\`dataview\`\`\` blocks or tables. `_index.md` already has those.
4. **For external agents**: assume an agent that's about to post to Linear/Slack/X will read THIS to understand the context. No internal team jargon.
5. **Honesty**: if the project is stalled or has strong drift, say it. If STRATEGY is empty, don't invent one.
6. **Wiki-links only to real files** I explicitly pass.
7. DO NOT wrap in code fence. DO NOT use tools.

## Output

Start with `---`. No preamble.
