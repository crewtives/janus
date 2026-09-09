import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JanusConfig, ProjectConfig } from "../src/config/types.ts";
import { Checkpoint } from "../src/core/checkpoint.ts";
import { defuseVault } from "../src/core/defuse.ts";
import type { BoardModel } from "../src/core/kanvas.ts";
import {
  boardPath,
  buildBoardModel,
  collectProjectCards,
  normalizeColumn,
  projectBoardPath,
  renderBoard,
  validateBoard,
  writeBoard,
} from "../src/core/kanvas.ts";

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

  test("a reviewed pulse-inferred mirror becomes reconciled (flow F2)", async () => {
    // The mirror Janus inferred, that the user then reviewed and froze, has been
    // taken over by a human. Gating provenance on `source` as well as
    // `needs_review` would strand it as inferred forever.
    const reviewed = mirror({
      needsReview: false,
      source: "pulse-inference",
      body: "## In progress\n\n- [ ] Reviewed by hand\n",
    });
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: reviewed }]);
    const result = await collectProjectCards({ config });
    expect(result.projects[0]?.outcome).toBe("reconciled");
    expect(result.cards[0]?.provenance).toBe("reconciled");
    await cleanup();
  });

  test("a pending placeholder mirror is no-mirror, not a source with zero cards", async () => {
    const pending = mirror({
      needsReview: true,
      source: "pending",
      body: "## Mientras tanto\n\nNo hay roadmap todavía.\n",
    });
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: pending }]);
    const result = await collectProjectCards({ config });
    expect(result.projects[0]?.outcome).toBe("no-mirror");
    expect(result.cards).toHaveLength(0);
    await cleanup();
  });

  test("a prose mirror is unparsed, which is not the same as having no mirror", async () => {
    const prose = mirror({
      needsReview: false,
      source: "reconciled-vs-repo",
      body: "## Objective\n\nSome prose, no work items.\n",
    });
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: prose }]);
    const result = await collectProjectCards({ config });
    expect(result.projects[0]?.outcome).toBe("unparsed");
    await cleanup();
  });

  test("a missing mirror is no-mirror and does not throw", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: null }]);
    const result = await collectProjectCards({ config });
    expect(result.projects[0]?.outcome).toBe("no-mirror");
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

// ─── U7: cross-project blocked lane and model assembly ──────────────────────

