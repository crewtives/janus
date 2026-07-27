---
title: Codex CLI integration
created: 2026-07-27
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Codex CLI integration

## Goal Capsule

Make Codex CLI a first-class Janus client and generation provider without weakening Janus's privacy, idempotency, or output-integrity guarantees. In a configured project, a Codex session must receive Janus project memory before substantive work; outside configured projects, the integration must be a silent no-op.

Authority order:

1. The behavior and scope confirmed in this planning session.
2. `AGENTS.md`, especially privacy, dependency, prompt-versioning, migration, and verification rules.
3. Existing runner, ingestion, MCP, init, and doctor contracts.
4. Current official Codex CLI and MCP behavior, verified again during implementation.

Stop implementation and open an issue before changing the `LLMRunner` interface, adding a dependency, or changing the SQLite schema. Do not solve Codex support by editing every tracked project's `AGENTS.md` or by exposing private project names, paths, transcripts, or vault contents in committed fixtures and documentation.

Execution profile: implement locally in dependency order, keep the existing Claude Code default, and return to the caller after the three repository verification gates pass. Committing, pushing, and opening a PR are outside this plan's execution tail unless requested separately.

## Product Contract

### Summary

Janus will support Codex in three related roles:

- Codex sessions become an additional source for nightly narrative generation.
- `codex exec` becomes an opt-in `LLMRunner` provider.
- Interactive Codex sessions receive Janus memory automatically when their current repository is tracked.

The memory preflight uses two layers. A Codex `session_start` hook provides deterministic injection and is required for full automatic-preflight support. MCP server `instructions` and a purpose-built read-only context tool provide a compatibility mode for Codex surfaces that consume MCP but do not execute local hooks; compatibility mode is useful but does not satisfy automatic preflight by itself.

### Problem Frame

Claude Code already discovered Janus autonomously because the MCP tool descriptions told the model that a project spine should be read first. That produced the desired behavior, but it was model-mediated rather than guaranteed by a hidden Claude hook. Codex can consume the same MCP server, yet Janus currently provides neither server-level startup instructions nor a one-call current-project bootstrap. Janus also hardcodes Claude Code transcript discovery and accepts only Claude Code or Gemini as generation providers.

### Requirements

- **R1 — Tracked-project preflight:** In the fully supported Codex mode, resolve the actual current working directory and attach the matching Janus context to the session-start event before the first user prompt is processed.
- **R2 — Safe no-op:** If the current directory is not within a configured project, return an explicit machine-readable `tracked: false` result to the integration while adding no narrative context to the model.
- **R3 — Canonical context:** The preflight context includes project identity, tracking status, the project spine when present, and concise guidance for querying deeper memory. A missing spine is a recoverable state, not an MCP or hook failure.
- **R4 — Agent-native fallback:** The MCP initialize response instructs capable clients to perform the current-project lookup first, and a single read-only MCP tool performs resolution plus context retrieval without requiring `list_projects` followed by `get_spine`.
- **R5 — Codex transcript ingestion:** Nightly processing discovers Codex session JSONL under the Codex home, selects sessions by repository and timestamp, and normalizes them into the same provider-neutral evidence consumed by pulse generation.
- **R6 — Feedback-loop prevention:** Sessions created by Janus's own headless Codex runner are ephemeral or otherwise deterministically excluded from ingestion.
- **R7 — Codex generation provider:** `"codex"` is valid for `provider` and `fallbackProvider`, invokes the prompt through stdin, parses structured CLI output, preserves abort/timeout/error semantics, and remains opt-in; `"claude-code"` stays the default.
- **R8 — Output integrity:** The Codex runner cannot modify the repository or vault during generation. It returns the generated markdown to Janus, which remains the only writer of artifacts.
- **R9 — Setup and diagnosis:** `janus init` can install or reconcile the Codex MCP and preflight integration idempotently, while `janus doctor` diagnoses CLI availability, authentication, MCP registration, hook support/trust, and configuration drift without exposing secrets.
- **R10 — Compatibility:** Existing Claude Code ingestion, Claude/Gemini runners, MCP tools, configs, compiled binaries, and scheduler behavior remain compatible.
- **R11 — Public-repo privacy:** Tests and docs use neutral projects and temporary homes/vaults. No real transcript text, personal path, or private project identifier enters the repository.
- **R12 — Dependency discipline:** The implementation adds no runtime dependency and no database migration.
- **R13 — Documentation:** README and MCP/setup documentation explain Codex provider selection, transcript ingestion, automatic memory behavior, fallback semantics, and troubleshooting.

