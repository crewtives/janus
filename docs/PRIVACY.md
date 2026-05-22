# Privacy and redaction

Janus reads two streams of work — your git history and the JSONL transcripts of your Claude Code sessions — and feeds the cross-referenced material into an LLM. That LLM may be a third party (Anthropic, Google). The privacy layer makes sure no obvious secret or personal identifier leaves your machine inside that prompt.

This document describes what gets redacted, how the layer is wired, how to extend or disable it, and what is explicitly out of scope.

## What Janus sees

The data flow is straightforward:

```
git log + git diff --stat      ─┐
                                ├──→  buildPromptContext()  ──→  rendered prompt  ──→  LLM
~/.claude/projects/<...>.jsonl ─┘                                         ▲
                                                                          │
                                                              redactingRunner (chokepoint)
```

- `src/core/git.ts` collects commit subjects, bodies, file paths, and diff stats.
- `src/core/sessions.ts` extracts `userIntent`, `decisionSnippets`, `blockerSnippets`, `filesEdited`, `cwd`, and `gitBranch` from Claude Code session JSONL files.
- `src/core/template.ts` assembles those into a `PulsePromptContext` and renders the Eta template.
- `src/runners/redacting.ts` wraps the LLM runner. The rendered prompt is passed through `redact()` *immediately* before the provider receives it.

The wrap happens in `resolveRunner()` (in `src/runners/registry.ts`), so every code path that goes through the registry inherits redaction automatically. There's no contract for individual builders to remember — single bypass-resistant chokepoint.

## What gets redacted by default

| Pattern | Example before | Example after |
|---|---|---|
| `anthropic-key` | `sk-ant-…` | `<anthropic-key>` |
| `openai-key` | `sk-…` / `sk-proj-…` | `<openai-key>` |
| `github-pat` | `ghp_…` / `gho_…` / `ghs_…` / `ghr_…` / `ghu_…` | `<github-pat>` |
| `aws-access-key` | `AKIA…` / `ASIA…` | `<aws-access-key>` |
| `jwt` | `eyJ…eyJ….…` | `<jwt>` |
| `discord-webhook` | `https://discord.com/api/webhooks/…/…` | `<discord-webhook>` |
| `slack-webhook` | `https://hooks.slack.com/services/…/…/…` | `<slack-webhook>` |
| `bearer-token` | `Bearer eyJabc…` | `Bearer <token>` |
| `private-key-block` | `-----BEGIN … PRIVATE KEY-----…` | `<private-key>` |
| `email` | `alice@example.com` | `<email>` |
| `home-path-mac` | `/Users/alice/…` | `~/…` |
| `home-path-linux` | `/home/alice/…` | `~/…` |
| `home-path-win` | `C:\Users\alice\…` | `~\…` |

Two defaults worth knowing:

1. **`noreply@anthropic.com` is allowlisted** by default so `Co-Authored-By: Claude <noreply@anthropic.com>` trailers in commit messages survive redaction.
2. **`<repo>` substitution** is applied first if the caller passes `repoRoot`. That preserves intra-repo paths (`src/core/foo.ts`) the model needs for context, while still collapsing the user-identifying prefix.

The privacy layer is **enabled by default** for every config — including existing installs that don't have a `privacy` block. To turn it off, see "Disabling" below.

## What is NOT redacted (v1 scope)

- **Phone numbers, postal addresses, full personal names.** Pattern false-positive rates are too high for a code-focused tool.
- **Content the LLM emits.** Janus only redacts the *input*. Whatever the model writes back into your vault is your data. If you intend to share a generated pulse, re-read it first.
- **stderr / log output.** Janus prints log lines to stderr (`[janus] dry-run: yes`, project names, dates). Those are not piped to the LLM.
- **Your Obsidian vault.** The vault contents are read by `src/spine.ts` (and similar) and may include unredacted text. That's a deliberate trust boundary: you own the vault.

## Disabling

Set `privacy.enabled` to `false` in `config.local.json`:

```json
{
  "privacy": {
    "enabled": false
  }
}
```

When disabled, `resolveRunner()` returns the raw runner — the wrapper is not installed.

