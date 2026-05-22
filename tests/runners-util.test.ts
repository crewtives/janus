import { describe, expect, test } from "bun:test";
import { cleanEnv, drainToString, safeParse, streamLines } from "../src/runners/util.ts";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(chunks[i]!));
      i++;
    },
  });
}

describe("safeParse", () => {
  test("parses valid JSON", () => {
    expect(safeParse('{"a":1}')).toEqual({ a: 1 });
  });
  test("returns null for invalid JSON", () => {
    expect(safeParse("not json")).toBeNull();
  });
  test("returns null for empty string", () => {
    expect(safeParse("")).toBeNull();
  });
});

describe("streamLines", () => {
  test("splits at newlines across chunk boundaries", async () => {
    const lines: string[] = [];
    const stream = streamFromChunks(["line1\nlin", "e2\nline3\n"]);
    await streamLines(stream, (l) => lines.push(l));
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  test("emits final partial line without trailing newline", async () => {
    const lines: string[] = [];
    const stream = streamFromChunks(["a\nb"]);
    await streamLines(stream, (l) => lines.push(l));
    expect(lines).toEqual(["a", "b"]);
  });

  test("skips empty/whitespace lines", async () => {
    const lines: string[] = [];
    const stream = streamFromChunks(["a\n\n   \nb\n"]);
    await streamLines(stream, (l) => lines.push(l));
    expect(lines).toEqual(["a", "b"]);
  });
});

describe("drainToString", () => {
  test("concatenates all chunks", async () => {
    const stream = streamFromChunks(["hello ", "world", "!"]);
    expect(await drainToString(stream)).toBe("hello world!");
  });

  test("handles empty stream", async () => {
    const stream = streamFromChunks([]);
    expect(await drainToString(stream)).toBe("");
  });
});

describe("cleanEnv", () => {
  test("drops undefined values", () => {
    const env = { A: "1", B: undefined } as unknown as NodeJS.ProcessEnv;
    // enrichPath=false porque por default agrega PATH
    expect(cleanEnv(env, [], { enrichPath: false })).toEqual({ A: "1" });
  });

  test("drops keys listed in deleteKeys", () => {
    const env = { A: "1", ANTHROPIC_API_KEY: "secret" } as NodeJS.ProcessEnv;
    expect(cleanEnv(env, ["ANTHROPIC_API_KEY"], { enrichPath: false })).toEqual({ A: "1" });
  });

  test("preserves other keys", () => {
    const env = { PATH: "/usr/bin", HOME: "/root" } as NodeJS.ProcessEnv;
    expect(cleanEnv(env, ["ANTHROPIC_API_KEY"], { enrichPath: false })).toEqual({
      PATH: "/usr/bin",
      HOME: "/root",
    });
  });

  test("enriches PATH with standard dirs by default (fix launchd minimal PATH)", () => {
    const env = { PATH: "/usr/bin:/bin", HOME: "/Users/test" } as NodeJS.ProcessEnv;
    const out = cleanEnv(env);
    // Original PATH al frente, preservado
    expect(out.PATH).toMatch(/^\/usr\/bin:\/bin/);
    // Common dirs agregados
    expect(out.PATH).toContain("/opt/homebrew/bin");
    expect(out.PATH).toContain("/usr/local/bin");
    expect(out.PATH).toContain("/Users/test/.local/bin");
    expect(out.PATH).toContain("/Users/test/.bun/bin");
  });

  test("enrich is additive — does not duplicate already-present dirs", () => {
    const env = {
      PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin",
      HOME: "/Users/test",
    } as NodeJS.ProcessEnv;
    const out = cleanEnv(env);
    const homebrewCount = out.PATH!.split(":").filter((p) => p === "/opt/homebrew/bin").length;
    expect(homebrewCount).toBe(1);
  });

  test("enrich without HOME still adds system dirs", () => {
    const env = { PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    const out = cleanEnv(env);
    expect(out.PATH).toContain("/opt/homebrew/bin");
    expect(out.PATH).toContain("/usr/local/bin");
    expect(out.PATH).not.toContain("/.bun/bin"); // no $HOME, no se agrega
  });

  test("enrichPath: false disables it completely", () => {
    const env = { PATH: "/usr/bin", HOME: "/Users/test" } as NodeJS.ProcessEnv;
    const out = cleanEnv(env, [], { enrichPath: false });
    expect(out.PATH).toBe("/usr/bin");
  });
});
