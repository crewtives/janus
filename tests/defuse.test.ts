import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JanusConfig } from "../src/config/types.ts";
import {
  defuseVault,
  defusePulseBody,
  delinkPulseWikilinks,
  defusePulseContent,
  defuseNonPulse,
} from "../src/core/defuse.ts";

// ---------- pure unit tests ----------

describe("defusePulseBody", () => {
  const body = `## TL;DR

> [!summary]+ ok

## Related
- Hub: [[Wrong Alias]]
- Previous pulse: [[2026-05-01-demo]]
- Pulse anterior: [[2026-05-01-demo]]
- (no previous pulse in the vault — first pulse for the project or a gap)
- Hub: [[demo]]
- MOCs: [[Decisions MOC]] · [[Risks MOC]] · [[Projects MOC]]
`;

  test("strips MOC footer + every date-chain variant, keeps exactly one canonical Hub (R8/R10/R11)", () => {
    const out = defusePulseBody(body, "demo");
    expect(out).not.toContain("[[Projects MOC]]");
    expect(out).not.toContain("Previous pulse:");
    expect(out).not.toContain("Pulse anterior:");
    expect(out).not.toContain("no previous pulse in the vault");
    expect((out.match(/^- Hub: \[\[demo\]\]$/gm) ?? []).length).toBe(1);
  });

  test("idempotent", () => {
    const once = defusePulseBody(body, "demo");
    expect(defusePulseBody(once, "demo")).toBe(once);
  });
});

describe("delinkPulseWikilinks (OQ1)", () => {
  test("delinks pulse links in prose to plain text; leaves hub/track links", () => {
    const prose = `> - **Recurring**: dirty tree — appeared on [[2026-05-14-demo|2026-05-14]]
> — [[2026-05-10-demo]]
- Hub: [[demo]]
- Track: [[globex-checkout]]`;
    const out = delinkPulseWikilinks(prose);
    expect(out).toContain("appeared on 2026-05-14");
    expect(out).toContain("— 2026-05-10");
    expect(out).not.toContain("[[2026-05-14-demo");
    expect(out).not.toContain("[[2026-05-10-demo");
    // structural links to hubs/tracks are NOT pulse links → untouched
    expect(out).toContain("- Hub: [[demo]]");
    expect(out).toContain("- Track: [[globex-checkout]]");
  });
});

describe("defusePulseContent", () => {
  const pulse = `---
date: 2026-05-02
project: demo
status: on-track
tags: [pulse, pulse/demo]
---

## Related
- Hub: [[demo]]
- Previous pulse: [[2026-05-01-demo]]
- MOCs: [[Projects MOC]]
`;

  test("additive tags keep bare pulse; prev/next stamped as scalars", () => {
    const out = defusePulseContent(pulse, { project: "demo", projectId: "demo", prev: "2026-05-01-demo", next: "2026-05-03-demo" });
    expect(out).toContain("tags: [pulse, pulse/demo, type/pulse, project/demo]");
    expect(out).toContain("prev: 2026-05-01-demo");
    expect(out).toContain("next: 2026-05-03-demo");
    expect(out).not.toContain("Previous pulse:");
    expect(out).not.toContain("[[Projects MOC]]");
  });

  test("idempotent — twice is byte-for-byte identical", () => {
    const once = defusePulseContent(pulse, { project: "demo", projectId: "demo", prev: "2026-05-01-demo", next: null });
    const twice = defusePulseContent(once, { project: "demo", projectId: "demo", prev: "2026-05-01-demo", next: null });
    expect(twice).toBe(once);
    expect(once).not.toContain("next:"); // boundary: last pulse has no next
  });
});

// ---------- integration over a hermetic vault ----------

