import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JanusConfig, ProjectConfig } from "../src/config/types.ts";
import { collectProjectCards, normalizeColumn } from "../src/core/kanvas.ts";

interface FixtureProject {
  name: string;
  status?: ProjectConfig["status"];
  /** `null` writes no mirror at all. */
  roadmap: string | null;
  /** Write a directory where the mirror should be, to force a read failure. */
  roadmapIsDir?: boolean;
}

async function setup(projects: FixtureProject[]): Promise<{
  config: JanusConfig;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "janus-kanvas-"));
  const vault = join(dir, "vault");
  const configProjects: ProjectConfig[] = [];
  for (const p of projects) {
    const obsidianPath = join(vault, "Projects", p.name);
    await mkdir(obsidianPath, { recursive: true });
    if (p.roadmapIsDir) {
      await mkdir(join(obsidianPath, "_roadmap.md"), { recursive: true });
    } else if (p.roadmap !== null) {
      await writeFile(join(obsidianPath, "_roadmap.md"), p.roadmap);
    }
    configProjects.push({
      name: p.name,
      repoPath: join(dir, "repos", p.name),
      obsidianPath,
      ...(p.status ? { status: p.status } : {}),
    });
  }
  return {
    config: { obsidianVault: vault, projects: configProjects },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

function mirror(opts: { needsReview?: boolean; source?: string; body: string }): string {
  const lines = ["---", "type: roadmap"];
  if (opts.source !== undefined) lines.push(`source: ${opts.source}`);
  if (opts.needsReview !== undefined) lines.push(`needs_review: ${opts.needsReview}`);
  lines.push("---", "");
  return `${lines.join("\n")}\n${opts.body}`;
}

const RECONCILED = mirror({
  needsReview: false,
  source: "reconciled-vs-repo",
  body: `## Active milestones this week

- [ ] Wire the board route
- [ ] Staging deploy

## Shipped

- [x] Canvas editor UI

## Near backlog

- [ ] Strategy doc
`,
});

describe("normalizeColumn", () => {
  test("maps recognized English headings", () => {
    expect(normalizeColumn("Active milestones this week")).toBe("now");
    expect(normalizeColumn("In progress")).toBe("now");
    expect(normalizeColumn("Near backlog")).toBe("next");
    expect(normalizeColumn("Shipped")).toBe("done");
    expect(normalizeColumn("Blocked")).toBe("blocked");
  });

  test("maps Spanish headings to the same columns", () => {
    expect(normalizeColumn("En curso")).toBe("now");
    expect(normalizeColumn("Próximos pasos")).toBe("next");
    expect(normalizeColumn("Entregado")).toBe("done");
    expect(normalizeColumn("Bloqueado")).toBe("blocked");
  });

  test("strips emoji and trailing gloss before matching", () => {
    expect(normalizeColumn("🚧 In progress — pre-launch")).toBe("now");
    expect(normalizeColumn("Shipped (verificado 2026-07-10)")).toBe("done");
  });

  test("coerces an unrecognized heading to the default visible column", () => {
    expect(normalizeColumn("Dropeado")).toBe("next");
    expect(normalizeColumn("")).toBe("next");
  });
});

describe("collectProjectCards", () => {
  test("a recognized in-progress heading lands its card in the now column", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const result = await collectProjectCards({ config });
    const now = result.cards.filter((c) => c.column === "now").map((c) => c.title);
    expect(now).toEqual(["Wire the board route", "Staging deploy"]);
    await cleanup();
  });

  test("a checked box lands in done regardless of its heading", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const result = await collectProjectCards({ config });
    const done = result.cards.filter((c) => c.column === "done").map((c) => c.title);
    expect(done).toEqual(["Canvas editor UI"]);
    await cleanup();
  });

  test("a mirror not marked as needing review yields reconciled cards", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const result = await collectProjectCards({ config });
    expect(result.projects[0]?.outcome).toBe("reconciled");
    expect(result.cards.every((c) => c.provenance === "reconciled")).toBe(true);
    await cleanup();
  });

  test("a pulse-inferred mirror yields inferred cards, distinguishable from reconciled", async () => {
    const inferred = mirror({
      needsReview: true,
      source: "pulse-inference",
      body: "## Active milestones this week\n\n- [ ] Guessed item\n",
    });
    const { config, cleanup } = await setup([
      { name: "alpha", roadmap: RECONCILED },
      { name: "beta", roadmap: inferred },
    ]);
    const result = await collectProjectCards({ config });
    const beta = result.cards.filter((c) => c.project === "beta");
    expect(beta).toHaveLength(1);
    expect(beta[0]?.provenance).toBe("inferred");
    expect(result.projects.find((p) => p.project === "beta")?.outcome).toBe("inferred");
    expect(result.projects.find((p) => p.project === "alpha")?.outcome).toBe("reconciled");
    await cleanup();
  });

  test("a pending placeholder mirror is no-source, not a source with zero cards", async () => {
    const pending = mirror({
      needsReview: true,
      source: "pending",
      body: "## Mientras tanto\n\nNo hay roadmap todavía.\n",
    });
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: pending }]);
    const result = await collectProjectCards({ config });
    expect(result.projects[0]?.outcome).toBe("no-source");
    expect(result.cards).toHaveLength(0);
    await cleanup();
  });

  test("a mirror with no checkbox lines is no-source", async () => {
    const prose = mirror({
      needsReview: false,
      source: "reconciled-vs-repo",
      body: "## Objective\n\nSome prose, no work items.\n",
    });
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: prose }]);
    const result = await collectProjectCards({ config });
    expect(result.projects[0]?.outcome).toBe("no-source");
    await cleanup();
  });

  test("a missing mirror is no-source and does not throw", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: null }]);
    const result = await collectProjectCards({ config });
    expect(result.projects[0]?.outcome).toBe("no-source");
    await cleanup();
  });

  test("an unreadable mirror is unreachable and the other projects survive", async () => {
    const { config, cleanup } = await setup([
      { name: "alpha", roadmap: null, roadmapIsDir: true },
      { name: "beta", roadmap: RECONCILED },
    ]);
    const result = await collectProjectCards({ config });
    expect(result.projects.find((p) => p.project === "alpha")?.outcome).toBe("unreadable");
    expect(result.cards.filter((c) => c.project === "beta").length).toBeGreaterThan(0);
    await cleanup();
  });

  test("an archived project contributes nothing; a paused one contributes normally", async () => {
    const { config, cleanup } = await setup([
      { name: "alpha", roadmap: RECONCILED, status: "archived" },
      { name: "beta", roadmap: RECONCILED, status: "paused" },
    ]);
    const result = await collectProjectCards({ config });
    expect(result.cards.some((c) => c.project === "alpha")).toBe(false);
    expect(result.projects.some((p) => p.project === "alpha")).toBe(false);
    expect(result.cards.some((c) => c.project === "beta")).toBe(true);
    await cleanup();
  });

  test("an unmapped heading keeps its cards and does not change the card count", async () => {
    const odd = mirror({
      needsReview: false,
      source: "reconciled-vs-repo",
      body: "## Wildly Unexpected Section\n\n- [ ] Still a card\n- [ ] And another\n",
    });
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: odd }]);
    const result = await collectProjectCards({ config });
    expect(result.cards).toHaveLength(2);
    expect(result.cards.every((c) => c.column === "next")).toBe(true);
    await cleanup();
  });

  test("two projects with the same card title produce two distinct identities", async () => {
    const same = mirror({
      needsReview: false,
      source: "reconciled-vs-repo",
      body: "## In progress\n\n- [ ] auth\n",
    });
    const { config, cleanup } = await setup([
      { name: "alpha", roadmap: same },
      { name: "beta", roadmap: same },
    ]);
    const result = await collectProjectCards({ config });
    const ids = result.cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    await cleanup();
  });

  test("degenerate markdown does not throw and does not silently drop cards", async () => {
    const degenerate = mirror({
      needsReview: false,
      source: "reconciled-vs-repo",
      body: "- [ ] Orphan before any heading\n\n## In progress\n\n  - [ ] Indented item\n",
    });
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: degenerate }]);
    const result = await collectProjectCards({ config });
    expect(result.cards.map((c) => c.title)).toEqual(["Orphan before any heading", "Indented item"]);
    await cleanup();
  });
});
