# Roadmap

What's coming next. No promised dates — Janus ships at its own pace. Past direction lives in [`CHANGELOG.md`](CHANGELOG.md); closed and explicitly deprioritized tracks are in [`docs/STATUS.md`](docs/STATUS.md).

The order of items inside each section is roughly the order of intent, not a commitment.

## Distribution

### Windows support

Native Windows is currently out of scope ([FAQ](docs/FAQ.md#does-it-work-on-windows)) — the nightly scheduler is wired to launchd (macOS) and `systemd-user` (Linux). WSL works today because the installer auto-detects it and treats it as Linux.

What we'd like:

- **First pass — better WSL story.** Document the install path, add a WSL smoke check to `janus doctor` (detect WSL env, confirm `systemd-user` is enabled — it's off by default in some distros).
- **Second pass — native Windows.** Replace the per-OS scheduler module with a Task Scheduler backend (`src/core/init/task-scheduler.ts`), mirroring the platform-guard pattern in `src/core/init/{launchd,systemd}.ts`. Add a `windows-x64` build target to `release.yml` (`bun build --compile --target=bun-windows-x64`). The release installer is already structured to add a new OS branch.

### macOS code-signing + notarization

Today the Mach-O binary is adhoc-signed by Homebrew at install time, which means a fresh `curl install-binary.sh` triggers Gatekeeper quarantine and the user needs to run `xattr -d com.apple.quarantine`. The scaffold is already in `release.yml` (three steps guarded by `if: false`) and will activate once these seven repo secrets exist:

```
APPLE_DEVELOPER_ID_CERT_BASE64        APPLE_KEYCHAIN_PASSWORD
APPLE_DEVELOPER_ID_CERT_PASSWORD      APPLE_TEAM_ID
APPLE_DEVELOPER_ID_APPLICATION        APPLE_APP_SPECIFIC_PASSWORD
APPLE_ID
```

Requires an Apple Developer Program membership.

### Multi-platform Homebrew bump · ✅ DONE (2026-06-16)

Resolved. The `homebrew-bump` job in `release.yml` no longer uses the
single-platform `mislav/bump-homebrew-formula-action` (which patched only the one
`sha256` block it was handed and left the other three stale, breaking `brew
install`'s checksum on every platform but one from v0.2.4). It now runs
`scripts/bump-homebrew-formula.ts` — pure logic in `src/core/homebrew-formula.ts`,
covered by `tests/homebrew-formula.test.ts` — which reads the release's
`SHA256SUMS` and patches `version` plus all four `sha256` lines atomically, then
commits to the tap.

**One-time cleanup pending**: the live `Formula/janus.rb` in `crewtives/homebrew-tap`
is still stale from the old action (v0.2.4–v0.2.8). It self-heals on the next
release tag, or fix it immediately by running the script against a checkout of
the tap with the current release's `SHA256SUMS`.

### `npm publish` — `bunx janus` / `npx janus`

Workflow already exists at `.github/workflows/npm-publish.yml`, guarded by `if: false`. Activation needs:

- An npm account and an `NPM_TOKEN` secret with publish permission on the `janus` name.
- A decision about whether the npm-distributed binary should match the Homebrew/curl one (same `bun build --compile` artifact) or whether npm gets a JS-only entrypoint that requires Bun at runtime. The compiled binary is simpler; the JS entry is smaller but adds a Bun version constraint.

## Ingestion

Multi-source ingestion was scoped as **Phase 1B** and explicitly deferred in [`docs/STATUS.md`](docs/STATUS.md) — every source below needs interactive setup or local data that wasn't available during the original phase. None of them block the current product; they all expand what Janus can see beyond `git log` and Claude Code session transcripts.

**Prerequisite — an ingest abstraction first.** There is no `src/ingest/` yet:
session reading lives in `src/core/sessions.ts`, hardcoded to `~/.claude/projects`,
`SessionSummary` has no `source` field, and the daily-pulse prompt hardcodes the
`## Claude Code sessions` heading. Adding any second source is a small refactor
(extract an `IngestAdapter` + a `source` discriminator + generalize the prompt
heading), not just dropping in a new file. Do that once, then each source below
is an adapter.

### Codex sessions

The cheapest first source: same `.jsonl` shape as Claude Code, different path
(`~/.codex/sessions/`). Once the ingest abstraction above exists, this is a
`src/ingest/codex.ts` adapter. Needs local data — the user must have Codex CLI
sessions on disk to validate — but no credential or interactive setup.

### Cursor sessions

Cursor stores session history locally in a proprietary SQLite store (path varies
by OS, format reverse-engineered, no stable API). A `src/ingest/cursor.ts`
adapter, after the abstraction, would fold Cursor work into the same project
window. Heavier than Codex because of the SQLite reverse-engineering.

### Linear

Tickets touched, comments left, status transitions. The interesting signal is decision-shaped activity that doesn't show up in git or in editor sessions ("we decided to close this as won't-fix"). Needs a Linear API token in `config.local.json` and a per-project team/project mapping.

### Voice memos (Whisper)

A drop folder (`~/Obsidian/Inbox/voice/`?) that Janus transcribes locally with `whisper.cpp` and folds into the day's pulse as raw quotes. Captures the kind of context that never gets typed — "this is why I'm rolling back the migration".

### Calendar

Read-only iCal/CalDAV ingestion to label pulses with the meetings that happened that day. Useful for "the day was empty in git because three meetings ate it" — currently those days look like idle days to the pulse.

---

Found something missing? Open an issue tagged `roadmap` at <https://github.com/crewtives/janus/issues>.
