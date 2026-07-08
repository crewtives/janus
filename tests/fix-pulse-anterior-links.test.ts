import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fixRelatedSection,
  writePrevNext,
  fixProject,
} from "../scripts/fix-pulse-anterior-links.ts";

function makePulse(relatedBody: string, extraFrontmatter = ""): string {
  return `---
date: 2026-05-15
project: demo
status: idle${extraFrontmatter}
---

## TL;DR

> [!summary]+
> Día sin actividad registrada.

## Related
${relatedBody}

> [!info]- Raw activity
> - Commits: 0
`;
}

// --- writePrevNext: idempotency first (R10 chronology in frontmatter) ---
describe("writePrevNext", () => {
  test("stamps bare prev/next scalars (never a wiki-link) and is idempotent", () => {
    const input = makePulse(`- Hub: [[demo]]`);
    const r1 = writePrevNext(input, "2026-05-14-demo", "2026-05-16-demo");
    expect(r1.changed).toBe(true);
    expect(r1.content).toContain("prev: 2026-05-14-demo");
    expect(r1.content).toContain("next: 2026-05-16-demo");
    expect(r1.content).not.toContain("prev: [[");
    // idempotent — same values → byte-for-byte no-op
    const r2 = writePrevNext(r1.content, "2026-05-14-demo", "2026-05-16-demo");
    expect(r2.changed).toBe(false);
    expect(r2.content).toBe(r1.content);
  });

  test("boundary pulse drops the absent side", () => {
    const withNext = writePrevNext(makePulse(`- Hub: [[demo]]`), "2026-05-14-demo", "2026-05-16-demo").content;
    // becomes the last pulse → next removed, prev kept
    const r = writePrevNext(withNext, "2026-05-14-demo", null);
    expect(r.changed).toBe(true);
    expect(r.content).toContain("prev: 2026-05-14-demo");
    expect(r.content).not.toContain("next:");
  });

  test("no frontmatter → no-op", () => {
    const r = writePrevNext("# just a body\n\nno frontmatter", "a", "b");
    expect(r.changed).toBe(false);
  });
});

// --- fixRelatedSection: hub repair only, never re-inserts a date-chain line ---
describe("fixRelatedSection", () => {
  test("repairs a drifted hub (alias/typo) → canonical [[demo]]", () => {
    const input = makePulse(`- Hub: [[Demo Project Hub]]
- MOCs: [[Decisions MOC]]`);
    const r = fixRelatedSection(input, "demo");
    expect(r.changed).toBe(true);
    expect(r.content).toContain("- Hub: [[demo]]");
  });

  test("never inserts a `Pulse anterior` / `Previous pulse` line (R10)", () => {
    const input = makePulse(`- Hub: [[demo]]
- MOCs: [[Decisions MOC]]`);
    const r = fixRelatedSection(input, "demo");
    expect(r.content).not.toContain("Pulse anterior");
    expect(r.content).not.toContain("Previous pulse");
  });

  test("already canonical hub → no change", () => {
    const input = makePulse(`- Hub: [[demo]]
- MOCs: [[Decisions MOC]]`);
    const r = fixRelatedSection(input, "demo");
    expect(r.changed).toBe(false);
    expect(r.reason).toContain("canónico");
  });

  test("no ## Related section → does nothing", () => {
    const r = fixRelatedSection("# nada\n\nbody sin related", "demo");
    expect(r.changed).toBe(false);
    expect(r.reason).toContain("sin sección");
  });

  test("respects other lines in the Related section (MOCs, etc.)", () => {
    const input = makePulse(`- Hub: [[demo]]
- MOCs: [[Decisions MOC]] · [[Risks MOC]] · [[Projects MOC]]`);
    const r = fixRelatedSection(input, "demo");
    expect(r.content).toContain("- MOCs: [[Decisions MOC]] · [[Risks MOC]] · [[Projects MOC]]");
  });
});

// --- fixProject: full live+archive sequence, mutate the live tail only ---
describe("fixProject (prev/next over the full sequence)", () => {
  async function seedProject(): Promise<{ name: string; repoPath: string; obsidianPath: string }> {
    const root = await mkdtemp(join(tmpdir(), "janus-fixrel-"));
    const proj = { name: "demo", repoPath: root, obsidianPath: root };
    const pulseDir = join(root, "pulse");
    const archiveDir = join(root, "_archive", "2026-04");
    await mkdir(pulseDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });

    const pulse = (date: string, related = `- Hub: [[demo]]`) => `---
date: ${date}
project: demo
status: on-track
tags: [pulse, pulse/demo]
---

## TL;DR

> [!summary]+ ok

## Related
${related}
`;
    // one archived pulse (older month) + three live pulses (current month)
    await writeFile(join(archiveDir, "2026-04-30-demo.md"), pulse("2026-04-30"));
    await writeFile(join(pulseDir, "2026-05-01-demo.md"), pulse("2026-05-01"));
    await writeFile(join(pulseDir, "2026-05-02-demo.md"), pulse("2026-05-02"));
    await writeFile(join(pulseDir, "2026-05-03-demo.md"), pulse("2026-05-03"));
    return proj;
  }

  test("middle live pulse gets both; first live prev = last archive; latest has no next", async () => {
    const proj = await seedProject();
    await fixProject(proj as never, false);

    const p1 = await readFile(join(proj.obsidianPath, "pulse", "2026-05-01-demo.md"), "utf-8");
    expect(p1).toContain("prev: 2026-04-30-demo"); // boundary reaches into _archive
    expect(p1).toContain("next: 2026-05-02-demo");

    const p2 = await readFile(join(proj.obsidianPath, "pulse", "2026-05-02-demo.md"), "utf-8");
    expect(p2).toContain("prev: 2026-05-01-demo");
    expect(p2).toContain("next: 2026-05-03-demo");

    const p3 = await readFile(join(proj.obsidianPath, "pulse", "2026-05-03-demo.md"), "utf-8");
    expect(p3).toContain("prev: 2026-05-02-demo");
    expect(p3).not.toContain("next:"); // latest live pulse

    // never re-emits the date-chain line
    expect(p2).not.toContain("Pulse anterior");
  });

  test("archive pulses are left untouched (U4 owns archive)", async () => {
    const proj = await seedProject();
    await fixProject(proj as never, false);
    const arch = await readFile(join(proj.obsidianPath, "_archive", "2026-04", "2026-04-30-demo.md"), "utf-8");
    expect(arch).not.toContain("prev:");
    expect(arch).not.toContain("next:");
  });

  test("idempotent — second run makes no changes", async () => {
    const proj = await seedProject();
    const first = await fixProject(proj as never, false);
    expect(first.changed).toBe(3);
    const second = await fixProject(proj as never, false);
    expect(second.changed).toBe(0);
  });
});
