import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installDailyPulseSkill } from "../src/core/init/skill.ts";

async function setup(withSkill: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "janus-skill-"));
  const repo = join(dir, "repo");
  const home = join(dir, "home");
  await mkdir(repo, { recursive: true });
  await mkdir(home, { recursive: true });
  if (withSkill) {
    await mkdir(join(repo, "skill"), { recursive: true });
    await writeFile(join(repo, "skill", "SKILL.md"), "# skill");
  }
  return { dir, repo, home, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("installDailyPulseSkill", () => {
  test("symlinks skill/ into ~/.claude/skills/daily-pulse", async () => {
    const { repo, home, cleanup } = await setup(true);
    try {
      const r = installDailyPulseSkill(repo, home);
      expect(r.action).toBe("installed");
      const target = join(home, ".claude", "skills", "daily-pulse");
      expect(lstatSync(target).isSymbolicLink()).toBe(true);
      expect(readlinkSync(target)).toBe(join(repo, "skill"));
    } finally {
      await cleanup();
    }
  });

  test("is idempotent — second run reports unchanged", async () => {
    const { repo, home, cleanup } = await setup(true);
    try {
      installDailyPulseSkill(repo, home);
      const r = installDailyPulseSkill(repo, home);
      expect(r.action).toBe("unchanged");
    } finally {
      await cleanup();
    }
  });

  test("skips when there is no skill/ dir (binary-only install)", async () => {
    const { repo, home, cleanup } = await setup(false);
    try {
      const r = installDailyPulseSkill(repo, home);
      expect(r.action).toBe("skipped-no-source");
      expect(existsSync(join(home, ".claude", "skills", "daily-pulse"))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test("does not clobber a real (non-symlink) dir at the target", async () => {
    const { repo, home, cleanup } = await setup(true);
    try {
      const target = join(home, ".claude", "skills", "daily-pulse");
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "user-file.md"), "mine");
      const r = installDailyPulseSkill(repo, home);
      expect(r.action).toBe("skipped-conflict");
      expect(existsSync(join(target, "user-file.md"))).toBe(true);
    } finally {
      await cleanup();
    }
  });
});