async function setupState(rows: Array<{ hash: string; project?: string; lastSeen: string; text: string }>): Promise<{
  stateDir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "janus-kanvas-state-"));
  const stateDir = join(dir, ".janus");
  const cp = Checkpoint.open(stateDir);
  for (const r of rows) {
    cp.recordBlockerOccurrence({
      blockerHash: r.hash,
      project: r.project ?? "_global",
      weeklyEndDate: r.lastSeen,
      sampleText: r.text,
    });
  }
  cp.close();
  return { stateDir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("buildBoardModel — blocked lane", () => {
  test("rows inside the window appear; rows outside are declined", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const state = await setupState([
      { hash: "aaa", lastSeen: "2026-09-06", text: "fresh blocker" },
      { hash: "bbb", lastSeen: "2026-05-24", text: "ancient blocker" },
    ]);
    const model = await buildBoardModel({
      config: { ...config, stateDir: state.stateDir },
      today: "2026-09-09",
    });
    expect(model.blocked.map((b) => b.text)).toEqual(["fresh blocker"]);
    expect(model.declined).toBe(1);
    expect(model.blockedOutcome).toBe("ok");
    await state.cleanup();
    await cleanup();
  });

  test("an absent state database is unreachable, not an empty lane", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const dir = await mkdtemp(join(tmpdir(), "janus-kanvas-nostate-"));
    const model = await buildBoardModel({
      config: { ...config, stateDir: join(dir, "does-not-exist") },
      today: "2026-09-09",
    });
    expect(model.blockedOutcome).toBe("unreachable");
    expect(model.partial).toBe(true);
    expect(model.blocked).toHaveLength(0);
    await rm(dir, { recursive: true, force: true });
    await cleanup();
  });

  test("rows exist but none in window reads as unknown, not empty", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const state = await setupState([{ hash: "old", lastSeen: "2026-01-01", text: "stale" }]);
    const model = await buildBoardModel({
      config: { ...config, stateDir: state.stateDir },
      today: "2026-09-09",
    });
    expect(model.blockedOutcome).toBe("no-rows-in-window");
    expect(model.blocked).toHaveLength(0);
    await state.cleanup();
    await cleanup();
  });

  test("an empty blocker table also reads as unknown", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const state = await setupState([]);
    const model = await buildBoardModel({
      config: { ...config, stateDir: state.stateDir },
      today: "2026-09-09",
    });
    expect(model.blockedOutcome).toBe("no-rows-in-window");
    await state.cleanup();
    await cleanup();
  });

  test("rows carrying a project key that matches no configured project still appear", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const state = await setupState([
      { hash: "ccc", project: "_global", lastSeen: "2026-09-06", text: "sentinel row" },
      { hash: "ddd", project: "renamed-away", lastSeen: "2026-09-06", text: "orphan row" },
    ]);
    const model = await buildBoardModel({
      config: { ...config, stateDir: state.stateDir },
      today: "2026-09-09",
    });
    expect(model.blocked.map((b) => b.text).sort()).toEqual(["orphan row", "sentinel row"]);
    await state.cleanup();
    await cleanup();
  });

  test("entries sharing last_seen order deterministically across reopens", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const state = await setupState([
      { hash: "zzz", lastSeen: "2026-09-06", text: "z blocker" },
      { hash: "aaa", lastSeen: "2026-09-06", text: "a blocker" },
      { hash: "mmm", lastSeen: "2026-09-06", text: "m blocker" },
    ]);
    const opts = { config: { ...config, stateDir: state.stateDir }, today: "2026-09-09" };
    const first = await buildBoardModel(opts);
    const second = await buildBoardModel(opts);
    expect(first.blocked.map((b) => b.id)).toEqual(["aaa", "mmm", "zzz"]);
    expect(second.blocked.map((b) => b.id)).toEqual(first.blocked.map((b) => b.id));
    await state.cleanup();
    await cleanup();
  });

  test("building twice from unchanged inputs yields an identical model", async () => {
    const { config, cleanup } = await setup([
      { name: "alpha", roadmap: RECONCILED },
      { name: "beta", roadmap: RECONCILED },
    ]);
    const state = await setupState([{ hash: "eee", lastSeen: "2026-09-06", text: "b" }]);
    const opts = { config: { ...config, stateDir: state.stateDir }, today: "2026-09-09" };
    const a = await buildBoardModel(opts);
    const b = await buildBoardModel(opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    await state.cleanup();
    await cleanup();
  });

  test("an unreadable project marks the model partial", async () => {
    const { config, cleanup } = await setup([
      { name: "alpha", roadmap: null, roadmapIsDir: true },
      { name: "beta", roadmap: RECONCILED },
    ]);
    const state = await setupState([{ hash: "fff", lastSeen: "2026-09-06", text: "b" }]);
    const model = await buildBoardModel({
      config: { ...config, stateDir: state.stateDir },
      today: "2026-09-09",
    });
    expect(model.partial).toBe(true);
    await state.cleanup();
    await cleanup();
  });

  test("a fully readable board is not partial", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const state = await setupState([{ hash: "ggg", lastSeen: "2026-09-06", text: "b" }]);
    const model = await buildBoardModel({
      config: { ...config, stateDir: state.stateDir },
      today: "2026-09-09",
    });
    expect(model.partial).toBe(false);
    await state.cleanup();
    await cleanup();
  });
});

// ─── U2: renderer and guarded write ─────────────────────────────────────────

