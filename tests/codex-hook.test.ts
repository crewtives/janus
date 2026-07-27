import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JanusConfig } from "../src/config/types.ts";
import { buildCodexSessionStartOutput } from "../src/core/codex-hook.ts";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function setup(): Promise<{ config: JanusConfig; repo: string }> {
  root = await mkdtemp(join(tmpdir(), "janus-hook-"));
  const repo = join(root, "alpha");
  const obsidianPath = join(root, "vault", "alpha");
  await mkdir(repo, { recursive: true });
  await mkdir(obsidianPath, { recursive: true });
  return {
    repo,
    config: {
      obsidianVault: join(root, "vault"),
      projects: [{ name: "alpha", repoPath: repo, obsidianPath }],
    },
  };
}

describe("Codex SessionStart output", () => {
  test("injects the tracked project's spine", async () => {
    const { config, repo } = await setup();
    await writeFile(join(config.projects[0]!.obsidianPath, "alpha-spine.md"), "# Alpha memory");
    const output = await buildCodexSessionStartOutput(
      { hook_event_name: "SessionStart", cwd: repo },
      config,
    ) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(output.hookSpecificOutput.additionalContext).toContain("# Alpha memory");
  });

  test("emits no model context outside tracking scope", async () => {
    const { config } = await setup();
    expect(await buildCodexSessionStartOutput(
      { hook_event_name: "SessionStart", cwd: root },
      config,
    )).toBeNull();
  });

  test("treats a missing spine as recoverable context", async () => {
    const { config, repo } = await setup();
    const output = await buildCodexSessionStartOutput({ cwd: repo }, config) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(output.hookSpecificOutput.additionalContext).toContain("no project spine exists");
  });
});
