<!--
Thanks for the PR. Keep this template short — reviewers can read the diff.
Delete sections that don't apply.
-->

## What this changes

<!-- One or two sentences. What does the user / the agent see differently after this lands? -->

## Why

<!-- The motivation. Skip if it's a trivial fix. -->

Closes #

## How to verify

<!-- Commands a reviewer can paste. The default gate is the three below. -->

- [ ] `bun test`
- [ ] `bunx tsc --noEmit`
- [ ] `bun run scripts/smoke-validate-phase1.ts`

<!-- Add any extra steps if this PR introduces a new command, a new prompt, or a vault-touching change. -->

## Checklist

- [ ] Followed the conventions in [CONTRIBUTING.md](../CONTRIBUTING.md) (or [AGENTS.md](../AGENTS.md) if I'm an AI agent).
- [ ] Tests added or updated. Bug fixes have a regression test.
- [ ] Did not edit a shipped prompt in place. New prompts are a new `vN+1` file.
- [ ] Did not introduce a new external dependency without prior discussion.
- [ ] If this touches a non-obvious decision listed in [docs/HANDOFF.md](../docs/HANDOFF.md), explained why the change is safe.

## Notes for the reviewer

<!-- Optional. Anything you want the reviewer to look at first, or anything you considered and rejected. -->