### Primary Flow

1. Codex starts in a repository.
2. The installed session-start hook receives the event, calls Janus's context entry point with the event working directory, and emits additional context only when the repository is tracked.
3. Codex begins the task with the current spine and instructions for deeper Janus search already in context.
4. On surfaces without hook injection, MCP instructions offer best-effort compatibility but do not count as completion of R1.
5. During the nightly run, Janus ingests both supported interactive session sources, combines them with git history, and optionally uses `codex exec` to generate the artifact.

### Acceptance Examples

- **AE1:** Given a configured project and an existing spine, starting Codex anywhere inside that repository attaches that spine exactly once as session-start model context before the first user prompt is processed.
- **AE2:** Given a directory outside every configured project, startup succeeds with no Janus narrative added and no warning presented as an error.
- **AE3:** Given a configured project without a spine, startup identifies the project, explains that no spine exists yet, and leaves deeper Janus tools available.
- **AE4:** Given a client that ignores MCP `instructions` but supports the configured hook, the preflight still occurs.
- **AE5:** Given a client that supports MCP but not context-injecting hooks, doctor labels the integration “MCP compatibility mode,” and its first Janus interaction can resolve the current project with one read-only tool call; this state does not satisfy R1.
- **AE6:** Given a Codex transcript spanning midnight, each daily pulse receives only messages attributable to its target day.
- **AE7:** Given a nightly run using the Codex provider, the resulting headless session is not discovered as user work on the following night.
- **AE8:** Running Codex setup twice produces one equivalent MCP registration and one equivalent hook entry, preserving unrelated user configuration.
- **AE9:** A Codex process that exits non-zero, emits malformed JSONL, times out, or reports no final response becomes a correctly classified `RunnerError`; it never produces a successful empty pulse.
- **AE10:** The full existing Claude/Gemini suite passes unchanged apart from intentional provider-list expectations.

### Success Criteria

- Codex can be selected as a generation provider and complete a deterministic fake-runner pulse test.
- Fixture-backed Codex sessions contribute intent, decisions, blockers, tools, model, cwd, and timestamps without changing existing Claude summaries.
- MCP initialization advertises self-contained startup instructions and the bootstrap tool resolves tracked and untracked paths correctly.
- Setup is non-destructive and idempotent in a temporary home.
- All repository gates pass on macOS and Linux CI.

### Scope Boundaries

In scope:

- Codex CLI, its local session files, its MCP configuration, and its supported local hook mechanism.
- One provider-neutral ingestion layer shared by Claude Code and Codex.
- One core current-project resolver reused by MCP, hook-facing CLI output, init, and doctor.

Out of scope:

- Importing Codex cloud task history that is not present in local session JSONL.
- Replacing Janus's temporal narrative with raw transcript search.
- Requiring Codex to become the default provider.
- Editing user project instruction files to force memory lookup.
- Adding MCP SDKs, transcript-parser packages, or a new persistence table.
- General plugin/skill packaging for every coding agent.

## Planning Contract

### Key Technical Decisions

#### KTD1 — Treat guaranteed preflight and agent-native discovery as separate layers

Use a Codex `session_start` hook for deterministic injection when supported. Also add MCP `instructions` plus a one-call context tool because MCP instructions reproduce the mechanism that worked in Claude Code and cover Codex clients where local hooks do not run. Neither layer silently claims the guarantees of the other.

