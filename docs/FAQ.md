# FAQ

Common questions before and after installing Janus. If yours isn't here, [open a discussion](https://github.com/crewtives/janus/discussions).

## Setup

### Do I need a Claude Max subscription?

No. Claude Code remains the default, but Janus can generate with Codex CLI or Gemini CLI using the
local authenticated CLI session.

If you don't have Claude Max:

- The optional fallback runner uses Google's `gemini-cli` on the same OAuth principle. Set `provider: "gemini-cli"` in `config.local.json`.
- Codex CLI is a first-class provider. Set `provider: "codex"` and authenticate with `codex login`.
- The MCP server (`janus mcp`) and search (`janus ask`) work on already-synthesized material without invoking any LLM, so you can query existing pulses without an active provider.
- `janus pulse --dry-run` renders the prompt without invoking any provider, useful for prompt iteration.

### Does Janus require Obsidian?

Yes. Janus writes its narrative into your Obsidian vault — that's the sink. The MOC notes, dashboards, wiki-links, and Dataview blocks all assume Obsidian conventions. Pointing `obsidianVault` at any directory will work mechanically, but the experience is built for Obsidian.

If you don't use Obsidian, the easiest path is to install it, point Janus at a fresh vault, and treat the vault as a read-only narrative archive that other tools can also read from. Files are plain Markdown.

### Does it work on Windows?

Native Windows is not supported. Use WSL (Windows Subsystem for Linux), where Janus runs as a Linux install — the installer auto-detects WSL and the systemd-user scheduler works. The reason native Windows is excluded is the nightly scheduler: launchd (macOS) and systemd-user (Linux) are the only two targets currently maintained.

### Why does macOS quarantine the binary on first run?

The release binaries are not yet signed with an Apple Developer ID, so Gatekeeper marks them as "from an unidentified developer" and adds the `com.apple.quarantine` attribute. To unblock:

```bash
xattr -d com.apple.quarantine ~/.local/bin/janus
```

The installer prints this exact command when it detects the quarantine. Code-signing and notarization are on the roadmap.

If you'd rather avoid `xattr`, install from source instead (`bun install` from the cloned repo), which doesn't go through the Gatekeeper path.

## Daily use

### What does the nightly run actually do?

`launchd` (macOS) or a `systemd-user` timer (Linux) wakes Janus once a day. For each configured project it: reads new git commits since the last checkpoint, reads new Claude Code and Codex session transcripts, synthesizes a daily pulse, then rolls up cross-project material. Weekly / monthly / quarterly / yearly tiers are produced on their respective boundaries.

You can also run any tier on demand: `janus pulse`, `janus rollup --week`, `janus monthly --month YYYY-MM`, etc.

### How do I disable or uninstall the nightly scheduler?

The wizard offers it as opt-in; if you accepted, the unit files live at:

- macOS: `~/Library/LaunchAgents/com.crewtives.janus.plist`
- Linux: `~/.config/systemd/user/janus.timer` + `janus.service`

To remove:

- macOS: `launchctl unload ~/Library/LaunchAgents/com.crewtives.janus.plist && rm ~/Library/LaunchAgents/com.crewtives.janus.plist`
- Linux: `systemctl --user disable --now janus.timer && rm ~/.config/systemd/user/janus.{timer,service}`

Re-running `janus init` will offer to reinstall it.

### Can I skip a project temporarily?

Yes. In `config.local.json`, set the project's `status`:

- `"active"` (default) — pulses every night.
- `"paused"` — only generates a pulse if there's commit/session activity that day. Useful for side projects that sleep for weeks; you don't get empty "nothing happened" notes.
- `"archived"` — total skip. Existing pulses stay in the vault, no new ones are written.

### How do I switch providers?

Edit `config.local.json`:

```json
{ "provider": "codex", "fallbackProvider": "claude-code" }
```

Use `gemini-cli` instead of `codex` if desired. Janus tries `provider` first and
`fallbackProvider` on retriable failures. Top-level model settings belong to the primary provider;
the secondary uses its own CLI defaults so a Claude model name cannot leak into Codex or Gemini.
`janus doctor` checks every configured provider.

### Why didn't Codex load Janus memory?

Run `janus doctor`. The Codex integration must have both a SessionStart hook and a registered
`janus` MCP server. Codex may also require one-time approval of the hook after `janus init`.
Automatic context is intentionally silent outside configured `repoPath` values. Inside a tracked
repository without a spine, use `janus_ask` through MCP or generate a pulse/spine first.

## Data and privacy

### What does Janus send to the LLM?

Per pulse: a redacted, structured prompt containing the day's git commits (subjects + bodies + file paths) and Claude Code or Codex session excerpts for that project, plus prior pulses for context. See [`docs/PRIVACY.md`](PRIVACY.md) for the full redaction layer — Anthropic / OpenAI / GitHub / AWS keys, JWTs, webhook URLs, bearer tokens, private keys, emails, and home-directory paths are stripped before the prompt leaves your machine.

The MCP server (`janus mcp`) reads from your already-synthesized vault and does not call any LLM itself — it returns existing material.

### Where does my data live?

- **Narrative output**: in your Obsidian vault (plain Markdown).
- **Bookkeeping state**: `.janus/state.sqlite` inside your vault (FTS5 search index, project metadata, track lineage, decision graph).
- **Local config**: `config.local.json` at the repo root (gitignored).
- **Failed runs**: `.janus/failed.jsonl` (dead-letter queue, replay with `janus retry`).

Nothing leaves your machine except the redacted prompt to the configured LLM provider.

### Can I delete what Janus wrote?

All output is plain Markdown — delete it like any file. The next pulse won't regenerate yesterday's pulse unless you also reset the checkpoint (`janus checkpoint --reset`, see `janus --help`). The SQLite database can be deleted; the next run will rebuild it from the vault.

## Troubleshooting

### `claude: command not found` after install

Install Claude Code from [docs.claude.com/claude-code](https://docs.claude.com/en/docs/claude-code/quickstart) and log in once with `claude` to establish the OAuth session. Then re-run `janus doctor` to verify.

### The first pulse takes forever

Common on first run with `--backfill`. Each day's pulse is one LLM call per project; backfilling 7 days across 5 projects is 35 calls. Use `--dry-run` to verify the prompts look right before the real backfill.

### `janus wrapped` is slow / expensive

`wrapped` is the only command that runs multiple LLM calls in a single invocation (yearly + per-project + personality archetype). Use `--dry-run` while iterating on prompts; it runs the deterministic aggregator + personality without invoking the LLM.

### Pulses look generic / lifeless

Janus's voice is tuned for a specific register — "soft third-person narrator, prose over bullets, observational not promotional" (see `src/prompts/_voice.md`). If the pulses feel off:

1. Check `effort` in `config.local.json` (`low` / `medium` / `high` / `xhigh`). `xhigh` is the default for a reason.
2. Make sure the input is rich — short commits + no session transcripts gives the LLM nothing to work with.
3. If you've been editing pulses by hand, Janus respects your edits on rerun. Check `docs/PRIVACY.md` and the user-edits layer.

## Contributing

### How do I contribute?

See [CONTRIBUTING.md](../CONTRIBUTING.md) for setup, dev loop, and commit conventions. If you're an AI coding agent, also read [AGENTS.md](../AGENTS.md) (and [CLAUDE.md](../CLAUDE.md) if you're Claude Code specifically).

### I found a security issue

Don't open a public issue. See [SECURITY.md](../SECURITY.md) for the private reporting channel.
