# Security Policy

Janus is a local-first tool: it runs on your machine, reads your git history and Claude Code session transcripts, and writes Markdown into your Obsidian vault. It has no server component, no telemetry, and no cloud database. Most of the surface area is filesystem I/O and subprocess invocation against your local LLM CLI (`claude` or `gemini`).

That said, three categories of issue are still in scope and we take them seriously.

## In scope

- **Command injection** via project names, repo paths, queries, or any other user-controlled input that ends up shelled out (`Bun.spawn`, `claude -p`, `gemini`, `git`, etc.).
- **Path traversal** that lets a crafted config or repo write outside the configured vault root.
- **Prompt injection** that lets content read from a repo (commit messages, session transcripts, `STRATEGY.md`, etc.) override the system prompt and exfiltrate other projects' data into a pulse, the MCP responses, or Discord webhooks.
- **Secret leakage** — the runner deliberately strips `ANTHROPIC_API_KEY` from the spawned process env so Claude Code uses OAuth Max instead. Any regression that re-leaks the key, or that surfaces secrets from `.env` files into pulses, counts.
- **Privacy / PII redaction bypasses** — the layer documented in [`docs/PRIVACY.md`](docs/PRIVACY.md) ships enabled by default; a bypass that lets a known shape (tokens listed in the privacy doc) reach the LLM despite the wrapper is in scope.
- **MCP server** vulnerabilities — `bun janus mcp` exposes a JSON-RPC stdio interface. Any input that crashes the process, returns data outside the configured vault, or bypasses the `since` / `project` / `kind` filters is in scope.

## Out of scope

- Bugs that require an attacker who already has write access to your `config.local.json` or your `~/.claude/` directory. At that point, the attacker has shell on your machine.
- Denial of service via extremely large repos or transcripts. Janus runs nightly and is allowed to be slow.
- Issues that only reproduce with a modified fork — please open a regular issue or PR instead.

## Reporting a vulnerability

**Do not open a public GitHub issue.**

Email `crewtives@protonmail.com` with the subject line `[janus security]` and include:

- A description of the issue and the impact you believe it has.
- A minimal reproduction — ideally a small repo or config snippet plus the exact command.
- The Janus commit you tested against (`git rev-parse HEAD`).
- Your Bun version (`bun --version`) and platform.

You should get an acknowledgment within **3 business days**. If you don't, assume the email was lost and resend; we'd rather receive a duplicate than miss a real report.

We aim to:

- Confirm the issue and agree on severity within **7 days** of acknowledgment.
- Ship a fix within **30 days** for high-severity issues, longer for lower-severity ones.
- Credit you in the release notes unless you ask us not to.

Janus does not run a paid bug bounty. We will say thank you very sincerely.

## Disclosure

Once a fix is shipped, we'll publish a short note in `CHANGELOG.md` describing the issue at a level of detail that helps other users assess whether they were affected, without giving away exploitation steps for unrelated forks.
