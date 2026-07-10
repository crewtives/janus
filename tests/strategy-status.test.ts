import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectStrategyStatus, pickBestStrategy } from "../src/core/strategy-status.ts";
import { readStrategy } from "../src/core/obsidian.ts";

const TEMPLATE = `---
type: strategy
needs_review: true
---
# STRATEGY

(fill me)
`;

const AUTHORED = `---
name: Example
---
# Estrategia

## Target problem

Real authored content.
`;

const DATE = "2026-07-10";
const dirs: string[] = [];

async function setup(files: { vault?: string; repo?: string }): Promise<{ vault: string; repo: string }> {
  const base = await mkdtemp(join(tmpdir(), "janus-strategy-"));
  dirs.push(base);
  const vault = join(base, "vault");
  const repo = join(base, "repo");
  await mkdir(vault, { recursive: true });
  await mkdir(repo, { recursive: true });
  if (files.vault != null) await writeFile(join(vault, "STRATEGY.md"), files.vault);
  if (files.repo != null) await writeFile(join(repo, "STRATEGY.md"), files.repo);
  return { vault, repo };
}

afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe("strategy resolution prefers a filled file over a template draft", () => {
  test("an authored repo STRATEGY is NOT masked by a template vault mirror", async () => {
    // The bug this fixes: a scaffolded vault template (needs_review: true) used to
    // short-circuit resolution and hide an authored repo STRATEGY, so pulses/spine
    // reported "no north star" for projects that had actually defined one.
    const { vault, repo } = await setup({ vault: TEMPLATE, repo: AUTHORED });
    const status = await detectStrategyStatus({ obsidianPath: vault, repoPath: repo, currentDate: DATE });
    expect(status.status).toBe("filled");
    expect(await readStrategy(vault, repo)).toContain("Real authored content.");
  });

  test("a filled vault wins over a repo draft (ties resolve to the vault)", async () => {
    const { vault, repo } = await setup({ vault: AUTHORED, repo: TEMPLATE });
    expect((await detectStrategyStatus({ obsidianPath: vault, repoPath: repo, currentDate: DATE })).status).toBe("filled");
    expect(await readStrategy(vault, repo)).toContain("Real authored content.");
  });

  test("both drafts → draft (vault content, days computed)", async () => {
    const { vault, repo } = await setup({ vault: TEMPLATE, repo: TEMPLATE });
    const status = await detectStrategyStatus({ obsidianPath: vault, repoPath: repo, currentDate: DATE });
    expect(status.status).toBe("draft");
    const best = await pickBestStrategy(vault, repo);
    expect(best?.path).toBe(join(vault, "STRATEGY.md"));
  });

  test("neither exists → missing, null content", async () => {
    const { vault, repo } = await setup({});
    expect((await detectStrategyStatus({ obsidianPath: vault, repoPath: repo, currentDate: DATE })).status).toBe("missing");
    expect(await readStrategy(vault, repo)).toBeNull();
  });

  test("pickBestStrategy returns the filled candidate and its path", async () => {
    const { vault, repo } = await setup({ vault: TEMPLATE, repo: AUTHORED });
    const best = await pickBestStrategy(vault, repo);
    expect(best?.draft).toBe(false);
    expect(best?.path).toBe(join(repo, "STRATEGY.md"));
  });
});
