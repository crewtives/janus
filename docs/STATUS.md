# Status — Janus

Product status snapshot as of **2026-05-22**, after shipping Phase 1 + 2 + 3 (full original roadmap).

> **Update 2026-06-16 (v0.2.8).** The original roadmap is still closed; everything
> below Phase 3 holds. What shipped *after* this snapshot is captured in
> [`CHANGELOG.md`](../CHANGELOG.md) — the live source of truth — and includes: the
> **privacy/redaction layer** (`src/core/privacy/`, wired in `resolveRunner`),
> **standalone-binary distribution** (curl one-liner + public Homebrew tap +
> `release.yml` building four platform binaries), **in-process vault scaffolding**
> (`src/core/scaffold/`, replacing the spawn-based scripts described below), the
> MCP `serverInfo.version` fix, `sync-roadmaps`, **Discord** notifications, and
> i18n. The suite is now **382 tests** (not 348). Code-signing and `npm publish`
> remain scaffolded-but-off pending external credentials (see `ROADMAP.md`).

## Positioning

Janus is **the maker's personal historian**. It reads your work (git + Claude Code sessions) and writes the **continuous narrative** of your projects in a temporal hierarchy: daily → weekly → monthly → quarterly → yearly → spine. That narrative is **queryable via MCP** by other agents — Claude Code in other sessions can ask Janus "what did we do in X last week?" and get synthesized context, not raw logs.

The moat is the **quality of narrative synthesis** and the **temporal hierarchy of compaction**. Output universality (Notion/Confluence/etc.) is copyable table-stakes and not a strategic bet.

## Phase 1 — Foundations · ✅ SHIPPED (2026-05-21)

### Phase 1A · Voice consistency overhaul ✅

- `src/prompts/_voice.md` — single voice spec injected into the 7 prompts via `<%= it.voice %>`
- Prompts bumped: `daily-pulse v5`, `daily-rollup v3`, `weekly v3`, `monthly v2`, `quarterly v2`, `yearly v2`, `spine v2`
- Hard rules: prose > bullets, soft third-person narrator, product-level language, no empty adjectives, cumulative continuity, honesty
- Side-by-side eval loop: `scripts/eval-prompt-voice.ts` + `docs/eval/voice-overhaul.md`

### Phase 1B · Multi-source ingestion ⏸ DEFERRED

Cursor sessions, Codex sessions, Linear, voice memos (Whisper), Calendar — all require interactive setup or local data that wasn't available.

### Phase 1C · Bookkeeping metadata ✅

3 new tables in `.janus/state.db`:

| Table | Persisted by | Enables |
|---|---|---|
| `project_metadata` | `getProjectBirthDates()` lazy (24h cache) | Anniversary detection · Wrapped birthdays |
| `track_lineage` | `recordTrackLineage()` from weekly/monthly | Open-loop detection · top-tracks in the Wrapped |
| `decision_graph` | `indexPulseDecisions()` from orchestrator post-pulse | Orphan decision detection · biggest decision in the Wrapped |

### Phase 1D · MCP server ✅

- `src/mcp/server.ts` — vanilla JSON-RPC 2.0 stdio, ~250 LOC, 0 external deps
- CLI: `bun janus mcp`
- 4 typed tools: `janus_ask`, `janus_get_spine`, `janus_get_pulse`, `janus_list_projects`
- Janus vs companion-agent doc in `docs/mcp.md`

### Vault scaffolding (post-Phase 1) ✅

> Since commit `7d9c565` this logic lives **in-process** under `src/core/scaffold/`
> (called directly by the orchestrator), not via `bun spawn` of the standalone
> scripts listed here — the spawn form broke under the compiled binary and
> launchd. The scripts below remain as the manual/CLI entry points.

Closing the gap detected during e2e: hubs/MOCs/dashboards weren't being generated automatically. Now they are:

- `scripts/generate-dashboards.ts` — 4 global dashboards (`Janus Pulse`, `Open Risks`, `Drift`, `Inferring`)
- `scripts/scaffold-vault.ts` — orchestrator that chains the 3 generators + fix-prev
- Auto-triggered at the end of `runPulse` (orchestrator.ts)
- `scripts/fix-pulse-anterior-links.ts` — deterministic post-process that repairs `Previous pulse` wiki-links hallucinated by the LLM (common on idle pulses)

### Architectural fix · Per-project serialization ✅

Detected during 7d backfill: with flat concurrency 2, dates from the same project were being processed in parallel → `previousPulseFilename` race → wiki-links skipped N → N-2. Fix: one p-queue task = all dates of a project processed serially. Global concurrency now parallelizes **projects**, not jobs.

## E2E validated (2026-05-21)

7d backfill across 7 projects × 7 days = **49 pulses generated**, 0 failures.

### Final vault inventory

| Type | Count |
|---|---|
| Individual pulses | 49 |
| Consolidated dailies | 7 |
| Weekly rollup | 1 |
| Narrative spines | 7 |
| Project hubs | 7 |
| `_index.md` | 7 |
| `_roadmap.md` | 6 (1 preserved by manual edit) |
| `STRATEGY.md` | 7 (templates) |
| Cross-project MOCs | 5 |
| Materialized tracks | 4 (2 cross-project: `acme-agent-native`, `posicionamiento-y-docs-acme`) |
| Global dashboards | 4 |
| **TOTAL .md** | **107** |

### Persisted state

- `pulse_state` × 49 (idempotency)
- `pulse_baseline` × 49 (feedback loop)
- `track_lineage` × 6 mentions (4 unique tracks, 2 cross-project)
- `decision_graph` × ~25 references (ADR-003 with 2, ADR-001 with 1, + candidates)
- `search.db` FTS5 — all docs indexed

### Tests

- **382 / 382 passing** as of 2026-06-16 (was 348 / 348 at the Phase 3 close)
- Clean typecheck
- Smoke validation script (`scripts/smoke-validate-phase1.ts`) with 14 checks, no LLM

## Phase 2 — Reflection layer · ✅ SHIPPED (2026-05-22)

| IU | Files | Notes |
|---|---|---|
| U1 — Open-loop tracks | `src/core/reflection/open-loops.ts` | open tracks with last_mentioned > 14d |
| U2 — Orphan decisions | `open-loops.ts` (shared) | ADRs without recent references |
| U3 — Stuck blockers | `stuck-patterns.ts` + `blocker_history` table | escalates over 2+ weeklies |
| U4 — Pattern detection LLM | `pattern-detector.ts` + `pattern-detection.v2.md` | confidence ≥ 0.6 |
| U5 — Reflection prompts (weekly) | `weekly-rollup.v5.md` + `question-preserve.ts` | preserves user answers |
| U6 — Reflection prompts (monthly) | `monthly-digest.v4.md` | analogous to U5 |
| U7 — Anniversary detection | `anniversaries.ts` + `daily-pulse.v8.md` | trigger callout + per-project Wrapped |
| U8 — "This day, last year" (daily) | `anchors.ts` + `daily-rollup.v5.md` | Timeline/Daily lookup |
| U9 — Anniversary per-project anchor | `anchors.ts` (shared) | pulse and _archive lookup |

New table: `blocker_history(blocker_hash, project, first_seen, last_seen, weekly_count, sample_text)`.

## Phase 3 — Janus Wrapped · ✅ SHIPPED (2026-05-22)

