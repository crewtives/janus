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

### Multi-platform Homebrew bump

The `homebrew-bump` job in `release.yml` uses `mislav/bump-homebrew-formula-action`, which is single-platform: it only updates the one block whose `download-url` is passed to it. The other three blocks (currently `macos-x64`, `linux-arm64`, `linux-x64`) keep their previous SHA256 sums while the version label moves, which makes `brew install` fail on those platforms.

Replace the action with a small inline step (sed / yq / a short Bun script) that reads the published `SHA256SUMS` for the new tag and patches all four `sha256` lines in `Formula/janus.rb` atomically before committing to the tap.

### `npm publish` — `bunx janus` / `npx janus`

Workflow already exists at `.github/workflows/npm-publish.yml`, guarded by `if: false`. Activation needs:

- An npm account and an `NPM_TOKEN` secret with publish permission on the `janus` name.
- A decision about whether the npm-distributed binary should match the Homebrew/curl one (same `bun build --compile` artifact) or whether npm gets a JS-only entrypoint that requires Bun at runtime. The compiled binary is simpler; the JS entry is smaller but adds a Bun version constraint.

## Ingestion

Multi-source ingestion was scoped as **Phase 1B** and explicitly deferred in [`docs/STATUS.md`](docs/STATUS.md) — every source below needs interactive setup or local data that wasn't available during the original phase. None of them block the current product; they all expand what Janus can see beyond `git log` and Claude Code session transcripts.

### Cursor sessions

Cursor stores session history locally (path varies by OS). A `src/ingest/cursor.ts` adapter that mirrors `src/ingest/claude-code.ts` would let the daily-pulse prompt see Cursor work alongside Claude Code work in the same project window.

### Codex sessions

Same shape as Cursor, different source path. Adapter in `src/ingest/codex.ts`. The daily-pulse aggregator already treats "session transcripts" as a list — multiple adapters compose naturally.

### Linear

Tickets touched, comments left, status transitions. The interesting signal is decision-shaped activity that doesn't show up in git or in editor sessions ("we decided to close this as won't-fix"). Needs a Linear API token in `config.local.json` and a per-project team/project mapping.

### Voice memos (Whisper)

A drop folder (`~/Obsidian/Inbox/voice/`?) that Janus transcribes locally with `whisper.cpp` and folds into the day's pulse as raw quotes. Captures the kind of context that never gets typed — "this is why I'm rolling back the migration".

### Calendar

Read-only iCal/CalDAV ingestion to label pulses with the meetings that happened that day. Useful for "the day was empty in git because three meetings ate it" — currently those days look like idle days to the pulse.

---

Found something missing? Open an issue tagged `roadmap` at <https://github.com/crewtives/janus/issues>.
