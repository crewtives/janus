---
title: Secrets leaked into git history via timestamped backup files
date: 2026-05-24
category: security-issues
module: gitignore
problem_type: security_issue
component: tooling
symptoms:
  - GitGuardian alert from GitHub push webhook
  - Discord webhook URL visible in a committed file
  - Filename like `config.local.json.backup-1779322391` matches no entry in `.gitignore`
  - The webhook is still accessible by direct commit SHA even after force-push, until GitHub GC runs
root_cause: incomplete_setup
resolution_type: config_change
severity: critical
tags: [secrets, gitignore, discord-webhook, git-filter-repo, force-push, pr-refs]
related_components: [gitignore, discord]
---

# Secrets leaked into git history via timestamped backup files

## Problem
Janus writes timestamped backups of `config.local.json` when the wizard or config-merge modifies it (e.g. `config.local.json.backup-1779322391`). The initial `.gitignore` covered `config.local.json` and `config.local.*` but **not** `*.local.json.backup-*` — a `git add -A` during early development committed the backup, which contained the live Discord webhook URL. GitGuardian flagged it via the GitHub push webhook.

Worse: after rewriting history with `git filter-repo` to remove the file and force-pushing, GitHub did not promptly GC `refs/pull/*/head` refs. The webhook was still reachable by direct SHA from the merged PR's pull ref for days to weeks until GitHub's GC ran. The webhook was rotated immediately, so this was not a live exposure — but force-push alone is **not** sufficient for 100% purge.

## Symptoms
- GitGuardian / GitHub secret scanning alert
- `git log --all --diff-filter=A -- '*.backup-*'` lists the committed backup
- `curl https://github.com/<org>/<repo>/commit/<old-sha>.patch` still serves the secret-containing diff after force-push
- `gh api repos/<org>/<repo>/git/refs/pull/<N>/head` still resolves to a commit that contains the secret

## What Didn't Work
- Adding `*.backup` to `.gitignore` — too broad, doesn't match the timestamp pattern
- Deleting the file and committing the delete — secret still in history at the previous commit
- Force-pushing without `git filter-repo` — only changes the latest tip, history still contains the secret
- Force-pushing after `git filter-repo` — fixes the user-facing branch but leaves PR refs intact

## Solution
Three layers, all required.

**1. Tighten `.gitignore` patterns** — the current rules in `.gitignore`:

```
# Local config (puede contener webhook URL de Discord, paths personales)
config.local.json
config.local.*
*.local.json
*.local.json.backup-*
```

The `*.local.json.backup-*` glob covers any timestamped backup of a `*.local.json` file from any tool. The stricter rules landed in commit `798cc05 chore: untrack config.local backup + gitignore más estricto` after the incident.

**2. Rewrite history with `git filter-repo`**:

```bash
git filter-repo --path config.local.json.backup-1779322391 --invert-paths
```

This rewrites every commit that ever touched the file, removing it from history. **Side effect**: `git filter-repo` removes the `origin` remote as a safety measure. Re-add it manually:

```bash
git remote add origin git@github.com:crewtives/janus.git
git push --force origin main
```

**3. Rotate the secret immediately** — assume any secret committed to a public-or-formerly-public repo is compromised. Force-push only buys time against future indexing; existing access is permanent.

For Discord specifically: regenerate the webhook URL in the Discord channel settings. The old URL stops working when the new one is created.

**4. Accept that PR refs persist** — there is no maintainer-side fix for `refs/pull/*/head`. GitHub eventually GCs them but the timing is opaque. The rotated secret is the only durable remedy.

## Why This Works
- `.gitignore` patterns block future commits of the same file shape
- `git filter-repo` rewrites the SHA tree so the secret-containing commits no longer exist in the rewritten branch's history
- Rotation invalidates the exposed credential regardless of where it still sits in PR refs or third-party mirrors

## Prevention
- Any tool that writes a backup file in the repo must use a path that's already covered by `.gitignore` — currently `config.local.*`, `*.local.json.backup-*`, `.janus.backup-*/` cover the known sources
- Pre-commit hook (`scripts/install-pre-commit.sh` if we ever add one) should scan staged content for secret patterns — not implemented today, deferred
- Never run `git add -A` or `git add .` blind; prefer `git add <specific-files>`
- Treat any committed secret as compromised, even after history rewrite. Rotate first, clean up second

## Related
- Commit `798cc05` — `.gitignore` tightening + untrack backup
- `git filter-repo` documentation: https://github.com/newren/git-filter-repo
- ARCHITECTURE.md `## Privacy and security` section