Rejected alternatives:

- MCP descriptions alone: useful but best-effort.
- Writing `AGENTS.md` into each tracked repository: intrusive, hard to revoke, and outside Janus's configuration ownership.
- A prompt-submit hook that searches every user prompt: unnecessarily repetitive; project context belongs at session start.

#### KTD2 — Resolve projects by canonical path containment in one pure core function

Create a project-context service that normalizes the supplied cwd, resolves symlinks where possible, and matches the most specific configured `repoPath`. Directory containment must be path-segment aware so `/work/alpha` does not match `/work/alpha-old`. MCP and hooks must not implement independent matching logic.

The returned structured shape should distinguish `untracked`, `tracked-without-spine`, and `tracked-with-spine`. It must not enumerate other configured projects when resolving an untracked path. Transcript ingestion reuses the same segment-aware path matcher so interactive and nightly tracking scope cannot diverge.

#### KTD3 — Keep MCP vanilla and make startup instructions concise

Extend `src/mcp/server.ts` directly, retaining newline-delimited JSON-RPC and zero dependencies. Add `instructions` to the initialize result with the first 512 characters carrying the complete current-project rule, because Codex may cap server instructions. Add read-only/destructive annotations only if the currently supported MCP protocol shape is verified against official documentation and pinned by tests.

#### KTD4 — Characterize Codex hook input/output before committing the installer contract

The installed Codex version exposes session-start hook configuration, but the implementation must first capture a privacy-safe fixture containing only field names, value types, cwd behavior, event ordering, and accepted response shape. The hook adapter then maps that contract to the core context service.

This is a hard gate. If the supported CLI cannot attach additional model context before the first user prompt is processed, stop and return for an explicit product decision; do not ship MCP-only behavior as completion of this plan.

#### KTD5 — Introduce provider-neutral ingestion before adding the Codex parser

Move source discovery and parsing behind an internal ingestion contract. Preserve Claude behavior through a Claude adapter, then add a Codex adapter that normalizes only characterized record types. Add `source: "claude-code" | "codex"` to normalized summaries and update the active daily-pulse template by creating `daily-pulse.v10.md`; never edit `daily-pulse.v9.md` in place.

Discovery must honor `CODEX_HOME` when set and otherwise use `~/.codex/sessions`. It must filter by session metadata `cwd`/repository rather than deriving project identity from folder-name encoding. Malformed and unknown event lines are ignored conservatively and covered by fixtures.

#### KTD6 — Run Codex headlessly with stdin, structured output, read-only sandbox, and ephemeral state

Implement `CodexRunner` over `codex exec --json -`, passing the target cwd explicitly, piping the prompt through stdin, selecting the configured model/effort only when supported, and using an ephemeral run so Janus-generated sessions cannot feed back into later pulses. Run under Codex's read-only sandbox and do not grant extra writable directories.

`RunnerCapabilities.disableTools` remains `false` unless the verified CLI offers a real tool-disable control. Read-only sandboxing proves filesystem safety but not absence of tool calls. Before enabling the adapter for artifact generation, characterize that it returns the requested markdown as its final response under this posture. If the existing capability contract cannot represent the safety distinction required by the pipeline, stop and open the prerequisite interface-change issue mandated by `AGENTS.md`.

Do not use an auto-approval or bypass-sandbox mode. Enabling the provider is contingent on verified isolation from user hooks and MCP servers as well as filesystem write denial. If the supported CLI cannot provide both while retaining authentication, stop and return for an architecture decision. Characterization must attempt writes to the repository and vault and verify that unrelated hooks/MCP servers do not execute.

#### KTD7 — Parse events, not terminal presentation

The runner consumes Codex JSONL events and records the final response from the documented terminal event. It drains stderr concurrently, retains a bounded diagnostic tail, classifies missing CLI/auth/invalid-input failures as non-retriable, and preserves partial output only for diagnostic fallback. Tests construct fake process streams; they never invoke a real model.

