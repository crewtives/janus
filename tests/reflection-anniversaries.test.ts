import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Checkpoint } from "../src/core/checkpoint.ts";
import { detectProjectAnniversary, renderAnniversaryCallout } from "../src/core/reflection/anniversaries.ts";
import type { ProjectConfig } from "../src/config/types.ts";

function makeProject(name: string, repoPath: string, obsidianPath: string): ProjectConfig {
  return { name, repoPath, obsidianPath };
}

describe("reflection/anniversaries", () => {
  test("renderAnniversaryCallout produces a valid, narrative callout", () => {
    const out = renderAnniversaryCallout(
      { years: 1, sinceDate: "2025-05-22", source: "git" },
      "test-project",
    );
    expect(out).toContain("[!important]");
    expect(out).toContain("🎂");
    expect(out).toContain("1 year");
    expect(out).toContain("test-project");
    expect(out).toContain("2025-05-22");
    expect(out).toContain("first commit");
  });

  test("renderAnniversaryCallout pluralizes years > 1", () => {
    const out = renderAnniversaryCallout(
      { years: 3, sinceDate: "2023-01-15", source: "pulse" },
      "x",
    );
    expect(out).toContain("3 years");
    expect(out).toContain("first pulse");
  });

  test("detectProjectAnniversary returns null when there are no birth dates", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "janus-anniv-"));
    const cp = Checkpoint.open(stateDir);
    cp.upsertProjectMetadata({ project: "p", birthDateGit: null, birthDatePulse: null });
    const result = await detectProjectAnniversary({
      project: makeProject("p", "/nonexistent-repo", "/nonexistent-vault"),
      checkpoint: cp,
      today: "2026-05-22",
    });
    cp.close();
    expect(result).toBeNull();
  });

  test("detectProjectAnniversary prioritizes birth_date_git over birth_date_pulse", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "janus-anniv-"));
    const cp = Checkpoint.open(stateDir);
    cp.upsertProjectMetadata({
      project: "p",
      birthDateGit: "2025-05-22",
      birthDatePulse: "2024-05-22",
    });
    const result = await detectProjectAnniversary({
      project: makeProject("p", "/nonexistent-repo", "/nonexistent-vault"),
      checkpoint: cp,
      today: "2026-05-22",
    });
    cp.close();
    expect(result).not.toBeNull();
    expect(result!.source).toBe("git");
    expect(result!.years).toBe(1);
    expect(result!.sinceDate).toBe("2025-05-22");
  });

  test("detectProjectAnniversary falls back to birth_date_pulse when there is no git", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "janus-anniv-"));
    const cp = Checkpoint.open(stateDir);
    cp.upsertProjectMetadata({
      project: "p",
      birthDateGit: null,
      birthDatePulse: "2024-05-22",
    });
    const result = await detectProjectAnniversary({
      project: makeProject("p", "/nonexistent-repo", "/nonexistent-vault"),
      checkpoint: cp,
      today: "2026-05-22",
    });
    cp.close();
    expect(result).not.toBeNull();
    expect(result!.source).toBe("pulse");
    expect(result!.years).toBe(2);
  });

  test("detectProjectAnniversary returns null when MM-DD does not match", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "janus-anniv-"));
    const cp = Checkpoint.open(stateDir);
    cp.upsertProjectMetadata({
      project: "p",
      birthDateGit: "2025-05-22",
      birthDatePulse: null,
    });
    const result = await detectProjectAnniversary({
      project: makeProject("p", "/nonexistent-repo", "/nonexistent-vault"),
      checkpoint: cp,
      today: "2026-05-21",
    });
    cp.close();
    expect(result).toBeNull();
  });

  test("detectProjectAnniversary returns null when a year has not passed yet", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "janus-anniv-"));
    const cp = Checkpoint.open(stateDir);
    cp.upsertProjectMetadata({
      project: "p",
      birthDateGit: "2026-05-22",
      birthDatePulse: null,
    });
    const result = await detectProjectAnniversary({
      project: makeProject("p", "/nonexistent-repo", "/nonexistent-vault"),
      checkpoint: cp,
      today: "2026-05-22",
    });
    cp.close();
    expect(result).toBeNull();
  });
});