async function vaultWith(board: string | null): Promise<{ vault: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "janus-kanvas-vault-"));
  const vault = join(dir, "vault");
  await mkdir(join(vault, "Dashboards"), { recursive: true });
  if (board !== null) await writeFile(join(vault, "Dashboards", "Kanvas.md"), board);
  return { vault, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function modelWithCards(): Promise<BoardModel> {
  const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
  const m = await buildBoardModel({ config, today: "2026-09-09" });
  await cleanup();
  return m;
}

function emptyModel(today = "2026-09-09"): BoardModel {
  return {
    today,
    cards: [],
    projects: [],
    blocked: [],
    blockedOutcome: "no-rows-in-window",
    partial: false,
    declined: 0,
  };
}

describe("renderBoard", () => {
  test("rendering twice from an identical model produces identical bytes", async () => {
    const model = await modelWithCards();
    expect(renderBoard(model).markdown).toBe(renderBoard(model).markdown);
  });

  test("emits the canonical dashboard tag as an inline flow array", async () => {
    const model = await modelWithCards();
    expect(renderBoard(model).markdown).toContain("tags: [type/dashboard]");
  });

  test("stamps positive ownership and never emits the review key", async () => {
    const model = await modelWithCards();
    const md = renderBoard(model).markdown;
    expect(md).toContain("managed_by_janus: true");
    expect(md).not.toMatch(/^needs_review:/m);
  });

  test("carries no wiki-links", async () => {
    const model = await modelWithCards();
    expect(renderBoard(model).markdown).not.toContain("[[");
  });

  test("a partial model renders totals as unknown and names the failed input", async () => {
    const model = await modelWithCards();
    model.partial = true;
    model.projects.push({ project: "beta", outcome: "unreadable" });
    const md = renderBoard(model).markdown;
    expect(md.toLowerCase()).toContain("unknown");
    expect(md).toContain("beta");
  });

  test("caps a column and summarizes the remainder instead of dropping it", () => {
    const model = emptyModel();
    for (let i = 0; i < 15; i++) {
      model.cards.push({
        id: `alpha/card-${i}`,
        project: "alpha",
        title: `Card ${i}`,
        column: "now",
        provenance: "reconciled",
      });
    }
    const r = renderBoard(model);
    expect(r.rendered).toBe(12);
    expect(r.summarized).toBe(3);
    expect(r.rendered + r.summarized).toBe(model.cards.length);
    expect(r.markdown).toContain("3 more");
  });

  test("escapes a pipe in a card title so the table survives", () => {
    const model = emptyModel();
    model.cards.push({
      id: "alpha/a-b",
      project: "alpha",
      title: "a | b",
      column: "now",
      provenance: "reconciled",
    });
    expect(renderBoard(model).markdown).toContain("a \\| b");
  });

  test("an unknown blocked lane says so instead of rendering empty", () => {
    const md = renderBoard(emptyModel()).markdown;
    expect(md.toLowerCase()).toContain("unknown");
  });

  test("the freeze hint never appears as a bare frontmatter-shaped line in the body", async () => {
    const model = await modelWithCards();
    const md = renderBoard(model).markdown;
    const body = md.split("\n---\n").slice(1).join("\n---\n");
    expect(body).not.toMatch(/^managed_by_janus:\s*false\s*$/m);
  });
});

describe("writeBoard", () => {
  test("writes the board when none exists, then reports unchanged on a rerun", async () => {
    const model = await modelWithCards();
    const { vault, cleanup } = await vaultWith(null);
    const first = await writeBoard({ model, vaultPath: vault });
    expect(first.outcome).toBe("written");
    const onDisk = await Bun.file(boardPath(vault)).text();
    const second = await writeBoard({ model, vaultPath: vault });
    expect(second.outcome).toBe("unchanged");
    expect(await Bun.file(boardPath(vault)).text()).toBe(onDisk);
    await cleanup();
  });

  test("a degenerate model does not overwrite an existing board", async () => {
    const model = await modelWithCards();
    const { vault, cleanup } = await vaultWith(null);
    await writeBoard({ model, vaultPath: vault });
    const before = await Bun.file(boardPath(vault)).text();
    const result = await writeBoard({ model: emptyModel(), vaultPath: vault });
    expect(result.outcome).toBe("degenerate");
    expect(await Bun.file(boardPath(vault)).text()).toBe(before);
    await cleanup();
  });

  test("allowEmpty lets a degenerate model through", async () => {
    const model = await modelWithCards();
    const { vault, cleanup } = await vaultWith(null);
    await writeBoard({ model, vaultPath: vault });
    const result = await writeBoard({ model: emptyModel(), vaultPath: vault, allowEmpty: true });
    expect(result.outcome).toBe("written");
    await cleanup();
  });

  test("a degenerate model still creates the first board when none exists", async () => {
    const { vault, cleanup } = await vaultWith(null);
    const result = await writeBoard({ model: emptyModel(), vaultPath: vault });
    expect(result.outcome).toBe("written");
    await cleanup();
  });

  test("a file without the ownership key is refused, and allowEmpty does not override it", async () => {
    const mine = "---\ntitle: my own board\n---\n\nhand written\n";
    const { vault, cleanup } = await vaultWith(mine);
    const model = await modelWithCards();
    const result = await writeBoard({ model, vaultPath: vault, allowEmpty: true });
    expect(result.outcome).toBe("not-ours");
    expect(await Bun.file(boardPath(vault)).text()).toBe(mine);
    await cleanup();
  });

  test("a file with no frontmatter at all is refused", async () => {
    const plain = "# my board\n\njust markdown\n";
    const { vault, cleanup } = await vaultWith(plain);
    const model = await modelWithCards();
    const result = await writeBoard({ model, vaultPath: vault });
    expect(result.outcome).toBe("not-ours");
    expect(await Bun.file(boardPath(vault)).text()).toBe(plain);
    await cleanup();
  });

  test("a file whose frontmatter fence never closes is refused", async () => {
    const broken = "---\ntitle: unterminated\n\nbody\n";
    const { vault, cleanup } = await vaultWith(broken);
    const model = await modelWithCards();
    const result = await writeBoard({ model, vaultPath: vault });
    expect(result.outcome).toBe("not-ours");
    expect(await Bun.file(boardPath(vault)).text()).toBe(broken);
    await cleanup();
  });

  test("a frozen board is untouched and the result names the key", async () => {
    const model = await modelWithCards();
    const { vault, cleanup } = await vaultWith(null);
    await writeBoard({ model, vaultPath: vault });
    const written = await Bun.file(boardPath(vault)).text();
    const frozen = written.replace("managed_by_janus: true", "managed_by_janus: false");
    await writeFile(boardPath(vault), frozen);
    const result = await writeBoard({ model, vaultPath: vault });
    expect(result.outcome).toBe("frozen");
    expect(result.detail).toContain("managed_by_janus");
    expect(await Bun.file(boardPath(vault)).text()).toBe(frozen);
    await cleanup();
  });

  test("needs_review false also freezes, and the result names that key instead", async () => {
    const model = await modelWithCards();
    const { vault, cleanup } = await vaultWith(null);
    await writeBoard({ model, vaultPath: vault });
    const written = await Bun.file(boardPath(vault)).text();
    const frozen = written.replace("managed_by_janus: true", "managed_by_janus: true\nneeds_review: false");
    await writeFile(boardPath(vault), frozen);
    const result = await writeBoard({ model, vaultPath: vault });
    expect(result.outcome).toBe("frozen");
    expect(result.detail).toContain("needs_review");
    await cleanup();
  });

  test("a freeze key in body prose does not freeze the board", async () => {
    const model = await modelWithCards();
    const { vault, cleanup } = await vaultWith(null);
    await writeBoard({ model, vaultPath: vault });
    const written = await Bun.file(boardPath(vault)).text();
    await writeFile(boardPath(vault), `${written}\nneeds_review: false\n`);
    const result = await writeBoard({ model, vaultPath: vault });
    expect(result.outcome).toBe("written");
    await cleanup();
  });

  test("the freeze guard fires before the degenerate guard", async () => {
    const model = await modelWithCards();
    const { vault, cleanup } = await vaultWith(null);
    await writeBoard({ model, vaultPath: vault });
    const written = await Bun.file(boardPath(vault)).text();
    await writeFile(boardPath(vault), written.replace("managed_by_janus: true", "managed_by_janus: false"));
    const result = await writeBoard({ model: emptyModel(), vaultPath: vault });
    expect(result.outcome).toBe("frozen");
    await cleanup();
  });

  test("dry-run writes nothing and does not create the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-kanvas-dry-"));
    const vault = join(dir, "vault");
    const model = await modelWithCards();
    const result = await writeBoard({ model, vaultPath: vault, dryRun: true });
    expect(result.outcome).toBe("written");
    expect(existsSync(join(vault, "Dashboards"))).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  test("no temp file survives a successful write", async () => {
    const model = await modelWithCards();
    const { vault, cleanup } = await vaultWith(null);
    await writeBoard({ model, vaultPath: vault });
    const entries = await readdir(join(vault, "Dashboards"));
    expect(entries).toEqual(["Kanvas.md"]);
    await cleanup();
  });

  test("a stale temp file neither breaks the write nor survives it", async () => {
    const model = await modelWithCards();
    const { vault, cleanup } = await vaultWith(null);
    await writeFile(join(vault, "Dashboards", "Kanvas.md.janus.tmp"), "leftover from a crash");
    const result = await writeBoard({ model, vaultPath: vault });
    expect(result.outcome).toBe("written");
    const entries = await readdir(join(vault, "Dashboards"));
    expect(entries).toEqual(["Kanvas.md"]);
    await cleanup();
  });

  test("the temp name matches no markdown glob", () => {
    expect("Kanvas.md.janus.tmp".endsWith(".md")).toBe(false);
  });
});