#### KTD8 — Reconcile user configuration structurally and idempotently

Codex setup should prefer the supported `codex mcp add` command when it can be tested without losing unrelated configuration. Hook configuration is merged structurally into the Codex hook file, keyed by a stable Janus identifier. Setup preserves unrelated MCP servers and hooks, does not duplicate entries, and uses atomic replacement plus a privacy-safe recovery strategy.

Because timestamped backups beside user configuration can leak secrets, do not create unmanaged backup files. Tests use an injected temporary home and fake command runner.

Init stages all Codex choices before its existing commit step. The installed hook stores an absolute Janus command specification and an explicit stable config reference, so it works outside the Janus checkout. U1 selects one MCP mutation strategy: either a characterized `codex mcp add` performed at commit with compensating recovery, or an in-process atomic merge only if it can be implemented without a new parser dependency. Partial MCP/hook installation is diagnosed and repairable, never reported as full health.

#### KTD9 — Make model configuration provider-aware

The current loader materializes Claude defaults (`sonnet` and `opus`) before runner selection. Codex must not receive those values implicitly. Preserve whether model settings were user-specified or introduce provider-keyed settings so each adapter receives only valid model names; define primary/fallback behavior for mixed providers and keep existing Claude defaults backward-compatible.

### High-Level Technical Design

```text
interactive Codex session
        |
        +-- session_start hook --------+
        |                              |
        +-- MCP initialize instructions|   (fallback)
                                       v
                         core/project-context
                         | path -> tracked state
                         | tracked -> spine/context
                                       |
                          hook response / MCP tool

nightly Janus pipeline
        |
        +-- ingest registry --> Claude adapter
        |                  \--> Codex adapter
        |                         |
        |                 normalized SessionSummary[]
        |
        +-- runner registry --> CodexRunner --> final markdown
                                            (stdin, JSONL,
                                             read-only, ephemeral)
```

### Sequencing

1. Characterize the local Codex session, hook, and `exec --json` contracts with sanitized fixtures; stop if context injection, runner isolation, or feedback-loop prevention has no enforceable contract.
2. Add the shared project-context service and expose it through MCP.
3. Add the hook-facing command and idempotent setup/doctor integration.
4. Refactor ingestion and add the Codex session adapter.
5. Add `CodexRunner` and provider configuration.
6. Complete integration tests, docs, compile smoke coverage, and privacy audit.

The characterization unit is a gate: later units may adjust exact event field names and hook response fields, but not the product requirements or safety posture.

### System-Wide Impact

- **Prompt context:** pulse prompts gain a session-source label and Codex-normalized evidence; the voice and temporal artifact shape remain unchanged.
- **Data lifecycle:** no new database state. Interactive context is read from existing vault notes, and transcript discovery remains filesystem-based.
- **Privacy:** the MCP bootstrap returns only the matched project. The headless runner remains behind the existing redaction wrapper.
- **Distribution:** new prompt text and any hook runtime asset must work in `bun build --compile`; arbitrary runtime reads from source `.md` files remain forbidden.
- **Operations:** scheduler semantics do not change. Doctor gains Codex-specific checks only when Codex is configured or its integration is installed.

### Risks and Mitigations

- **Codex CLI format churn:** keep parsing tolerant, pin fixtures to characterized event variants, and document the minimum supported Codex version.
- **Hook trust/version differences:** treat hook support as a diagnosed capability; retain MCP instructions as a functional fallback.
- **Generated-session feedback loop:** U1 must prove that ephemeral runs emit no ingestible session, or establish a stable Janus marker that U4 filters. The provider fails closed if neither invariant is available.
- **Read-only runner still attempts tools:** characterize final-output behavior and keep post-generation validation load-bearing. Open the interface issue if stronger enforcement cannot be represented.
- **Config corruption:** inject filesystem and process boundaries in tests, merge known keys only, write atomically, and preserve unrelated entries.
- **Oversized startup context:** inject the spine and compact tool guidance, not search results or raw transcripts. Deeper history remains on-demand through `janus_ask`.
- **Path aliasing:** canonicalize existing paths and test symlinks, nested repositories, sibling prefixes, and deleted/missing paths.

