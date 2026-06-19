import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SkillInstallAction =
  | "installed"
  | "unchanged"
  | "replaced"
  | "skipped-no-source"
  | "skipped-conflict";

export interface SkillInstallResult {
  action: SkillInstallAction;
  target: string;
  source: string;
}

/**
 * Symlinks `<repoRoot>/skill` → `~/.claude/skills/daily-pulse`, the in-process
 * twin of scripts/install-skill.sh so the wizard can offer it without shelling
 * out. Idempotent. Returns `skipped-no-source` when run from a binary-only
 * install (no `skill/` dir on disk) and `skipped-conflict` when the target is a
 * real file/dir we shouldn't clobber.
 */
export function installDailyPulseSkill(repoRoot: string, homeDir: string = homedir()): SkillInstallResult {
  const source = join(repoRoot, "skill");
  const skillsDir = join(homeDir, ".claude", "skills");
  const target = join(skillsDir, "daily-pulse");

  if (!existsSync(join(source, "SKILL.md"))) {
    return { action: "skipped-no-source", target, source };
  }

  mkdirSync(skillsDir, { recursive: true });

  if (isSymlink(target)) {
    if (readlinkSync(target) === source) return { action: "unchanged", target, source };
    rmSync(target);
    symlinkSync(source, target);
    return { action: "replaced", target, source };
  }
  if (existsSync(target)) {
    // A real directory/file already lives there — don't destroy user data.
    return { action: "skipped-conflict", target, source };
  }

  symlinkSync(source, target);
  return { action: "installed", target, source };
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