async function seedVault() {
  const dir = await mkdtemp(join(tmpdir(), "janus-defuse-"));
  const vault = join(dir, "vault");
  const pdir = join(vault, "Projects", "demo");
  await mkdir(join(pdir, "pulse"), { recursive: true });
  await mkdir(join(pdir, "_archive", "2026-04"), { recursive: true });
  await mkdir(join(vault, "Notes"), { recursive: true });
  await mkdir(join(vault, "Timeline", "Daily"), { recursive: true });
  await mkdir(join(vault, "Dashboards"), { recursive: true });
  await mkdir(join(vault, "MOCs"), { recursive: true });

  const pulse = (date: string, related: string, extraFm = "", body = "") => `---
date: ${date}
project: demo
status: on-track
tags: [pulse, pulse/demo]${extraFm}
---

## TL;DR

> [!summary]+ ok
${body}
## Related
${related}
`;

  // archived pulse (older month)
  await writeFile(join(pdir, "_archive", "2026-04", "2026-04-30-demo.md"),
    pulse("2026-04-30", `- Hub: [[demo]]\n- MOCs: [[Projects MOC]]`));
  // live pulses — first carries an EN date-chain, second an ES one + prose links
  await writeFile(join(pdir, "pulse", "2026-05-01-demo.md"),
    pulse("2026-05-01", `- Hub: [[demo]]\n- Previous pulse: [[2026-04-30-demo]]\n- MOCs: [[Decisions MOC]] · [[Projects MOC]]`));
  await writeFile(join(pdir, "pulse", "2026-05-02-demo.md"),
    pulse("2026-05-02", `- Hub: [[demo]]\n- Pulse anterior: [[2026-05-01-demo]]\n- MOCs: [[Projects MOC]]`,
      "", `\n> [!danger] Risks\n> - **Recurring**: dirty tree — appeared on [[2026-05-01-demo|2026-05-01]]\n`));
  // frozen pulse (R19) — must be left byte-for-byte
  const frozen = pulse("2026-05-03", `- Hub: [[demo]]\n- MOCs: [[Projects MOC]]`, "\nmanaged_by_janus: false");
  await writeFile(join(pdir, "pulse", "2026-05-03-demo.md"), frozen);

  // project files
  await writeFile(join(pdir, "demo.md"), `---\ntype: project-hub\nproject: demo\ntags: [project-hub]\n---\n\n# demo\n\n## MOCs\n- [[Projects MOC]]\n`);
  await writeFile(join(pdir, "_index.md"), `---\ntype: project-index\nproject: demo\ntags: [project-index]\nmanaged_by_janus: true\n---\n\n- MOCs: [[Projects MOC]]\n`);
  await writeFile(join(pdir, "STRATEGY.md"), `---\ntype: strategy\nproject: demo\nstatus: draft\nneeds_review: true\n---\n\n# STRATEGY — demo\n\n## Notes\n- x\n`);
  await writeFile(join(pdir, "_roadmap.md"), `---\ntype: roadmap\nproject: demo\nneeds_review: true\n---\n\n# Roadmap\n`);
  await writeFile(join(pdir, "demo-spine.md"), `---\ntype: project-spine\nproject: demo\ntags: [project-spine, project-spine/demo]\n---\n\n# spine\n`);

  // global notes
  const NOTE = `# Vanilla beats SDK

**Topic:** Architecture

Prose with an embedded HR:

---

More prose.
`;
  await writeFile(join(vault, "Notes", "2026-05-21-vanilla.md"), NOTE);
  await writeFile(join(vault, "Timeline", "Daily", "2026-05-02.md"), `---\ndate: 2026-05-02\ntags: [daily, daily/2026-05]\n---\n\n# daily\n`);
  await writeFile(join(vault, "Dashboards", "Open Risks.md"), `---\ntags: [dashboard]\n---\n\n# risks\n`);
  await writeFile(join(vault, "MOCs", "Projects MOC.md"), `---\ntags: [moc]\n---\n\n# Projects MOC\n`);

  const config = {
    obsidianVault: vault,
    projects: [{ name: "demo", repoPath: join(dir, "repo"), obsidianPath: pdir, status: "active" }],
  } as JanusConfig;
  return { dir, vault, pdir, config, NOTE, frozen };
}

