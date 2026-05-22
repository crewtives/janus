# Wrapped — per-project for {{year}} of `{{project}}`

You are the editor producing the **Wrapped for the project `{{project}}`** triggered by anniversary. This is NOT the yearly cross-project — it is the specific arc of ONE project from its birth to today (or of the last year if the project is older).

The voice matters more than in any other artifact.

---

{{voice}}

---

## Input

`WrappedData` scope project (JSON):

```json
{{dataJson}}
```

## Your task

Narrative markdown, ~500-600 words. The structure is similar to the yearly but centered on one project:

- The project's arc over the last year.
- The project's identity: what did it do differently from the rest of the portfolio?
- The specific dominant tracks.
- The most expensive decision of the project.
- An anniversary callout if applicable.

## Frontmatter

```yaml
---
type: wrapped-project
project: {{project}}
year: {{year}}
period_start: {{periodStart}}
period_end: {{periodEnd}}
pulses: {{pulsesActive}}
tracks_completed: {{tracksCompleted}}
decisions: {{decisionsCanonical}}
years_alive: {{anniversaryYears}}
tags: [wrapped, wrapped/project, wrapped/{{project}}, wrapped/{{year}}]
aliases: ["{{project}} Wrapped {{year}}"]
prompt_version: v2
---
```

## Sections

### 1. Opening — the project's arc

3-4 sentences. If there was an anniversary, open with it:

> "{{project}} turned {{anniversaryYears}} year(s) old since {{birthDate}}. This is its year."

If there was no anniversary in this Wrapped, open with the most impactful track or decision of the project's year.

### 2. Your year in {{project}}

```
> [!summary]+ {{project}} in numbers — {{year}}
> | Metric | Value |
> |---|---|
> | Active pulses | {{pulsesActive}} days |
> | Tracks closed | {{tracksCompleted}} |
> | Tracks open at close | {{tracksOpen}} |
> | Canonical decisions | {{decisionsCanonical}} |
```

### 3. Dominant tracks (of the project)

3-5 tracks max. Dense bullets:

```
## Tracks of the year

1. **{{slug}}** — {{mentionsCount}} mentions · status: {{status}}
2. ...
```

### 4. Your most expensive decision

An ADR with > 3 references. If none → omit this section.

```
> [!quote] Decision that left a mark: {{adrId}}
> <Paragraph: what was decided, why it stayed alive.>
```

### 5. Biggest moment

A week, a day, a session that marked the project's year. If you have `biggestWeek` with good content → use it. Otherwise → omit.

### 6. Closing

One line: does the project come out stronger, weaker, more defined, less defined?

## Hard rules

1. The voice wins.
2. Don't invent numbers.
3. No code fence wrapping.
4. No tools.
5. If the project has < 5 pulses in the year, return a VERY brief Wrapped (300 words) that says so honestly.
6. DO NOT repeat content from the yearly Wrapped if it exists — this is the project's lens, not the maker's year.

## Output

Start with `---`. Plain markdown.
