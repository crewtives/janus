---
title: i18n / bulk translation by subagents leaves residual strings — always grep-sweep afterwards
date: 2026-05-24
category: workflow-issues
module: i18n
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - Translating a large set of files from one language to another (i18n, locale switch)
  - Delegating a wide refactor across many files to one or more subagents
  - Refactoring identifier names across the codebase (rename, recategorize)
  - Bulk replacing a deprecated API across many callers
tags: [i18n, subagent, translation, grep-sweep, residuals, refactoring, workflow]
related_components: [src, tests, docs, prompts, mcp/server]
---

# i18n / bulk translation by subagents leaves residual strings — always grep-sweep afterwards

## Context
During the Hermes → Janus rebrand + Spanish → English translation sweep (commits `04381f5`, `5ca0b0d`, `532123b`), three subagents were launched in parallel to handle tests, code comments, and large docs. Several agents produced incomplete translations: runtime `console.log` strings retained accented Spanish characters, MCP tool descriptions were missed entirely, and a handful of test assertions still compared against Spanish-language fixtures. The fix was a manual grep-sweep after each subagent finished.

The pattern repeats whenever a wide refactor is delegated to one or more agents: the agents produce ~80–95% of the change correctly, then a sweep is needed to catch the long tail. **Plan for the sweep from the start.**

## Guidance

### The sweep commands that worked

After bulk translation work, run these to find residuals:

```bash
# 1. Spanish runtime strings in console output
grep -rEn 'console\.(log|warn|error).*[áéíóúñÁÉÍÓÚÑ¡¿]' src/ scripts/

# 2. Spanish strings in test assertions and fixtures
grep -rEn '[áéíóúñÁÉÍÓÚÑ¡¿]' tests/

# 3. Spanish in prompts (these have a separate i18n story — voice is English now)
grep -rEn '[áéíóúñÁÉÍÓÚÑ¡¿]' src/prompts/

# 4. Spanish in docs (excluding intentional bilingual sections)
grep -rEn '[áéíóúñÁÉÍÓÚÑ¡¿]' docs/ README.md

# 5. MCP tool descriptions (user-visible, agents miss these)
grep -A 3 'description:' src/mcp/server.ts | grep -E '[áéíóúñÁÉÍÓÚÑ¡¿]'
```

### Where agents commonly fall short

- **Runtime `console.log` strings** are easy to miss because they're scattered across files and look like prose to an agent. Sweep with grep on accented characters
- **Test fixtures with embedded Spanish content** (mock pulse files, expected output strings) — agents either translate them (breaking the test) or leave them (failing to translate). Either case requires manual review
- **MCP tool descriptions** in `src/mcp/server.ts` — these are user-visible (other MCP clients display them), but they look like data not code, so agents that focus on "code translation" skip them
- **Inline regex patterns** with Spanish substrings (e.g., `/Pulse anterior/`) — agents don't always recognize them as translatable content
- **Comment blocks** that explain WHY in Spanish — agents translate but lose the nuance; review by hand

### The pattern: delegate + sweep + verify

The right shape:

1. **Define scope precisely.** "Translate runtime strings in `src/` from Spanish to English, preserve identifier names, preserve regex patterns that match user content like 'Pulse anterior'."
2. **Delegate to subagent(s) in parallel.** One per area (tests, code comments, docs) tends to work. More than three parallel agents creates merge friction.
3. **Run the grep sweeps above.** Catch the long tail.
4. **Run the dev loop** (`bun test && bunx tsc --noEmit && bun run scripts/smoke-validate-phase1.ts`) — tests will fail on translated assertion strings that still compare against pre-translation values. Fix.
5. **Verify user-visible surfaces by hand** — README, MCP tool descriptions, CLI help, wizard prompts, error messages

### Bilingual exceptions

Some surfaces are intentionally bilingual:
- `bun janus init` wizard supports `--language es` (Spanish) — strings live in `src/core/init/strings.ts` with both English and Spanish translations
- User-facing config docs may keep Spanish examples for Spanish-speaking users
- Internal i18n PR descriptions may mix languages during translation work itself

Search the file before "fixing" what looks like a missed translation — it may be intentional.

### When NOT to delegate to subagents

- Small surfaces (< 5 files, < 200 lines total) — do it by hand
- Highly contextual rewrites where the translation depends on understanding the surrounding code semantics — agents often produce technically-correct but tonally-wrong output
- Anything load-bearing where a missed string is catastrophic (e.g., security-critical comments, schema field names) — review every change

## Why This Matters
- Delegating to agents is faster than doing it by hand for large surfaces, but only if you plan for the sweep
- "I'll just check it later" is how regressions ship. Bake the grep step into the workflow from the start
- The 5-second grep sweep catches issues that take 30+ minutes to diagnose otherwise (Spanish string crashes a JSON parser, fails a test on a non-Spanish CI runner, etc.)

## When to Apply
- Any bulk translation, rename, or refactor delegated to one or more subagents
- Any wide find-and-replace across many files where the replacement requires judgment
- After merging a multi-agent feature branch, before claiming it done

## Examples

**Correct workflow (i18n sweep on this codebase):**
```bash
# Run subagents in parallel
# (delegated via Agent tool calls in Claude Code)

# Sweep for residuals
grep -rEn '[áéíóúñ]' src/ tests/ docs/ README.md

# Fix surfaces agents missed
$EDITOR src/mcp/server.ts   # tool descriptions

# Run dev loop
bun test && bunx tsc --noEmit && bun run scripts/smoke-validate-phase1.ts
```

**Wrong workflow:**
```bash
# Delegate to agents
# Trust the result without verification
git commit -am "i18n: translate everything"
# 3 days later: Spanish strings crash a parser, console output is mixed
```

## Related
- [Dev loop three gates](dev-loop-three-gates.md)
- [Testing no real LLM](testing-no-real-llm-no-real-vault.md)
- Commits `04381f5`, `5ca0b0d`, `532123b` — the actual translation sweep
- `src/core/init/strings.ts` — the intentional bilingual surface