describe("defuseVault (integration)", () => {
  test("idempotent: a second --apply run changes nothing (byte-for-byte)", async () => {
    const { dir, config } = await seedVault();
    try {
      const first = await defuseVault({ vaultPath: config.obsidianVault, config });
      expect(first.changed).toBeGreaterThan(0);
      const second = await defuseVault({ vaultPath: config.obsidianVault, config });
      expect(second.changed).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("respects R19 freeze — a managed_by_janus:false pulse is untouched", async () => {
    const { dir, pdir, config, frozen } = await seedVault();
    try {
      const r = await defuseVault({ vaultPath: config.obsidianVault, config });
      expect(r.skipped).toBeGreaterThanOrEqual(1);
      const after = await readFile(join(pdir, "pulse", "2026-05-03-demo.md"), "utf-8");
      expect(after).toBe(frozen); // byte-for-byte (still has its MOC footer)
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("type-aware transforms: pulse de-fused, hub/index keep footer, all gain tags", async () => {
    const { dir, pdir, config } = await seedVault();
    try {
      await defuseVault({ vaultPath: config.obsidianVault, config });

      // pulse (live, middle): footer + date-chain gone, prose link delinked, prev/next, tags
      const p2 = await readFile(join(pdir, "pulse", "2026-05-02-demo.md"), "utf-8");
      expect(p2).toContain("tags: [pulse, pulse/demo, type/pulse, project/demo]");
      expect(p2).toContain("prev: 2026-05-01-demo");
      expect(p2).not.toContain("[[Projects MOC]]");
      expect(p2).not.toContain("Pulse anterior:");
      expect(p2).toContain("appeared on 2026-05-01"); // OQ1: delinked to plain text
      expect(p2).not.toContain("[[2026-05-01-demo|2026-05-01]]");
      expect((p2.match(/^- Hub: \[\[demo\]\]$/gm) ?? []).length).toBe(1);

      // archived pulse rewritten: gains tags + a next pointer into the live tail
      const arch = await readFile(join(pdir, "_archive", "2026-04", "2026-04-30-demo.md"), "utf-8");
      expect(arch).toContain("type/pulse");
      expect(arch).toContain("next: 2026-05-01-demo");
      expect(arch).not.toContain("[[Projects MOC]]");

      // hub + index keep their MOC footer (KD3), gain additive tags
      const hub = await readFile(join(pdir, "demo.md"), "utf-8");
      expect(hub).toContain("tags: [project-hub, type/hub, project/demo]");
      expect(hub).toContain("[[Projects MOC]]");
      const idx = await readFile(join(pdir, "_index.md"), "utf-8");
      expect(idx).toContain("tags: [project-index, type/index, project/demo]");
      expect(idx).toContain("[[Projects MOC]]"); // NOT stripped on an index

      // spine gains tags
      const spine = await readFile(join(pdir, "demo-spine.md"), "utf-8");
      expect(spine).toContain("type/spine");

      // STRATEGY gains tags + a hub backlink (R13)
      const strat = await readFile(join(pdir, "STRATEGY.md"), "utf-8");
      expect(strat).toContain("tags: [type/strategy, project/demo]");
      expect(strat).toContain("- Hub: [[demo]]");

      // aggregators / global: type tag only, no project (KD9)
      const daily = await readFile(join(config.obsidianVault, "Timeline", "Daily", "2026-05-02.md"), "utf-8");
      expect(daily).toContain("type/daily");
      expect(daily).not.toContain("project/");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("Note gains a type/note block without corrupting its embedded --- HR (KD5)", async () => {
    const { dir, vault, config, NOTE } = await seedVault();
    try {
      await defuseVault({ vaultPath: config.obsidianVault, config });
      const note = await readFile(join(vault, "Notes", "2026-05-21-vanilla.md"), "utf-8");
      expect(note.startsWith("---\ntype: note\ntags: [type/note]\n---")).toBe(true);
      expect(note).toContain("# Vanilla beats SDK");
      expect(note).toContain("More prose."); // body (incl. embedded HR) preserved
      expect(note).not.toContain("project/"); // project deferred (OQ2)
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("dry-run writes nothing", async () => {
    const { dir, pdir, config } = await seedVault();
    try {
      const before = await readFile(join(pdir, "pulse", "2026-05-02-demo.md"), "utf-8");
      const r = await defuseVault({ vaultPath: config.obsidianVault, config, dryRun: true });
      expect(r.changed).toBeGreaterThan(0); // counts what WOULD change
      const after = await readFile(join(pdir, "pulse", "2026-05-02-demo.md"), "utf-8");
      expect(after).toBe(before); // …but touches nothing
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