## Implementation Units

### U1. Characterize Codex contracts and establish fixtures

**Goal:** Lock the supported Codex CLI behavior before designing parsers and configuration writes around assumptions.

**Requirements:** R1, R5, R6, R7, R8, R11.

**Files:**

- `tests/fixtures/codex/` — sanitized session, exec-event, and hook-contract JSONL/JSON.
- `docs/solutions/` — add a durable integration note only if characterization reveals a non-obvious constraint.
- `package.json` or docs only if a minimum Codex version must be stated; do not add dependencies.

**Approach:**

1. Record the supported `codex --version`, `codex exec --help`, MCP, hook-event, and hook-response contracts.
2. Build fixtures by retaining structural fields and neutralizing all prose, paths, IDs, and project names.
3. Prove whether `--ephemeral`, `--json`, explicit cwd, read-only sandbox, user-config isolation, and model/effort flags behave as required.
4. Identify the terminal event that contains the final assistant response and the error signals needed for retriability.
5. Prove that ephemeral execution creates no ingestible session, or define a stable Janus marker present in transcript metadata.
6. Verify that session-start output is attached before the first prompt and establish replay/duplicate-event behavior.

**Test scenarios:**

- Session JSONL contains user, assistant, tool, timestamp, cwd, model, and metadata records.
- Unknown record types and malformed lines are present.
- Hook fixture covers tracked cwd, nested cwd, and missing cwd.
- Exec fixture covers successful final response, process error, and missing terminal response.
- Attempted repository/vault writes are denied and configured user hooks/MCP servers are not invoked.
- Ephemeral output is absent from discovery, or a marked fixture is deterministically excluded.

**Verification:** Fixtures contain only neutral values; a repository-wide privacy grep finds no captured personal path or transcript content.

### U2. Add canonical current-project context and MCP bootstrap

**Goal:** Give every Janus client one safe operation for determining whether the current repository is tracked and retrieving its startup memory.

**Requirements:** R1, R2, R3, R4, R10, R12.

**Files:**

- `src/core/project-context.ts` — canonical path matching and context assembly.
- `src/mcp/server.ts` — `janus_get_project_context` and initialize `instructions`.
- `tests/project-context.test.ts` — path and context cases.
- `tests/mcp-server.test.ts` — initialize and tool protocol cases.

**Approach:**

1. Define a discriminated result for untracked, tracked-without-spine, and tracked-with-spine.
2. Match the most specific canonical configured repository containing the supplied cwd.
3. Read only the matched project's spine and return compact, structured text suitable for hook and MCP consumers.
4. Add the flat MCP definition and handler without extracting a framework or adding the MCP SDK.
5. Add concise initialize instructions that tell agents to call the tool with their actual working directory before project work.

**Test scenarios:**

- Exact root, nested directory, sibling-prefix collision, nested configured repos, symlink, missing path, and untracked path.
- Missing spine is successful structured output.
- Untracked output does not list configured projects or paths.
- MCP initialize includes capabilities, coherent server info, and self-contained instructions.
- Existing four tools remain wire-compatible.

**Verification:** `bun test tests/project-context.test.ts tests/mcp-server.test.ts`.

### U3. Install Codex preflight and diagnose its state

**Goal:** Make tracked-project memory injection deterministic on supported Codex CLIs and transparent when only the MCP fallback is available.

**Requirements:** R1, R2, R3, R4, R9, R10, R11.

**Files:**

