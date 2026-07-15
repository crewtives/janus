import { afterEach, describe, expect, test } from "bun:test";
import { notifyDiscord, type ProjectResult } from "../src/core/discord.ts";

const WEBHOOK = "https://discord.com/api/webhooks/1/token";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Captured {
  content?: string;
  embeds: Array<{ title: string; description: string; color: number; footer: { text: string } }>;
}

/** Replaces fetch and collects the parsed bodies. `impl` decides the response. */
function captureFetch(impl?: () => Promise<Response>): Captured[] {
  const bodies: Captured[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string) as Captured);
    return impl ? await impl() : new Response("", { status: 204 });
  }) as unknown as typeof fetch;
  return bodies;
}

function ok(project: string, date = "2026-07-13"): ProjectResult {
  return { project, date, status: "ok", contentPreview: `---\nx\n---\n### 1. TL;DR\n\n${project} shipped.\n` };
}

function failed(project: string, date = "2026-07-13"): ProjectResult {
  return { project, date, status: "failed", error: "validatePulse: report must start with ---" };
}

describe("notifyDiscord — header tally", () => {
  test("counts only successes as analyzed and names what failed", async () => {
    const bodies = captureFetch();
    const results = [...["a", "b", "c", "d", "e", "f", "g"].map((p) => ok(p)), failed("acme-gamma")];

    await notifyDiscord({ webhookUrl: WEBHOOK }, results, ["2026-07-13"]);

    const content = bodies[0]!.content!;
    // The bug: `8 projects analyzed` while daily.ts reported 7 off the same array.
    expect(content).toContain("7 projects analyzed");
    expect(content).toContain("1 failed: acme-gamma");
    expect(content).not.toContain("8 projects analyzed");
  });

  test("says nothing about failures when there are none", async () => {
    const bodies = captureFetch();

    await notifyDiscord({ webhookUrl: WEBHOOK }, [ok("a"), ok("b")], ["2026-07-13"]);

    expect(bodies[0]!.content).toContain("2 projects analyzed");
    expect(bodies[0]!.content).not.toContain("failed");
  });

  test("a failure is visible in the header, not only inside the embed", async () => {
    const bodies = captureFetch();

    await notifyDiscord({ webhookUrl: WEBHOOK }, [failed("acme-gamma")], ["2026-07-13"]);

    expect(bodies[0]!.content).toContain("0 projects analyzed");
    expect(bodies[0]!.content).toContain("1 failed: acme-gamma");
  });

  test("names every failure, and counts dry-runs apart from successes", async () => {
    const bodies = captureFetch();
    const results: ProjectResult[] = [
      ok("a"),
      failed("b"),
      failed("c"),
      { project: "d", date: "2026-07-13", status: "dry-run" },
    ];

    await notifyDiscord({ webhookUrl: WEBHOOK }, results, ["2026-07-13"]);

    const content = bodies[0]!.content!;
    expect(content).toContain("1 projects analyzed");
    expect(content).toContain("1 dry-run");
    expect(content).toContain("2 failed: b, c");
  });

  test("consolidation keeps the most recent date per project, tally follows it", async () => {
    const bodies = captureFetch();
    const results = [ok("a", "2026-07-12"), failed("a", "2026-07-13")];

    await notifyDiscord({ webhookUrl: WEBHOOK }, results, ["2026-07-12", "2026-07-13"]);

    // One project, latest state is failed — it must not also count as analyzed.
    expect(bodies[0]!.content).toContain("0 projects analyzed");
    expect(bodies[0]!.content).toContain("1 failed: a");
  });

  test("only the first batch carries the header", async () => {
    const bodies = captureFetch();
    const results = Array.from({ length: 12 }, (_, i) => ok(`p${String(i).padStart(2, "0")}`));

    await notifyDiscord({ webhookUrl: WEBHOOK }, results, ["2026-07-13"]);

    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.content).toContain("12 projects analyzed");
    expect(bodies[1]!.content).toBeUndefined();
    expect(bodies[1]!.embeds).toHaveLength(2);
  });
});

describe("notifyDiscord — an unreachable webhook must not fail the run", () => {
  test("a network rejection is swallowed, not thrown to the caller", async () => {
    captureFetch(() => Promise.reject(new Error("getaddrinfo ENOTFOUND discord.com")));

    // The notification is the last step of a run that already wrote its pulses.
    await expect(notifyDiscord({ webhookUrl: WEBHOOK }, [ok("a")], ["2026-07-13"])).resolves.toBeUndefined();
  });

  test("keeps posting the remaining batches after one request rejects", async () => {
    let calls = 0;
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      calls += 1;
      if (calls === 1) throw new Error("connection refused");
      return new Response("", { status: 204 });
    }) as unknown as typeof fetch;

    const results = Array.from({ length: 12 }, (_, i) => ok(`p${String(i).padStart(2, "0")}`));
    await notifyDiscord({ webhookUrl: WEBHOOK }, results, ["2026-07-13"]);

    expect(calls).toBe(2);
  });

  test("an HTTP error response is still just logged", async () => {
    captureFetch(async () => new Response("rate limited", { status: 429 }));

    await expect(notifyDiscord({ webhookUrl: WEBHOOK }, [ok("a")], ["2026-07-13"])).resolves.toBeUndefined();
  });

  test("no webhook configured means no request at all", async () => {
    const bodies = captureFetch();

    await notifyDiscord({}, [ok("a")], ["2026-07-13"]);

    expect(bodies).toHaveLength(0);
  });
});
