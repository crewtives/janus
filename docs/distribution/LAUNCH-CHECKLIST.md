---
title: "Launch checklist — opening Janus as OSS"
created: 2026-05-22
status: in-progress
---

# Launch checklist

Concrete steps to take Janus from "private repo with everything in place" to "public, discoverable, with a clean install story." Companion to the plan at `~/.claude/plans/que-opinas-que-le-polished-whale.md`.

What this doc **doesn't** track: code-level changes — those are already in this repo (FAQ, "who it's for", code-sign template in `release.yml`, Homebrew template, `janus demo`, `npm-publish.yml`, etc.). What's left is the manual half: capturing assets, configuring GitHub, flipping visibility, and announcing.

Status legend:

- `[x]` done
- `[ ]` open
- `[~]` template ready in repo; you need to enable it

---

## Phase 1 — Pre-flip pulishing

### Visual assets

- [x] `docs/assets/janus-demo.png` — terminal mockup of `janus demo` output. Reproducible via headless Chrome from `/tmp/demo-mockup.html`. Already embedded at the top of the README.
- [x] `docs/assets/wrapped-hero.png` — Wrapped sample rendered with headless Chrome. Already embedded next to the demo mockup.
- [ ] `docs/assets/janus-init.gif` — *optional* upgrade. A real GIF of the wizard would beat the static demo mockup, but the mockup is already shipping. Capture recipe in `docs/assets/README.md`.
- [ ] `docs/assets/pulse-in-obsidian.png` — *optional*. Requires opening Obsidian against a sample vault; lower priority because the Wrapped screenshot already establishes the visual register.

### Code-signing macOS binaries

The release workflow has the codesign + notarize steps already written, guarded by `if: false`. To turn them on:

- [ ] Decide whether to pay for an Apple Developer ID (~$99/year). If skipped, leave `if: false` and the installer's enhanced quarantine message will do the work — it's no longer hidden in two dim grey lines.
- [ ] If proceeding: configure these repo secrets in GitHub → Settings → Secrets and variables → Actions:
  - `APPLE_DEVELOPER_ID_CERT_BASE64` — base64 of your exported `.p12`
  - `APPLE_DEVELOPER_ID_CERT_PASSWORD` — the `.p12` export password
  - `APPLE_KEYCHAIN_PASSWORD` — any password used to create the temp keychain
  - `APPLE_DEVELOPER_ID_APPLICATION` — full identity, e.g. `Developer ID Application: Crewtives (TEAMID)`
  - `APPLE_ID` — Apple ID used to notarize
  - `APPLE_TEAM_ID` — 10-char Team ID
  - `APPLE_APP_SPECIFIC_PASSWORD` — app-specific password for `notarytool`
- [ ] Remove the three `if: false` guards in `.github/workflows/release.yml` (the import-cert, codesign, and notarize steps).
- [ ] Tag a test release (`v0.2.1-test`) and verify the macOS binaries pass `spctl --assess` after download.

### Homebrew tap

The formula template lives at `docs/distribution/homebrew/janus.rb` with bootstrap instructions in `docs/distribution/README.md`.

- [ ] Create the tap repo: `gh repo create crewtives/homebrew-janus --public`
- [ ] Copy `docs/distribution/homebrew/janus.rb` to `Formula/janus.rb` in the tap repo.
- [ ] Replace the four `REPLACE_WITH_SHA256_OF_*` placeholders. SHAs live in the `SHA256SUMS` asset of the current Janus release (`gh release download v0.2.0 -p SHA256SUMS`).
- [ ] Commit + push to the tap repo's `main`.
- [ ] Test locally: `brew install crewtives/janus/janus && janus --help`
- [ ] Create a fine-grained PAT with `Contents: read/write` on `crewtives/homebrew-janus`. Save as the `HOMEBREW_TAP_GITHUB_TOKEN` secret in this repo.
- [ ] Remove the `if: false` guard on the `homebrew-bump` job in `.github/workflows/release.yml`. From the next tag onward, the tap auto-bumps.

### Branch protection

- [ ] GitHub → this repo → Settings → Branches → "Add branch protection rule" for `main`:
  - Require status checks to pass before merging — pick the `test` and `typecheck` checks from `ci.yml`.
  - Require linear history (optional but matches your conventional-commits style).
  - Do **not** require PR reviews while you're the sole maintainer; you can revisit when a second person joins.
  - Allow force-pushes: off.

---

## Phase 2 — The flip

Once-only operation. Git history becomes public; everything before this should be audited.

