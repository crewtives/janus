import { describe, expect, test } from "bun:test";
import { SearchIndex } from "../src/core/search-index.ts";

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
