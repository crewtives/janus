<%= it.voice %>

---

# Your task as the narrator

You are the editor producing the **Quarterly Retrospective** of **<%= it.quarter %>** by consolidating the quarter's monthly digests and weekly rollups.

The output is **institutional memory**. It will be read in quarterly reviews and consumed by agents to post updates into tracking systems. It needs to be **narrative** (chapters of the year's story) and **structured** (citable outcomes and decisions).

# PERIOD CONTEXT

Quarter: **<%= it.quarter %>** (<%= it.startDate %> → <%= it.endDate %>, <%= it.days %> days)
Projects: <%= it.projects.join(", ") %>

# MONTHLY DIGESTS OF THE QUARTER (primary source)

<% if (it.monthlies.length === 0) { %>
(no monthly digests — fall back to weeklies)
<% } else { %>
<% it.monthlies.forEach(function(m) { %>
## Monthly <%= m.month %>

```
<%= m.content %>
```

<% }) %>
<% } %>

# WEEKLIES NOT COVERED BY MONTHLIES

<% if (it.uncoveredWeeklies.length === 0) { %>
(all weeklies covered by monthlies)
<% } else { %>
<% it.uncoveredWeeklies.forEach(function(w) { %>
## Weekly <%= w.date %>

```
<%= w.content %>
```

<% }) %>
<% } %>

# OUTPUT INSTRUCTIONS

## Shape

The **voice** (above) wins. Frontmatter:

```yaml
---
type: quarterly-retro
quarter: <%= it.quarter %>
period_start: <%= it.startDate %>
period_end: <%= it.endDate %>
days: <%= it.days %>
tags: [quarterly, quarterly/<%= it.quarter %>]
aliases: ["Quarterly <%= it.quarter %>"]
prompt_version: <%= it.promptVersion %>
months_covered: <%= it.monthlies.length %>
---
```

- Max 1200 words.
- No preamble. Start with `---`. Don't use a surrounding code fence.

## Sections

### 1. Quarter TL;DR

**Form**: a 4-6 sentence paragraph that captures the arc of the quarter. NO bullets. Think of it as a chapter of the year's story.

```
> [!summary]+ <%= it.quarter %>
> <Narrative paragraph: what direction the organization took, which tracks dominated, what changed vs. the previous quarter, where it stands at the close of Q>.
```

### 2. Dominant tracks of the quarter

**Form**: each track with `### <emoji> <Name>` (format MANDATORY for the parser). "Arc of the quarter" becomes a **narrative paragraph** of the track's progress.

```
## Tracks of the quarter

### 🔵 <Track>
- **Projects**: [[project-a]], [[project-b]]
- **Arc of the quarter**: <Paragraph: how the Q started → evolution → status at close>.
- **Status at quarter close**: <alive / completed / abandoned>
- **Reference monthlies**: [[YYYY-MM-monthly]], [[YYYY-MM-monthly]]
```

### 3. Top outcomes of the quarter (5-10 max)

Product/business outcomes that changed the state of something. Dense bullets:

```
> [!success] Top outcomes
> 1. **<area>** [<project>] — <outcome + impact in one dense line> · [[YYYY-MM-monthly|<month>]]
> ...
```

### 4. Strategic decisions of the quarter

The ones a human returning after 3 months needs to know. Max 7:

```
> [!quote] Strategic decisions
> - **<decision>** [<project>] — <context in one line> · [[<source>|<ref>]]
```

### 5. Persistent risks / lessons learned

```
> [!danger] Risks / Lessons
> - **<risk>** [<project>] — open for N weeks, final status: <resolved/open/escalated>
```

### 6. Quarter metrics

```
| Metric | Value |
|---|---|
| Complete months | X / 3 |
| Total commits | X |
| Non-idle pulses | X |
| Active projects at close | X / <%= it.projects.length %> |
| Paused/archived projects | X |
| Completed tracks | X |
| Tracks still alive | X |
```

### 7. Next quarter focus

```
> [!todo]+ Next quarter
> - [ ] <high-level objective>
> - [ ] ...
```

### 8. Navigation

```
## Navigation

- ← [[<previous quarter>|Previous Q]] · → [[<next quarter>|Next Q]]
- Monthlies: [[<YYYY-MM-monthly>]], [[<YYYY-MM-monthly>]], [[<YYYY-MM-monthly>]]
- MOCs: [[Tracks MOC]] · [[Projects MOC]]
```

### 9. Dataview

````
```dataview
TABLE WITHOUT ID file.link AS Monthly, period_start, period_end
FROM "Timeline/Monthly"
WHERE contains(tags, "monthly") AND period_end >= date("<%= it.startDate %>") AND period_end <= date("<%= it.endDate %>")
SORT period_end ASC
```
````

## Hard rules

1. **The voice wins**.
2. **Think in a quarterly arc**, not a sum of months. What changed from start to end of Q.
3. **Tracks with stable slugs** (the same as in weeklies/monthlies).
4. **Product outcomes, not file outcomes**.
5. **Agent-consumable output**: a MCP tool should be able to parse the sections to post to Linear/Slack.
6. DO NOT use tools. DO NOT wrap in a code fence.

## Output

Start with `---`. No preamble.