describe("writeBoard — remaining guards and convergence", () => {
  test("a model where every project is unreachable is refused over an existing board", async () => {
    const model = await modelWithCards();
    const { vault, cleanup } = await vaultWith(null);
    await writeBoard({ model, vaultPath: vault });
    const before = await Bun.file(boardPath(vault)).text();
    const allBroken: BoardModel = {
      ...emptyModel(),
      projects: [
        { project: "alpha", outcome: "unreadable" },
        { project: "beta", outcome: "unreadable" },
      ],
      partial: true,
      blocked: [{ id: "x", text: "still a lane entry", lastSeen: "2026-09-06", weeklyCount: 1 }],
      blockedOutcome: "ok",
    };
    const result = await writeBoard({ model: allBroken, vaultPath: vault });
    expect(result.outcome).toBe("degenerate");
    expect(await Bun.file(boardPath(vault)).text()).toBe(before);
    await cleanup();
  });

  test("most projects unreadable but one contributing still writes, marked partial", async () => {
    const { config, cleanup } = await setup([
      { name: "alpha", roadmap: RECONCILED },
      { name: "beta", roadmap: null, roadmapIsDir: true },
      { name: "gamma", roadmap: null, roadmapIsDir: true },
    ]);
    const model = await buildBoardModel({ config, today: "2026-09-09" });
    const v = await vaultWith(null);
    const result = await writeBoard({ model, vaultPath: v.vault });
    expect(result.outcome).toBe("written");
    const md = await Bun.file(boardPath(v.vault)).text();
    expect(md).toContain("beta");
    expect(md).toContain("gamma");
    expect(md.toLowerCase()).toContain("unknown");
    await v.cleanup();
    await cleanup();
  });

  test("validation refuses output that is not a well-formed board", () => {
    expect(validateBoard("")).toContain("empty");
    expect(validateBoard("# no frontmatter\n")).toContain("frontmatter");
    expect(validateBoard("---\ntype: dashboard\n\nunterminated\n")).toContain("close");
    expect(validateBoard("---\ntype: dashboard\n---\n\ntiny\n")).toContain("too short");
    expect(validateBoard(renderBoard(emptyModel()).markdown)).toBeNull();
  });

  test("the de-fuse pass finds nothing to change, in either order", async () => {
    const model = await modelWithCards();
    const { vault, cleanup } = await vaultWith(null);
    await writeBoard({ model, vaultPath: vault });
    const afterWrite = await Bun.file(boardPath(vault)).text();

    const config: JanusConfig = { obsidianVault: vault, projects: [] };
    const first = await defuseVault({ vaultPath: vault, config });
    // Non-vacuous: the pass must actually have looked at the board.
    expect(first.scanned).toBeGreaterThan(0);
    expect(first.perType.dashboard?.scanned).toBe(1);
    expect(first.changed).toBe(0);
    expect(await Bun.file(boardPath(vault)).text()).toBe(afterWrite);

    const rerun = await writeBoard({ model, vaultPath: vault });
    expect(rerun.outcome).toBe("unchanged");
    await cleanup();
  });

  test("neither de-fuse nor a markdown scan sees the temp file", async () => {
    const model = await modelWithCards();
    const { vault, cleanup } = await vaultWith(null);
    await writeFile(join(vault, "Dashboards", "Kanvas.md.janus.tmp"), "---\ntype: dashboard\n---\n\nleftover\n");
    const config: JanusConfig = { obsidianVault: vault, projects: [] };
    const result = await defuseVault({ vaultPath: vault, config });
    expect(result.scanned).toBe(0);
    await writeBoard({ model, vaultPath: vault });
    await cleanup();
  });
});