| IU | Files | Notes |
|---|---|---|
| U1 — Aggregator | `src/core/wrapped/aggregator.ts` + `types.ts` | metrics, top tracks/decisions, biggest week, birthdays, themes |
| U2 — Yearly renderer | `renderer.ts` + `wrapped-yearly.v3.md` | output `Wrapped/Wrapped-YYYY.md` |
| U3 — Personality | `personality.ts` + `wrapped-personality.v2.md` | 6 archetypes + Hybrid, deterministic + LLM |
| U4 — Per-project Wrapped | `renderer.ts` (project scope) + `wrapped-project.v2.md` | auto-trigger on anniversary |
| U5 — HTML | `html.ts` + `src/templates/wrapped.html/.css` | self-contained, embedded CSS |
| U6 — PNG (opt-in) | `png.ts` | `bun add -d puppeteer` opt-in |
| U7 — Trickle release | `trickle.ts` + wire in `daily.ts` | T-7/T-5/T-3/T-1/T-0 |
| U8 — `janus wrapped` CLI | `src/commands/wrapped.ts` | --year, --project, --dry-run, --format |

Original roadmap closed. Potential next directions in `docs/HANDOFF.md`.

### Graph topology improvements

Identified during the session, **not shipped**:

- Per-project sub-MOCs (`Projects/<x>/_decisions.md` etc.) to decongest global MOCs
- Reduce MOC links in pulses (each pulse links to 3 MOCs → hairball)
- Cross-pulse links based on shared tracks

Immediate code-free workaround: tweak **forces** in Obsidian's graph view (Repel ↑, Center ↓, Link distance ↑) + use **Local Graph** (`Ctrl+G` on any hub) instead of the global one.

## Getting started from scratch

```bash
# Setup
bun install
bun janus init                           # interactive wizard

# Smoke check (no LLM)
bun run scripts/smoke-validate-phase1.ts # 14 checks in ~30s

# First production run
bun janus pulse --backfill 7d            # ~30-45 min, calls Claude Max
bun janus rollup --week                  # ~5-10 min, weekly + spines + tracks

# After
# The vault is complete: 49 pulses + 7 dailies + 1 weekly + 7 spines +
# hubs + MOCs + dashboards + _index + _roadmap + STRATEGY templates.
# Open Obsidian → connected graph view.

# Expose as MCP to another session
bun janus mcp
# Connect via .mcp.json (see docs/mcp.md)
```

## Key Phase 1 commits (all on main)

```
4987508 feat(scaffold): deterministic post-process to repair 'Previous pulse' wiki-links
a4cc80f feat(scaffold): global dashboards + scaffold-vault + auto-trigger post-pulse
3582d3a fix(orchestrator): serialize dates per project to avoid breaking wiki-links
cd58715 chore: smoke validation script + morning brief for Phase 1 e2e
3f97ec0 feat(mcp): vanilla stdio MCP server with 4 tools — Phase 1D
09ab4a9 feat(bookkeeping): project metadata + track lineage + decision graph — Phase 1C
e5d783f feat(eval): side-by-side regeneration of pulses for voice overhaul
7b6df41 feat(prompts): voice consistency overhaul — Phase 1A
d7c0060 docs(plans): historian roadmap + tactical plans Phase 1/2/3
```

## Explicit product tradeoffs

- **Audience**: founder / indie hacker / OSS maintainer only. No enterprise team tooling. Smaller TAM, higher conversion, more authentic vibe.
- **Future monetization**: individual paid tier (no seats). Possible: open source core + paid hosted Wrapped generation / cloud sync.
- **Differentiation vs companion-agent**: both expose MCP, different layers (Janus = synthesized narrative, companion-agent = raw memory). Complementary stack, not competitors. See `docs/mcp.md`.
- **Differentiation vs Linear Insights / DX Engineering Metrics**: they're quantitative team-facing; we're qualitative individual-facing. No overlap.

## Closed tracks (explicitly deprioritized)

- **Output exporters** (Notion/Linear/Confluence/GitHub Wiki) — copyable, no moat. On-demand if a user asks.
- **Aggressive `enrich-vault`** (STRATEGY auto-generation, docs-that-write-themselves) — shifts to a different bet. We keep what's useful; no expansion.
- **Team/multi-user features** — outside the identity.
- **Generic observability/logging** — not the product.
