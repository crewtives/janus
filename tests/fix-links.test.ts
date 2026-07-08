import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixBrokenPreviousLinks } from "../src/core/fix-links.ts";

async function setup(pulses: Array<{ date: string; prevLink: string | null }>): Promise<{ obsidianPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "janus-fixlinks-"));
  const obsidianPath = join(dir, "vault");
  const pulseDir = join(obsidianPath, "pulse");
  await mkdir(pulseDir, { recursive: true });
  for (const { date, prevLink } of pulses) {
    const prevLine = prevLink === null
      ? "- (sin pulse anterior)"
      : `- Día anterior: [[${prevLink}]]`;
    const content = `---\ndate: ${date}\nproject: test-proj\nstatus: on-track\ncommits: 0\nprompt_version: v4\ntags: [pulse, pulse/test-proj]\n---\n\n## TL;DR\n\n> [!summary]+\n> ok.\n\n## Related\n- Hub: [[test-proj]]\n${prevLine}\n- MOCs: [[Projects MOC]]\n`;
    await writeFile(join(pulseDir, `${date}-test-proj.md`), content);
  }
  return {
    obsidianPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

describe("fixBrokenPreviousLinks", () => {
  // R10: fix-links no longer maintains the `- Pulse anterior: [[…]]` date-chain.
  // A broken date-chain wikilink is just degraded to plain text (no edge kept).
  test("a broken date-chain wikilink degrades to plain text (no date-chain edge)", async () => {
    const { obsidianPath, cleanup } = await setup([
      { date: "2026-05-13", prevLink: "2026-05-12-test-proj" }, // broken, no streak covers it
      { date: "2026-05-15", prevLink: "2026-05-14-test-proj" }, // broken, no streak covers it
    ]);
    const r = await fixBrokenPreviousLinks({ obsidianPath, project: "test-proj" });
    expect(r.brokenLinksRemoved).toBe(2);
    expect(r.fixedLinks).toBe(0); // nothing to redirect to → plain text

    const day15 = await readFile(join(obsidianPath, "pulse", "2026-05-15-test-proj.md"), "utf-8");
    expect(day15).not.toContain("[[2026-05-14-test-proj]]"); // broken edge removed
    expect(day15).toContain("2026-05-14"); // mention preserved as text

    await cleanup();
  });

  test("idempotent: if all links are valid, touches nothing", async () => {
    const { obsidianPath, cleanup } = await setup([
      { date: "2026-05-13", prevLink: null },
      { date: "2026-05-14", prevLink: "2026-05-13-test-proj" },
      { date: "2026-05-15", prevLink: "2026-05-14-test-proj" },
    ]);
    const r = await fixBrokenPreviousLinks({ obsidianPath, project: "test-proj" });
    expect(r.brokenLinksRemoved).toBe(0);
    expect(r.pulsesFixed).toBe(0);
    await cleanup();
  });

  test("dryRun does not write files", async () => {
    const { obsidianPath, cleanup } = await setup([
      { date: "2026-05-13", prevLink: "2026-05-12-test-proj" },
    ]);
    const r = await fixBrokenPreviousLinks({ obsidianPath, project: "test-proj", dryRun: true });
    expect(r.brokenLinksRemoved).toBe(1);
    expect(r.pulsesFixed).toBe(1); // contado, pero no escrito
    const content = await readFile(join(obsidianPath, "pulse", "2026-05-13-test-proj.md"), "utf-8");
    expect(content).toContain("2026-05-12-test-proj"); // sigue igual
    await cleanup();
  });

  test("inline cross-reference (Risks callout) to a date inside a streak → redirects to the streak owner", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-fixlinks-xref-"));
    const obsidianPath = join(dir, "vault");
    const pulseDir = join(obsidianPath, "pulse");
    await mkdir(pulseDir, { recursive: true });

    // Streak del 13 al 15 (cubre 14)
    const streakContent = `---\ndate: 2026-05-13\nproject: test-proj\nstatus: idle-streak\nstreak_start: 2026-05-13\nstreak_end: 2026-05-15\nstreak_days: 3\ncommits: 0\nprompt_version: compact\ntags: [pulse]\n---\n\n## TL;DR\n> idle\n`;
    await writeFile(join(pulseDir, "2026-05-13-test-proj.md"), streakContent);

    // Pulse del 16 con cross-reference al 14 (que no existe pero cae en streak)
    const day16 = `---\ndate: 2026-05-16\nproject: test-proj\nstatus: on-track\ncommits: 1\nprompt_version: v4\ntags: [pulse]\n---\n\n## TL;DR\n> ok\n\n> [!danger] Risks\n> - **Recurrente**: working tree sucio — apareció el [[2026-05-14-test-proj|2026-05-14]]\n`;
    await writeFile(join(pulseDir, "2026-05-16-test-proj.md"), day16);

    const r = await fixBrokenPreviousLinks({ obsidianPath, project: "test-proj" });
    expect(r.fixedLinks).toBeGreaterThanOrEqual(1);
    const updated = await readFile(join(pulseDir, "2026-05-16-test-proj.md"), "utf-8");
    expect(updated).toContain("[[2026-05-13-test-proj|2026-05-14]]");
    expect(updated).not.toContain("[[2026-05-14-test-proj");
    await rm(dir, { recursive: true, force: true });
  });

  test("cross-reference to a date before the first pulse → plain text without link", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-fixlinks-pre-"));
    const obsidianPath = join(dir, "vault");
    const pulseDir = join(obsidianPath, "pulse");
    await mkdir(pulseDir, { recursive: true });
    const day14 = `---\ndate: 2026-05-14\nproject: test-proj\nstatus: on-track\ncommits: 1\nprompt_version: v4\ntags: [pulse]\n---\n\n## TL;DR\n> ok\n\n- mención [[2026-05-10-test-proj|2026-05-10]]\n`;
    await writeFile(join(pulseDir, "2026-05-14-test-proj.md"), day14);

    const r = await fixBrokenPreviousLinks({ obsidianPath, project: "test-proj" });
    const updated = await readFile(join(pulseDir, "2026-05-14-test-proj.md"), "utf-8");
    expect(updated).not.toContain("[[2026-05-10");
    expect(updated).toContain("mención 2026-05-10");
    expect(r.brokenLinksRemoved).toBeGreaterThanOrEqual(1);
    await rm(dir, { recursive: true, force: true });
  });
});