describe("findings from review", () => {
  test("the heading Janus itself writes for active milestones lands in Now", () => {
    // `sync-roadmaps.ts` emits `## Hitos activos esta semana`. Testing invented
    // Spanish headings instead of the literal strings Janus writes is how this
    // was missed the first time.
    expect(normalizeColumn("Hitos activos esta semana")).toBe("now");
  });

  test("a fenced code block does not mint phantom cards", async () => {
    const fenced = mirror({
      needsReview: false,
      source: "reconciled-vs-repo",
      body: [
        "## In progress",
        "",
        "- [ ] Real card",
        "",
        "```markdown",
        "## Shipped",
        "- [x] Example from a README, not a card",
        "```",
        "",
      ].join("\n"),
    });
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: fenced }]);
    const result = await collectProjectCards({ config });
    expect(result.cards.map((c) => c.title)).toEqual(["Real card"]);
    await cleanup();
  });

  test("a prose mirror renders as roadmap-present, not as no mirror", async () => {
    const prose = mirror({
      needsReview: false,
      source: "reconciled-vs-repo",
      body: "## Objective\n\nProse and tables, no checkboxes.\n",
    });
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: prose }]);
    const model = await buildBoardModel({ config, today: "2026-09-09" });
    const md = renderBoard(model).markdown;
    expect(md).toContain("Roadmap present, no checkbox work items");
    expect(md).not.toContain("No roadmap mirror yet");
    await cleanup();
  });

  test("validation rejects output that lost its ownership stamp", () => {
    const good = renderBoard(emptyModel()).markdown;
    expect(validateBoard(good)).toBeNull();
    expect(validateBoard(good.replace("managed_by_janus: true", "managed_by_janus: false"))).toContain(
      "managed_by_janus",
    );
    expect(validateBoard(good.replace("# Kanvas", "# Something else"))).toContain("heading");
  });

  test("the not-ours guard fires before the degenerate guard", async () => {
    const mine = "---\ntitle: my own board\n---\n\nhand written, no ownership key\n";
    const { vault, cleanup } = await vaultWith(mine);
    const result = await writeBoard({ model: emptyModel(), vaultPath: vault });
    expect(result.outcome).toBe("not-ours");
    expect(await Bun.file(boardPath(vault)).text()).toBe(mine);
    await cleanup();
  });
});