- `src/commands/context.ts` — hook-facing command with structured stdin/stdout.
- `bin/janus.ts` — register the command.
- `src/core/init/codex.ts` — MCP and hook reconciliation.
- `src/core/init/index.ts`, `src/core/init/strings.ts` — wizard flow and English/Spanish copy.
- `src/core/doctor.ts` — Codex integration checks.
- `tests/context-command.test.ts`, `tests/init-codex.test.ts`, `tests/doctor.test.ts`.

**Approach:**

1. Adapt the characterized session-start payload to `project-context`.
2. Emit the exact Codex additional-context response only for tracked repositories; emit a valid empty/no-op response otherwise.
3. Add an init choice for Codex integration and reconcile MCP plus a stable Janus hook entry without changing unrelated user entries.
4. Make setup idempotent and safe for compiled-binary paths and minimal scheduler-like environments.
5. Doctor reports CLI/auth, MCP registration, hook availability/trust, executable path validity, and whether behavior is guaranteed or MCP-best-effort.
6. Persist an absolute command specification and explicit config reference; stage mutations until the existing init commit step.

**Test scenarios:**

- Tracked, untracked, missing-spine, malformed event, and unavailable config.
- Replayed/duplicate session-start events produce exactly one context attachment under the characterized lifecycle.
- Two setup runs are byte-equivalent or structurally equivalent.
- Existing user MCP servers/hooks survive setup.
- Invalid JSON/config fails without truncating the original.
- Doctor distinguishes missing CLI, logged-out CLI, missing MCP, unsupported hook, untrusted hook, and healthy integration.
- MCP-success/hook-failure and hook-success/MCP-failure preserve unrelated config, remain repairable, and never report full health.
- Source and compiled command specifications work outside the Janus checkout.

**Verification:** `bun test tests/context-command.test.ts tests/init-codex.test.ts tests/doctor.test.ts`.

### U4. Refactor transcript ingestion and add Codex sessions

**Goal:** Normalize Claude Code and Codex work into one evidence model without regressing date scoping or heuristics.

**Requirements:** R5, R6, R10, R11, R12.

**Files:**

- `src/ingest/types.ts` — source-neutral contract and source discriminator.
- `src/ingest/claude-code.ts` — existing discovery/parsing behavior moved intact.
- `src/ingest/codex.ts` — Codex discovery and normalization.
- `src/ingest/index.ts` — source registry/aggregation.
- `src/core/sessions.ts` and callers — compatibility facade or migration to the new module.
- `src/core/template.ts` — consume source-neutral summaries.
- `src/core/wrapped/personality.ts`, `scripts/eval-prompt-voice.ts` — audit direct session imports and define mixed-source behavior.
- `src/prompts/daily-pulse.v10.md` — provider-neutral session wording.
- `tests/sessions.test.ts`, `tests/ingest-codex.test.ts`, and affected prompt/template tests.

**Approach:**

1. Characterize existing Claude behavior with tests before moving it.
2. Make discovery roots injectable; resolve Codex home from `CODEX_HOME` or the default.
3. Associate Codex sessions with a project from normalized cwd metadata using the canonical project matcher from U2.
4. Reuse provider-neutral snippet heuristics where event meaning is equivalent and isolate provider-specific extraction where it is not.
5. Scope every normalized field to the target date, preserving cross-midnight behavior.
6. Mark summaries by source and exclude Janus headless sessions deterministically.
7. Version the prompt and describe “coding-agent sessions,” not Claude-specific sessions.

**Test scenarios:**

- Existing Claude fixtures produce equivalent summaries.
- Codex fixtures assert intent, decisions, blockers, tool names/counts, model, cwd, timestamps, user/assistant counts, edited files, commands, and source.
- Multiple projects, nested cwd, sibling-prefix collision, symlinked cwd, cross-midnight session, malformed lines, missing timestamps, and duplicate session IDs.
- `CODEX_HOME` override and absent sessions directory.
- Janus-generated ephemeral/marked sessions are excluded.
- Aggregating sources does not duplicate the same file or reorder output nondeterministically.

**Verification:** `bun test tests/sessions.test.ts tests/ingest-codex.test.ts` plus prompt/template tests.