## Skipping individual patterns

If a built-in pattern is mangling legitimate prose in your case, skip it by name:

```json
{
  "privacy": {
    "disablePatterns": ["email"]
  }
}
```

The remaining patterns continue to apply.

## Adding patterns

For internal identifiers (ticket IDs, employee numbers, customer codes), append your own:

```json
{
  "privacy": {
    "extraPatterns": [
      {
        "name": "internal-ticket",
        "pattern": "INT-\\d+",
        "flags": "g",
        "replacement": "<internal-ticket>"
      }
    ]
  }
}
```

The `flags` field is optional — `g` is forced if missing. Malformed regex compile errors are logged once and that single pattern is skipped; the rest of the layer keeps working. This is a deliberate fail-soft choice at the pattern level (compared to the fail-closed default at the layer level).

## Allowlisting

If you want a specific match to survive redaction even when a built-in pattern would otherwise rewrite it, add an allow-list regex string:

```json
{
  "privacy": {
    "allowList": ["ops@example\\.com"]
  }
}
```

The allow list is consulted *per match*. A match that intersects any allow-list regex is left untouched. The default `noreply@anthropic.com` exemption is always applied on top of your additions.

## How to verify

Three layers of confidence, from cheapest to most thorough:

```bash
# 1. Run the privacy unit tests against shape-only synthetic tokens.
bun test tests/privacy-redact.test.ts tests/runners-redacting.test.ts

# 2. Render a real pulse to /dev/stdout via the dry-run path and inspect it.
bun janus pulse --dry-run --project <your-project>

# 3. Run the binary smoke check — compiles the binary and exercises pulse --dry-run end-to-end.
bun run scripts/smoke-validate-phase1.ts
```

For a specific worry — say, "does Janus catch a fake GitHub PAT in my commit body?" — plant a shape-valid fake (`ghp_` followed by 36 random alphanumerics) in a local branch, run `bun janus pulse --dry-run --project <your-project>`, and grep the rendered prompt printed to stderr for the literal token. It should not appear; you should see `<github-pat>` instead.

## Threat model

**What the privacy layer protects against**

- Accidentally pasting tokens or PII into a third-party LLM via the prompt.
- Leaking personal directory structure (your username inside paths) to the model.
- Including commit bodies that contain stray secrets (a `curl -H "Authorization: Bearer …"` line copy-pasted into a fix description).

**What it does NOT protect against**

- A malicious prompt or template inside your own codebase (e.g. a teammate's branch with an injected instruction the model follows).
- A compromised LLM provider (the model still receives a sanitized prompt, but it sees *some* text).
- The contents of your Obsidian vault, which `spine.ts` and similar may read and feed back into the next pulse.
- Steganographic encodings (the layer pattern-matches; it doesn't understand intent).
- Phone numbers, postal addresses, or your full personal name.

The layer is intentionally **regex-based and pure**: no entropy detection, no model-based scrubbing, no learned classifier. Those are deliberate v1 trade-offs.

## Where the code lives

- `src/core/privacy/redact.ts` — pure module: `redact()`, `CORE_PATTERNS`, `compileUserPattern()`, `compileAllowList()`.
- `src/runners/redacting.ts` — `redactingRunner(base, opts)` wraps any `LLMRunner`.
- `src/runners/registry.ts` — `resolveRunner(config, repoRoot?)` wires the wrap automatically.
- `src/config/types.ts` — `PrivacyConfig` shape.
- `src/config/loader.ts` — defaults applied here; `enabled: true` is the new default.
- `tests/privacy-redact.test.ts` — module unit tests.
- `tests/runners-redacting.test.ts` — wrapper integration tests.

## Roadmap

Items considered for v2:

- Entropy-based detection for novel API key formats (e.g. Stripe, Notion, Linear) that don't match a fixed prefix.
- Optional structured logging of *which* patterns fired during a run (no leaked content, just counts), for debugging false positives.
- A `--dry-run --show-prompt` flag that prints the redacted prompt to stdout, for spot-checks before turning on a real provider.

Want one of these now? Open an issue.