describe("column cap fairness", () => {
  test("an over-cap column takes from every project, not the first ones in order", () => {
    // Observed live: a newly registered project's cards were invisible because
    // eight older projects filled the column first. Position in a config file
    // must not decide who is visible on a board that claims to show everything.
    const model = emptyModel();
    for (const project of ["alpha", "beta", "gamma"]) {
      for (let i = 0; i < 10; i++) {
        model.cards.push({
          id: `${project}/c${i}`,
          project,
          title: `${project} card ${i}`,
          column: "now",
          provenance: "reconciled",
        });
      }
    }
    const r = renderBoard(model);
    expect(r.rendered).toBe(12);
    expect(r.summarized).toBe(18);
    for (const project of ["alpha", "beta", "gamma"]) {
      expect(r.markdown).toContain(`${project} card 0`);
    }
  });

  test("a column under the cap is untouched and keeps its order", () => {
    const model = emptyModel();
    for (const project of ["alpha", "beta"]) {
      model.cards.push({
        id: `${project}/only`,
        project,
        title: `${project} only`,
        column: "now",
        provenance: "reconciled",
      });
    }
    const r = renderBoard(model);
    expect(r.rendered).toBe(2);
    expect(r.summarized).toBe(0);
    expect(r.markdown.indexOf("alpha only")).toBeLessThan(r.markdown.indexOf("beta only"));
  });

  test("the fair slice is stable across renders", () => {
    const model = emptyModel();
    for (const project of ["alpha", "beta", "gamma", "delta"]) {
      for (let i = 0; i < 5; i++) {
        model.cards.push({
          id: `${project}/c${i}`,
          project,
          title: `${project} ${i}`,
          column: "now",
          provenance: "reconciled",
        });
      }
    }
    expect(renderBoard(model).markdown).toBe(renderBoard(model).markdown);
  });
});

