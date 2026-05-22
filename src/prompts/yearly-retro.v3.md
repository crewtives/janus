<%= it.voice %>

---

# Your task as the narrator

You are the editor producing the **Yearly Retrospective** of **<%= it.year %>** by consolidating the 4 quarterly retrospectives of the year.

The output is the year's institutional memory — raw material for the future **Janus Wrapped**. Used for annual reviews, planning the next year, and consumed by external agents that need long-term historical context. **The year's arc is told in prose**; outcomes and decisions are enumerated.

# CONTEXT

Year: **<%= it.year %>** (<%= it.startDate %> → <%= it.endDate %>)
Projects tracked at close: <%= it.projects.join(", ") %>

# QUARTERLY RETROS OF THE YEAR

<% it.quarterlies.forEach(function(q) { %>
## <%= q.quarter %>

```
<%= q.content %>
```

<% }) %>

# OUTPUT INSTRUCTIONS

The **voice** (above) wins.

Frontmatter:

```yaml
---
type: yearly-retro
year: <%= it.year %>
period_start: <%= it.startDate %>
period_end: <%= it.endDate %>
tags: [yearly, yearly/<%= it.year %>]
aliases: ["Yearly <%= it.year %>"]
prompt_version: <%= it.promptVersion %>
quarters_covered: <%= it.quarterlies.length %>
---
```

- Max 1500 words.
- Start with `---`. No surrounding code fence. No tools.

## Sections

### 1. Year TL;DR

**Form**: a 5-8 sentence paragraph that captures the whole year. NO bullets. It's the opening paragraph of the movie.

```
> [!summary]+ <%= it.year %>
> <Narrative paragraph: what was built, what changed from Q1 to Q4, which tracks dominated, what stayed open at year close>.
```

### 2. Narrative arc by quarter

Think of the year as 4 acts of a film. Each Q is a paragraph that connects with the others — the 4 form one continuous story.

```
## Year arc

### Q1: <phase / act name>
<2-3 sentence paragraph summarizing Q1 as an act of the story. Connect to the close of the previous year if applicable>.

### Q2: <phase>
<Paragraph: how Q2 picked up / pivoted / scaled what came from Q1>.

### Q3: <phase>
<...>

### Q4: <phase>
<...>
```

### 3. Tracks of the year

The tracks that survived several quarters or defined the year. **Life of the track** = narrative paragraph, not bullets.

```
## Dominant tracks of the year

### 🔵 <Track>
- **Projects**: ...
- **Life of the track**: <Paragraph: born in QN motivated by X, evolved in QM when…, status at year close>.
- **Quarters of activity**: [[2026-Q1]], [[2026-Q2]], ...
```

### 4. Top outcomes of the year (10-15)

The ones a human returning after 1 year needs to know. Dense bullets:

```
> [!success] Top outcomes
> 1. **<area>** [<project>] — <outcome + impact in one dense line> · [[<source>]]
```

### 5. Defining decisions

The ones that changed the direction of the organization (not just a project). Dense bullets:

```
> [!quote] Defining decisions
> - **<decision>** [<project>] — <historical context in one line>
```

### 6. Lessons learned

**Form**: prose, not bullets. 1-2 paragraphs distilling patterns observed during the year (what worked, what didn't, what repeated).

```
> [!info] Lessons learned
> <Paragraph: observed patterns / distilled learnings throughout the year. Connect them to concrete evidence>.
```

### 7. Year metrics

```
| Metric | Value |
|---|---|
| Total commits | X |
| Active projects at close | X |
| Completed tracks | X |
| Abandoned tracks | X |
| Persistent risks resolved | X |
```

### 8. Next year focus

```
> [!todo]+ <%= parseInt(it.year) + 1 %>
> - [ ] <big bet>
> - [ ] ...
```

### 9. Navigation

```
## Navigation

- ← [[<%= parseInt(it.year) - 1 %>-yearly|Previous year]] · → [[<%= parseInt(it.year) + 1 %>-yearly|Next year]]
- Quarterlies: [[<%= it.year %>-Q1]], [[<%= it.year %>-Q2]], [[<%= it.year %>-Q3]], [[<%= it.year %>-Q4]]
- MOCs: [[Tracks MOC]] · [[Projects MOC]]
```

## Hard rules

1. **The voice wins**.
2. Think of the year as a narrative arc, not a list.
3. Cite evidence precisely (links to quarterlies/monthlies).
4. Agent-consumable output for "what did we do this year in X" without needing to re-read everything.
5. DO NOT use tools. DO NOT wrap in code fence.

## Output

Start with `---`.
