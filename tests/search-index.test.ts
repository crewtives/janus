import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SearchIndex, sanitizeQuery, scanVault } from "../src/core/search-index.ts";

async function makeVault(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "janus-scan-"));
}

async function write(vault: string, rel: string, content: string): Promise<void> {
  const abs = join(vault, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

/** Runs `fn` with console.warn captured, so the assertions can read what scanVault reported. */
async function captureWarns<T>(fn: () => Promise<T>): Promise<{ result: T; warns: string[] }> {
  const original = console.warn;
  const warns: string[] = [];
  console.warn = (...a: unknown[]) => { warns.push(a.join(" ")); };
  try {
    return { result: await fn(), warns };
  } finally {
    console.warn = original;
  }
}

describe("SearchIndex", () => {
  test("upsert + search returns matches with snippet", () => {
    const idx = SearchIndex.openInMemory();
    idx.upsert({
      docId: "Projects/foo/pulse/2026-05-19--foo.md",
      project: "foo",
      date: "2026-05-19",
      kind: "pulse",
      status: "on-track",
      title: "Daily Pulse foo 2026-05-19",
      body: "Shipped: Globex Checkout Moderno con OAuth + RSA-SHA256. Cliente moderno POST /v1/payments.",
    });
    idx.upsert({
      docId: "Projects/bar/pulse/2026-05-18--bar.md",
      project: "bar",
      date: "2026-05-18",
      kind: "pulse",
      status: "idle",
      title: "Daily Pulse bar 2026-05-18",
      body: "Día sin actividad",
    });

    const hits = idx.search({ query: "Globex OAuth" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.project).toBe("foo");
    expect(hits[0]!.snippet).toContain("**Globex**");
    expect(hits[0]!.snippet).toContain("**OAuth**");
    idx.close();
  });

  test("project/kind/since/until filters", () => {
    const idx = SearchIndex.openInMemory();
    idx.upsert({ docId: "a.md", project: "alpha", date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "queryterm" });
    idx.upsert({ docId: "b.md", project: "beta", date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "queryterm" });
    idx.upsert({ docId: "c.md", project: "alpha", date: "2026-04-01", kind: "weekly", status: null, title: "T", body: "queryterm" });

    expect(idx.search({ query: "queryterm" }).length).toBe(3);
    expect(idx.search({ query: "queryterm", project: "alpha" }).length).toBe(2);
    expect(idx.search({ query: "queryterm", kind: "weekly" }).length).toBe(1);
    expect(idx.search({ query: "queryterm", since: "2026-05-01" }).length).toBe(2);
    expect(idx.search({ query: "queryterm", until: "2026-04-30" }).length).toBe(1);
    expect(idx.search({ query: "queryterm", project: "alpha", since: "2026-05-01" }).length).toBe(1);
    idx.close();
  });

  test("upsert idempotent (same docId replaces)", () => {
    const idx = SearchIndex.openInMemory();
    idx.upsert({ docId: "x.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "v1", body: "alpha" });
    idx.upsert({ docId: "x.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "v2", body: "beta" });
    expect(idx.search({ query: "alpha" }).length).toBe(0);
    expect(idx.search({ query: "beta" })[0]!.title).toBe("v2");
    idx.close();
  });

  test("remove deletes from the index", () => {
    const idx = SearchIndex.openInMemory();
    idx.upsert({ docId: "x.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "term" });
    expect(idx.search({ query: "term" }).length).toBe(1);
    idx.remove("x.md");
    expect(idx.search({ query: "term" }).length).toBe(0);
    idx.close();
  });

  test("empty query returns []", () => {
    const idx = SearchIndex.openInMemory();
    idx.upsert({ docId: "x.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "term" });
    expect(idx.search({ query: "" }).length).toBe(0);
    idx.close();
  });

  test("quoted phrases work", () => {
    const idx = SearchIndex.openInMemory();
    idx.upsert({ docId: "x.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "checkout moderno con OAuth" });
    idx.upsert({ docId: "y.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "checkout sin moderno" });
    const hits = idx.search({ query: '"checkout moderno"' });
    expect(hits.length).toBe(1);
    expect(hits[0]!.docId).toBe("x.md");
    idx.close();
  });

  test("stats returns count by kind", () => {
    const idx = SearchIndex.openInMemory();
    idx.upsert({ docId: "a.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "x" });
    idx.upsert({ docId: "b.md", project: null, date: "2026-05-19", kind: "weekly", status: null, title: "T", body: "x" });
    idx.upsert({ docId: "c.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "x" });
    const s = idx.stats();
    expect(s.pulse).toBe(2);
    expect(s.weekly).toBe(1);
    expect(s.monthly).toBe(0);
    idx.close();
  });
});

describe("SearchIndex.reconcile", () => {
  test("removes docs absent from the scan, keeps the rest", () => {
    const idx = SearchIndex.openInMemory();
    idx.upsert({ docId: "keep.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "term" });
    idx.upsert({ docId: "gone.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "term" });

    const removed = idx.reconcile(new Set(["keep.md"]));

    expect(removed).toEqual(["gone.md"]);
    expect(idx.search({ query: "term" }).map((h) => h.docId)).toEqual(["keep.md"]);
    idx.close();
  });

  test("a moved doc leaves no dangling citation at its old path", () => {
    // The regression: the monthly moves a pulse into _archive/ and, because docId is the
    // vault-relative path, the old path stayed indexed and `ask` kept citing a dead file.
    const idx = SearchIndex.openInMemory();
    const body = "unique-marker";
    idx.upsert({ docId: "Projects/p/pulse/2026-05-19-p.md", project: "p", date: "2026-05-19", kind: "pulse", status: null, title: "T", body });
    idx.upsert({ docId: "Projects/p/_archive/2026-05/2026-05-19-p.md", project: "p", date: "2026-05-19", kind: "pulse", status: null, title: "T", body });
    expect(idx.search({ query: body }).length).toBe(2);

    idx.reconcile(new Set(["Projects/p/_archive/2026-05/2026-05-19-p.md"]));

    const hits = idx.search({ query: body });
    expect(hits.length).toBe(1);
    expect(hits[0]!.docId).toBe("Projects/p/_archive/2026-05/2026-05-19-p.md");
    idx.close();
  });

  test("reconcile is a no-op when the scan saw everything", () => {
    const idx = SearchIndex.openInMemory();
    idx.upsert({ docId: "a.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "term" });
    idx.upsert({ docId: "b.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "term" });
    expect(idx.reconcile(new Set(["a.md", "b.md"]))).toEqual([]);
    expect(idx.search({ query: "term" }).length).toBe(2);
    idx.close();
  });

  test("an empty scan set empties the index — callers must guard", () => {
    // Pins the sharp edge the command relies on: reconcile is a primitive with no opinion
    // about whether the scan was trustworthy. src/commands/index.ts skips the call on an
    // empty scan and on --skip-archive precisely because of this.
    const idx = SearchIndex.openInMemory();
    idx.upsert({ docId: "a.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "term" });
    expect(idx.reconcile(new Set()).length).toBe(1);
    expect(idx.search({ query: "term" }).length).toBe(0);
    idx.close();
  });
});

describe("sanitizeQuery", () => {
  test("unbalanced quotes are dropped instead of reaching FTS5", () => {
    expect(sanitizeQuery('foo "bar')).toBe("foo bar");
    expect(sanitizeQuery('"')).toBe("");
    expect(sanitizeQuery('"a" "b')).toBe("a b");
  });

  test("balanced quotes survive as a phrase", () => {
    expect(sanitizeQuery('"checkout moderno"')).toBe('"checkout moderno"');
  });

  test("an unterminated phrase searches instead of throwing", () => {
    const idx = SearchIndex.openInMemory();
    idx.upsert({ docId: "x.md", project: null, date: "2026-05-19", kind: "pulse", status: null, title: "T", body: "checkout moderno con OAuth" });
    expect(() => idx.search({ query: 'checkout "moderno' })).not.toThrow();
    expect(idx.search({ query: 'checkout "moderno' }).length).toBe(1);
    idx.close();
  });
});

describe("scanVault", () => {
  test("indexes Timeline dailies, weeklies, monthlies, quarterlies and yearlies", async () => {
    // The regression: scanVault read `Daily/`, `Daily/Weekly`, … but every writer emits
    // under `Timeline/`, so all five kinds indexed as zero and `ask --kind daily` could
    // never return anything.
    const vault = await makeVault();
    await write(vault, "Timeline/Daily/2026-07-13.md", "# Daily 2026-07-13\n\nmarker-daily");
    await write(vault, "Timeline/Weekly/2026-07-12-week.md", "# Week\n\nmarker-weekly");
    await write(vault, "Timeline/Monthly/2026-07-monthly.md", "# Month\n\nmarker-monthly");
    await write(vault, "Timeline/Quarterly/2026-Q3.md", "# Quarter\n\nmarker-quarterly");
    await write(vault, "Timeline/Yearly/2026-yearly.md", "# Year\n\nmarker-yearly");

    const { result: docs } = await captureWarns(() => scanVault({ vaultPath: vault }));

    const byKind = new Map(docs.map((d) => [d.kind, d]));
    expect(byKind.get("daily")?.docId).toBe("Timeline/Daily/2026-07-13.md");
    expect(byKind.get("daily")?.date).toBe("2026-07-13");
    expect(byKind.get("weekly")?.docId).toBe("Timeline/Weekly/2026-07-12-week.md");
    expect(byKind.get("monthly")?.docId).toBe("Timeline/Monthly/2026-07-monthly.md");
    expect(byKind.get("quarterly")?.docId).toBe("Timeline/Quarterly/2026-Q3.md");
    expect(byKind.get("yearly")?.docId).toBe("Timeline/Yearly/2026-yearly.md");
    await rm(vault, { recursive: true, force: true });
  });

  test("--kind daily is reachable end to end", async () => {
    const vault = await makeVault();
    await write(vault, "Timeline/Daily/2026-07-13.md", "# Daily\n\nuniquemarker across projects");

    const idx = SearchIndex.openInMemory();
    const { result: docs } = await captureWarns(() => scanVault({ vaultPath: vault }));
    for (const d of docs) idx.upsert(d);

    const hits = idx.search({ query: "uniquemarker", kind: "daily" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.docId).toBe("Timeline/Daily/2026-07-13.md");
    idx.close();
    await rm(vault, { recursive: true, force: true });
  });

  test("indexes pulses, archive, hubs, spines and tracks", async () => {
    const vault = await makeVault();
    // Archived pulses keep their `project:` frontmatter, which is what attributes them —
    // the path-based fallback only matches the live `pulse/` layout.
    await write(vault, "Projects/acme/app/pulse/2026-07-13-acme-app.md", "---\ndate: 2026-07-13\nproject: acme-app\n---\n# Pulse\n\nmarker");
    await write(vault, "Projects/acme/app/_archive/2026-06/2026-06-30-acme-app.md", "---\ndate: 2026-06-30\nproject: acme-app\n---\n# Old pulse\n\nmarker");
    await write(vault, "Projects/acme/app/_index.md", "---\ndate: 2026-07-13\n---\n# Index\n\nmarker");
    await write(vault, "Projects/acme/app/acme-app-spine.md", "---\ndate: 2026-07-13\n---\n# Spine\n\nmarker");
    await write(vault, "MOCs/Tracks/some-track.md", "---\ndate: 2026-07-13\n---\n# Track\n\nmarker");

    const { result: docs } = await captureWarns(() => scanVault({ vaultPath: vault }));

    const kinds = docs.map((d) => d.kind).sort();
    expect(kinds).toEqual(["index", "pulse", "pulse", "spine", "track"]);
    expect(docs.find((d) => d.kind === "pulse" && d.docId.includes("_archive"))?.project).toBe("acme-app");
    await rm(vault, { recursive: true, force: true });
  });

  test("skip-archive excludes _archive", async () => {
    const vault = await makeVault();
    await write(vault, "Projects/acme/app/pulse/2026-07-13-acme-app.md", "# Pulse\n\nmarker");
    await write(vault, "Projects/acme/app/_archive/2026-06/2026-06-30-acme-app.md", "# Old\n\nmarker");

    const { result: docs } = await captureWarns(() => scanVault({ vaultPath: vault, includeArchive: false }));

    expect(docs.map((d) => d.docId)).toEqual(["Projects/acme/app/pulse/2026-07-13-acme-app.md"]);
    await rm(vault, { recursive: true, force: true });
  });

  test("warns about expected directories that do not exist", async () => {
    const vault = await makeVault();
    await write(vault, "Timeline/Daily/2026-07-13.md", "# Daily\n\nmarker");

    const { warns } = await captureWarns(() => scanVault({ vaultPath: vault }));

    expect(warns.length).toBe(1);
    // The silent skip is what let the Daily/ vs Timeline/Daily/ mismatch survive: an absent
    // directory has to be distinguishable from an empty one.
    expect(warns[0]).toContain("Projects");
    expect(warns[0]).toContain("Timeline/Weekly");
    expect(warns[0]).not.toContain("Timeline/Daily");
    await rm(vault, { recursive: true, force: true });
  });

  test("a fully populated vault warns about nothing", async () => {
    const vault = await makeVault();
    await write(vault, "Projects/acme/app/pulse/2026-07-13-acme-app.md", "# Pulse\n\nmarker");
    for (const rel of ["Timeline/Daily", "Timeline/Weekly", "Timeline/Monthly", "Timeline/Quarterly", "Timeline/Yearly", "MOCs/Tracks", "Decisions"]) {
      await mkdir(join(vault, rel), { recursive: true });
    }

    const { warns } = await captureWarns(() => scanVault({ vaultPath: vault }));

    expect(warns).toEqual([]);
    await rm(vault, { recursive: true, force: true });
  });

  test("ADRs are read from Decisions/, matching adr.ts", async () => {
    const vault = await makeVault();
    await write(vault, "Decisions/ADR-001-use-fts5.md", "---\ndate: 2026-07-13\n---\n# ADR-001\n\nmarker");

    const { result: docs } = await captureWarns(() => scanVault({ vaultPath: vault }));

    expect(docs.filter((d) => d.kind === "adr").map((d) => d.docId)).toEqual(["Decisions/ADR-001-use-fts5.md"]);
    await rm(vault, { recursive: true, force: true });
  });
});