describe("cell labels", () => {
  test("a short title is untouched", () => {
    const model = emptyModel();
    model.cards.push({ id: "alpha/a", project: "alpha", title: "Wire the board route", column: "now", provenance: "reconciled" });
    expect(renderBoard(model).markdown).toContain("Wire the board route — alpha");
  });

  test("a long title is cut at a word boundary with an ellipsis", () => {
    const long = "Confirm which build the impression measured against the give-up fix, then reconcile it with the debt table before touching anything else";
    const model = emptyModel();
    model.cards.push({ id: "alpha/l", project: "alpha", title: long, column: "now", provenance: "reconciled" });
    const md = renderBoard(model).markdown;
    const cell = md.split("\n").find((l) => l.includes("— alpha"))!;
    expect(cell).toContain("…");
    expect(cell.length).toBeLessThan(long.length);
    // The kept prefix must end where a space was in the original — never mid-word.
    const kept = cell.slice(cell.indexOf("|") + 2, cell.indexOf("…"));
    expect(long.startsWith(kept)).toBe(true);
    expect(long[kept.length]).toBe(" ");
  });

  test("truncation never leaves an unbalanced code span or bold run", () => {
    // Cutting inside `code` or **bold** would corrupt every later cell in the row.
    const model = emptyModel();
    model.cards.push({
      id: "alpha/f",
      project: "alpha",
      title: "Update `openapi/v1/openapi.yaml` with **Briefs** and Credentials because the spec has no path or schema for either of them yet",
      column: "now",
      provenance: "reconciled",
    });
    const cell = renderBoard(model).markdown.split("\n").find((l) => l.includes("— alpha"))!;
    expect((cell.match(/`/g) ?? []).length % 2).toBe(0);
    expect(cell).not.toContain("**");
  });

  test("a pipe in a title still cannot break the table", () => {
    const model = emptyModel();
    model.cards.push({ id: "alpha/p", project: "alpha", title: "a | b", column: "now", provenance: "reconciled" });
    expect(renderBoard(model).markdown).toContain("a \\| b");
  });
});

describe("per-project board", () => {
  test("renders only that project and leaves the shared board alone", async () => {
    const { config, cleanup } = await setup([
      { name: "alpha", roadmap: RECONCILED },
      { name: "beta", roadmap: RECONCILED },
    ]);
    const model = await buildBoardModel({ config, today: "2026-09-09" });

    const shared = await writeBoard({ model, vaultPath: config.obsidianVault });
    expect(shared.outcome).toBe("written");
    const sharedBytes = await Bun.file(boardPath(config.obsidianVault)).text();

    const beta = config.projects.find((p) => p.name === "beta")!;
    const scoped = await writeBoard({
      model,
      vaultPath: config.obsidianVault,
      scope: { project: "beta", obsidianPath: beta.obsidianPath },
    });
    expect(scoped.outcome).toBe("written");
    expect(scoped.path).toBe(projectBoardPath(beta.obsidianPath, "beta"));

    const md = await Bun.file(scoped.path).text();
    expect(md).toContain("# Kanvas — beta");
    expect(md).toContain("beta");
    expect(md).not.toContain("— alpha");
    // The cross-project lane has no place on a one-project board.
    expect(md).not.toContain("## Blocked — cross-project");
    // And the shared board is byte-identical.
    expect(await Bun.file(boardPath(config.obsidianVault)).text()).toBe(sharedBytes);
    await cleanup();
  });

  test("a scoped board still refuses a file Janus does not own", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const model = await buildBoardModel({ config, today: "2026-09-09" });
    const alpha = config.projects[0]!;
    const mine = "---\ntitle: mío\n---\n\nhand written\n";
    await writeFile(projectBoardPath(alpha.obsidianPath, "alpha"), mine);
    const r = await writeBoard({
      model,
      vaultPath: config.obsidianVault,
      scope: { project: "alpha", obsidianPath: alpha.obsidianPath },
    });
    expect(r.outcome).toBe("not-ours");
    expect(await Bun.file(r.path).text()).toBe(mine);
    await cleanup();
  });

  test("an identifier with an underscore stays literal in a cell", () => {
    // Stripping the backticks that protected `SIGNUP_URL` turned the underscore
    // into an italics marker that ran to the next one and ate the rest of the row.
    const model = emptyModel();
    model.cards.push({
      id: "alpha/s",
      project: "alpha",
      title: "Revert the `SIGNUP_URL` constant once Free reaches GA",
      column: "now",
      provenance: "inferred",
    });
    const cell = renderBoard(model).markdown.split("\n").find((l) => l.includes("— alpha"))!;
    expect(cell).toContain("SIGNUP\\_URL");
  });
});

describe("scoped board honesty", () => {
  test("cells drop the project suffix when every card is that project", async () => {
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const model = await buildBoardModel({ config, today: "2026-09-09" });
    const alpha = config.projects[0]!;
    const r = await writeBoard({
      model,
      vaultPath: config.obsidianVault,
      scope: { project: "alpha", obsidianPath: alpha.obsidianPath },
    });
    const md = await Bun.file(r.path).text();
    expect(md).toContain("# Kanvas — alpha");
    expect(md).not.toContain("— alpha |");
    await cleanup();
  });

  test("a scoped board does not claim the nightly run rewrites it", async () => {
    // It is written only on an explicit --project run; saying otherwise would
    // have the artifact assert something false about its own lifecycle.
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: RECONCILED }]);
    const model = await buildBoardModel({ config, today: "2026-09-09" });
    const alpha = config.projects[0]!;
    const scoped = await writeBoard({
      model,
      vaultPath: config.obsidianVault,
      scope: { project: "alpha", obsidianPath: alpha.obsidianPath },
    });
    const scopedMd = await Bun.file(scoped.path).text();
    expect(scopedMd).toContain("--project alpha");
    expect(scopedMd).not.toContain("regenerates this file on every run");

    await writeBoard({ model, vaultPath: config.obsidianVault });
    const sharedMd = await Bun.file(boardPath(config.obsidianVault)).text();
    expect(sharedMd).toContain("regenerates this file on every run");
    await cleanup();
  });
});

describe("provenance answers who wrote it", () => {
  test("a mirror of a repo roadmap is authored, even while Janus keeps refreshing it", async () => {
    // `needs_review: true` means "Janus still refreshes this", not "Janus guessed
    // it" — the roadmap sync stamps it on repo mirrors too. Reading that flag
    // alone labelled the user's own repo file as inferred.
    const fromRepo = mirror({
      needsReview: true,
      source: "repo:ROADMAP.md",
      body: "## In progress\n\n- [ ] Written by hand in the repo\n",
    });
    const { config, cleanup } = await setup([{ name: "alpha", roadmap: fromRepo }]);
    const result = await collectProjectCards({ config });
    expect(result.projects[0]?.outcome).toBe("reconciled");
    expect(result.cards[0]?.provenance).toBe("reconciled");
    await cleanup();
  });

  test("a pulse-derived mirror stays inferred until the user claims it", async () => {
    const guessed = (needsReview: boolean) =>
      mirror({ needsReview, source: "pulse-inference", body: "## In progress\n\n- [ ] Guessed\n" });

    const a = await setup([{ name: "alpha", roadmap: guessed(true) }]);
    expect((await collectProjectCards({ config: a.config })).cards[0]?.provenance).toBe("inferred");
    await a.cleanup();

    const b = await setup([{ name: "beta", roadmap: guessed(false) }]);
    expect((await collectProjectCards({ config: b.config })).cards[0]?.provenance).toBe("reconciled");
    await b.cleanup();
  });
});