### U5. Add the Codex LLM runner and provider configuration

**Goal:** Allow nightly generation through Codex without granting artifact-write access or changing the default provider.

**Requirements:** R6, R7, R8, R9, R10, R12.

**Files:**

- `src/runners/codex.ts` — adapter and structured-event parser.
- `src/runners/registry.ts` — `"codex"` provider registration.
- `src/config/types.ts`, `src/config/loader.ts`, `config.example.json` — valid provider and examples.
- `src/pipeline/orchestrator.ts` — pass only provider-valid explicit/default model settings.
- `src/core/doctor.ts`, init provider selection/strings — availability and auth checks.
- `tests/runners-codex.test.ts`, `tests/runners-registry.test.ts`, `tests/config.test.ts`, and init/doctor tests.

**Approach:**

1. Build CLI args from characterized flags; send only flags in argv and the prompt through stdin.
2. Use explicit cwd, JSONL output, read-only sandbox, ephemeral execution, and verified user-hook/MCP isolation; fail closed if these guarantees are unavailable.
3. Drain both output streams, handle abort/timeout, and parse the terminal final response.
4. Declare capabilities honestly and retain the existing redaction/fallback wrapper ordering.
5. Reject successful exits with no usable final response.
6. Add Codex auth/version checks using supported non-interactive commands with bounded timeouts.
7. Make defaults provider-aware so Codex never inherits implicit Claude model names; cover mixed-provider primary/fallback combinations.

**Test scenarios:**

- Exact argv omits prompt text and all writable/approval-bypass flags and includes the characterized config isolation.
- Large prompt passes through stdin.
- Successful multi-event stream, stderr pressure, malformed event, non-zero exit, timeout, abort, empty final response, and partial response.
- Model/effort mapping for supported and unsupported values.
- Unset, explicit, and mixed-provider model/fallback settings never cross provider namespaces.
- Registry accepts Codex while preserving Claude default and cross-provider fallback.
- Privacy wrapper redacts before Codex receives the prompt.

**Verification:** `bun test tests/runners-codex.test.ts tests/runners-registry.test.ts tests/config.test.ts`.

### U6. Complete end-to-end coverage, documentation, and release safety

**Goal:** Prove the three Codex roles work together and leave a clear operator path.

**Requirements:** R1–R13.

**Files:**

- `README.md`, `docs/mcp.md`, `docs/FAQ.md`, `docs/STATUS.md` — setup, behavior, fallback, troubleshooting, and shipped status.
- `scripts/smoke-validate-phase1.ts` — compiled/runtime checks where appropriate.
- Integration tests under `tests/` using temporary homes, repositories, vaults, and fake subprocesses.
- `CHANGELOG.md` when implementation ships.

**Approach:**

1. Exercise init → doctor → context/MCP using a temporary home and neutral tracked/untracked repositories.
2. Exercise mixed-source ingestion → fake Codex runner → validated pulse without a real model or vault.
3. Compile the binary and smoke the new command, MCP initialize instructions, and embedded `daily-pulse.v10.md`.
4. Document both guarantees: hook-backed automatic preflight and MCP-instruction fallback.
5. State the minimum supported Codex CLI version discovered in U1 and how doctor reports older versions.
6. Run a privacy grep over committed examples, fixtures, docs, and the final diff.

**Test scenarios:**

- Fresh Codex-only setup.
- Existing Claude setup augmented with Codex.
- Codex as primary with Claude/Gemini fallback and vice versa.
- Hook unavailable but MCP healthy is diagnosed as incomplete compatibility mode and does not satisfy R1.
- Compiled binary invoked from a directory outside the Janus checkout.
- Re-running a pulse remains idempotent.

**Verification:** All commands in the Verification Contract, plus inspection that compiled execution does not depend on source-tree prompt or hook files.

## Verification Contract

During implementation, run focused tests after each unit. Before claiming completion, run exactly the repository gates:

```bash
bun test
bunx tsc --noEmit
bun run scripts/smoke-validate-phase1.ts
```

Additional release checks:

```bash
bun build --compile bin/janus.ts --outfile /tmp/janus-codex-plan-smoke
/tmp/janus-codex-plan-smoke --help
```

The implementation must not call a real Claude, Gemini, or Codex model in tests. CLI process behavior is covered with injected fakes or privacy-safe fixture streams. Filesystem tests use temporary homes, repositories, and vaults. Platform-specific hook behavior gets explicit supported/unsupported assertions rather than being silently skipped.

Privacy verification must inspect the final diff and fixtures for home-directory prefixes, captured UUIDs, personal email addresses, non-Janus project names, and transcript prose. The exact grep terms should be derived locally and must not be copied into the public plan or commit message.

## Definition of Done

- R1–R13 each have a passing test or an explicit documentation-only verification.
- Codex startup context is guaranteed through a verified session-start hook; an MCP-only compatibility state is accurately diagnosed but does not satisfy this plan's completion contract.
- The untracked-directory path is silent and does not reveal configured projects.
- Claude and Codex transcripts produce source-neutral, date-scoped summaries; Janus headless sessions do not feed back into the narrative.
- `CodexRunner` uses stdin, structured output, read-only sandboxing, ephemeral execution, existing privacy redaction, and correct `RunnerError` semantics.
- Existing Claude/Gemini behavior and the Claude default remain intact.
- Init is idempotent and preserves unrelated Codex configuration; doctor explains every degraded state.
- No dependency, SQLite migration, or `LLMRunner` interface change was introduced without the required issue/sign-off.
- The active prompt is a new version and the compiled binary contains every required runtime asset.
- All three repository gates and the compiled-binary smoke pass.
- Documentation explains setup, automatic memory behavior, fallback limits, and troubleshooting with neutral examples.
- The final diff contains no abandoned experimental code, generated test state, private identifiers, or unmanaged configuration backups.

## Appendix

### Sources and Research

Repository sources:

- `src/core/sessions.ts` — Claude-specific discovery, date scoping, and normalization baseline.
- `src/runners/types.ts`, `src/runners/registry.ts`, `src/runners/claude-code.ts` — provider contract and safety behavior.
- `src/mcp/server.ts`, `docs/mcp.md` — vanilla MCP surface and current client guidance.
- `src/core/init/`, `src/core/doctor.ts` — configuration and diagnostic boundaries.
- `docs/solutions/architecture-patterns/llm-runner-abstraction.md` — capability honesty, redaction ordering, stdin contract, and issue boundary.
- `docs/solutions/runtime-errors/claude-p-prompt-via-stdin.md` — prompts must not enter argv.
- `docs/solutions/runtime-errors/llm-subprocess-write-tool-corruption.md` — artifact writers must stay outside the model subprocess.
- `docs/solutions/tooling-decisions/vanilla-mcp-server.md` — keep the MCP implementation flat and dependency-free.
- `docs/solutions/integration-issues/launchd-systemd-minimal-path.md` — absolute executable paths and clean environment behavior.
- `docs/solutions/best-practices/testing-no-real-llm-no-real-vault.md` — fake runners and temporary filesystem boundaries.

External sources to re-verify during U1:

- [OpenAI Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp) — stdio configuration, project configuration, MCP initialize instructions, and CLI registration.
- [OpenAI Codex CLI reference](https://developers.openai.com/codex/cli/reference/) — `codex exec`, structured output, sandbox, cwd, model, and ephemeral flags.
- [OpenAI Codex configuration reference](https://developers.openai.com/codex/config-reference/) — `CODEX_HOME`, project/user configuration, and supported hook settings.

Local historical evidence established only the behavioral premise: Claude Code autonomously called Janus project-list and spine tools at the start of a tracked-project task because of MCP tool descriptions. No private transcript, path, project identity, or identifier is part of this artifact.