- [x] Secrets audit. Ran on 2026-05-22: clean. `config.local.json` never committed. No `.env` history. Token-shaped strings in the diff are all redaction-pattern documentation.
- [ ] Re-verify `.gitignore` covers: `config.local.json`, `.janus/`, `dist/`, `node_modules/`, `*.sqlite`, `.env`. (Done; verify nothing slipped in since.)
- [ ] **Flip visibility**: GitHub → Settings → Danger Zone → "Change repository visibility" → Public.
- [ ] Enable Discussions: Settings → General → Features → check "Discussions". Create categories: Q&A, Show & Tell, Ideas.
- [ ] Decide on `.github/FUNDING.yml` (skip if Crewtives doesn't take sponsorships).
- [ ] **Smoke test from an outside environment**:
  - `gh codespace create -R crewtives/janus` (or any fresh machine).
  - `curl -fsSL https://raw.githubusercontent.com/crewtives/janus/main/scripts/install-binary.sh | bash`
  - `~/.local/bin/janus --help` works.
  - `janus demo` works without any config.

---

## Phase 3 — Post-flip launch

### npm publish

- [~] `package.json` has the `files` field and `engines.bun` set. `.github/workflows/npm-publish.yml` exists, guarded by `if: false`.
- [ ] Create an npm automation token at https://www.npmjs.com/settings/<your-account>/tokens. Save as `NPM_TOKEN` repo secret.
- [ ] Remove the `if: false` guard in `npm-publish.yml`.
- [ ] Tag a release; verify it lands at https://www.npmjs.com/package/janus.
- [ ] Smoke test: `bunx janus@latest demo` on a fresh machine.

### Awesome-lists

Submit a PR to each with a consistent one-liner:

> **Janus** — agent-native journal that reads your git + Claude Code sessions and writes the continuous narrative of your projects. Exposes itself as an MCP server so other agents can query the synthesized history.

- [ ] `hesreallyhim/awesome-claude-code` — under "Tools" or "Workflows".
- [ ] `punkpeye/awesome-mcp-servers` — under "Knowledge / Memory" or similar.
- [ ] `modelcontextprotocol/servers` — community-contributed list.
- [ ] `kmaasrud/awesome-obsidian` — "External tools" section.

### Demo content

- [ ] Record a 30-60s screen capture: install → init → first pulse → open the pulse in Obsidian. Loom or YouTube unlisted.
- [ ] Embed the video link in `README.md` above the embedded GIF (under the same uncommented block).

### Announcement

Tone: reserved, aligned with `src/prompts/_voice.md`. Not growth-hacky.

- [ ] **Show HN** post. Suggested title: "Janus — the personal historian for makers". Body: what it does, what it isn't, who it's not for, link to the Wrapped sample. Lead with the GIF.
- [ ] Long-form post on `crewtives.com/notes/`: the *why*. Why nightly synthesis, why narrative over dashboards, why Obsidian-only, why agent-native.
- [ ] Short threads on Bluesky / Mastodon / Twitter with the GIF.
- [ ] Be available the first 6 hours after the Show HN post to respond.
- [ ] Schedule for a midweek day, morning PT (peaks of HN traffic).

### Optional but high-leverage

- [ ] Landing page at `janus.crewtives.com` or `crewtives.com/janus`: hero + install one-liner + embedded Wrapped sample + repo link.
- [ ] Submit to the MCP registry when one exists (track `modelcontextprotocol.io`).

---

## Decisions made (2026-05-22)

| Decision | Choice | Consequence |
|---|---|---|
| Apple Developer ID | Skip for now | Scaffold left guarded in `release.yml`. macOS users see the loud yellow `xattr` message on first install. |
| Awesome-list PRs | Skip | Discoverability rests on Homebrew + GitHub topics + organic search. |
| npm publish | Skip for now | Workflow + `files` allowlist committed, all guarded. When ready: create `NPM_TOKEN`, remove `if: false`. |
| `janus demo` vs GH Pages | `demo` shipped in v0.2.1 | The CLI command is the primary "see it without installing" path. |
| Dedicated landing page | Defer | README is sufficient. |
| Repo flip to public | **Deferred — capture visual assets first** | The README has commented-out embeds waiting on three files under `docs/assets/`. The flip is a one-way operation; tying it to having visible demo media is the right gate. |

## What's left for you

In order:

1. **Capture the visual assets** in `docs/assets/`:
   - `janus-init.gif` (15s of `janus init`, asciinema + agg)
   - `wrapped-hero.png` (screenshot of the demo Wrapped HTML — run `janus demo` and screenshot)
   - `pulse-in-obsidian.png` (a daily pulse opened in Obsidian)
2. **Uncomment the demo-media block** at the top of `README.md` once the three files exist.
3. **Flip the repo to public** in GitHub Settings → Danger Zone.
4. **Smoke test from a fresh shell** — pick a Codespace, run the `curl|bash` from the README, verify it lands cleanly.
5. (Optional later) Activate code-sign, npm-publish, and the Homebrew bump job by configuring the respective secrets and removing the `if: false` guards. Each is independent.
