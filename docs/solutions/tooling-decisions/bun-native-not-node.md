---
title: Bun-native runtime — bun:sqlite, Bun.file, Bun.spawn, Bun.Glob, never Node polyfills
date: 2026-05-24
category: tooling-decisions
module: runtime
problem_type: tooling_decision
component: tooling
severity: high
applies_when:
  - Choosing an API for filesystem, subprocess, glob, or SQLite operations
  - Reviewing a PR that imports from `node:fs/promises`, `child_process`, or `better-sqlite3`
  - Adding a new dependency that has a Bun-native equivalent
  - Considering a port to Node
tags: [bun, sqlite, runtime, no-node, dependency-discipline, bun-spawn]
related_components: [core/checkpoint, core/obsidian, runners]
---

# Bun-native runtime — bun:sqlite, Bun.file, Bun.spawn, Bun.Glob, never Node polyfills

## Context
Janus is Bun-native by design. The choice is structural, not aesthetic: Bun's APIs (`bun:sqlite`, `Bun.file`, `Bun.spawn`, `Bun.Glob`, import attributes) are simpler, faster, and don't require a separate dependency. `bun build --compile` produces a single-file binary that includes the runtime — only achievable because the code does not depend on Node-specific shapes. Porting to Node is a separate project, not a refactor.

## Guidance

### The substitution table

| Need | Bun-native (use this) | Node equivalent (avoid) |
|---|---|---|
| Read a text file | `Bun.file(path).text()` | `fs/promises.readFile(path, "utf-8")` |
| Read text at build time | `import x from "../x.md" with { type: "text" }` | (no Node equivalent — this is Bun-only) |
| Write a file | `Bun.write(path, content)` | `fs/promises.writeFile(...)` |
| Spawn a subprocess | `Bun.spawn([cmd, ...args], { stdin: "pipe", ... })` | `child_process.spawn(...)` |
| Glob files | `new Bun.Glob("**/*.md").scan(...)` | `glob` package or `fs.readdir` recursion |
| SQLite | `import { Database } from "bun:sqlite"` | `better-sqlite3`, `sqlite3` packages |
| Check existence (fast) | `await Bun.file(path).exists()` | `fs.existsSync` (sync, blocking) |
| Read JSON at build time | `import pkg from "../package.json" with { type: "json" }` | `JSON.parse(readFileSync(...))` |

The few `node:` imports that exist (`node:path`, `node:os`, `node:crypto`, `node:fs/promises` for `mkdir`/`readdir` where Bun has no equivalent) are intentional and minimal. Search the codebase: `grep -rE "from ['\"]node:" src/` returns < 30 sites, all justified.

### Why this is load-bearing

**`bun build --compile`** requires the codebase to be Bun-aware. The compiled binary (`dist/janus`, 61 MB on macOS arm64) embeds the runtime and ships as a single file. Node-specific shapes don't survive compilation. The decision in `docs/_archive/HANDOFF-CI-DISTRIBUTION.md` to defer distribution was specifically about the prompt loading shape, not the Bun runtime — Bun-native is the path forward, not an obstacle.

**Bundled-string imports** for prompts (`with { type: "text" }`) are Bun-only and the reason `bun build --compile` can ship without a `prompts/` sidecar. See [bun-compile prompts](../integration-issues/bun-compile-prompts-md.md) for the failure mode that pinned this.

**`bun:sqlite` performance** is competitive with `better-sqlite3` but adds zero install footprint and supports WAL mode out of the box. The state DB at `.janus/state.db` is the single source of truth for idempotency, baselines, track lineage, decision graph, and blocker history.

### Dependency discipline

`package.json` has five runtime deps (`@clack/prompts`, `citty`, `eta`, `p-queue`, `p-retry`) and zero `@types/node`. Adding a new dependency requires a strong reason and a maintainer sign-off (AGENTS.md Toolchain section). The install surface is intentionally small so the `bun install` step in CI takes ~3 seconds and so the compiled binary stays under 100 MB.

Adding a dep with a Bun-native alternative is rejected on principle. Example: don't add `glob` when `Bun.Glob` exists. Don't add `chalk` when `process.stdout.write("\x1b[...m...")` is fine.

## Why This Matters
- The distribution story (single-file binary via `bun build --compile`) depends on it
- Install time and binary size stay small enough to be a non-issue
- The runtime contract is one thing (Bun) instead of two (Bun in dev, polyfills in prod) — less surface to debug
- Performance: `bun:sqlite` + `Bun.file` are faster than the Node equivalents for the workloads Janus runs (read prompt files, write pulses, query FTS5)

## When to Apply
- Always — there is no carve-out. Even tests use Bun built-ins (`Bun.spawn` for subprocess tests, `Bun.file` for fixtures)
- Exception: when a `node:` core module is the cleanest way (`node:path.join`, `node:os.tmpdir`, `node:crypto.randomUUID`) and no Bun equivalent exists, the `node:` import is fine. These are part of Node's standard library and Bun supports them natively
- New runner adapter? Use `Bun.spawn`, not `child_process.spawn`
- New SQLite table? Use `bun:sqlite`, not `better-sqlite3`

## Examples

**Correct (current):**
```ts
import { Database } from "bun:sqlite";
const db = new Database(".janus/state.db");
db.exec("PRAGMA journal_mode = WAL;");
```

**Wrong:**
```ts
import Database from "better-sqlite3";   // adds 50 MB native binding, redundant
```

**Correct:**
```ts
import voiceSpec from "../prompts/_voice.md" with { type: "text" };
```

**Wrong:**
```ts
const voiceSpec = await fs.readFile(join(PROMPT_DIR, "_voice.md"), "utf-8");
// works in dev, breaks `bun build --compile`
```

## Related
- [bun-compile prompts](../integration-issues/bun-compile-prompts-md.md)
- [Vanilla MCP server](vanilla-mcp-server.md)
- AGENTS.md `## Toolchain` section — pins the rule
- `package.json` — the 5-dep runtime list
- `docs/_archive/HANDOFF-CI-DISTRIBUTION.md` — distribution path
