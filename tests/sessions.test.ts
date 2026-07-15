import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToSlug, sessionTouchesRange, summarizeSession } from "../src/core/sessions.ts";

// Day bounds are local (`new Date("<date>T00:00:00")`), so fixtures must be built from
// local wall-clock too: a literal "…T02:00:00Z" is the previous day in UTC-3 and would
// make these pass here and fail on a UTC runner.
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00`).toISOString();
const dayStart = (day: string) => new Date(`${day}T00:00:00`);
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999`);

describe("sessions", () => {
  test("pathToSlug converts absolute path to claude slug", () => {
    expect(pathToSlug("/Users/alice/projects/janus")).toBe(
      "-Users-alice-projects-janus",
    );
  });

  test("summarizeSession parses basic jsonl", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-sess-"));
    const file = join(dir, "abc12345-aaaa-bbbb-cccc-dddd00001111.jsonl");
    const lines = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        sessionId: "abc",
        timestamp: "2026-05-20T10:00:00.000Z",
        cwd: "/repo",
        gitBranch: "main",
        version: "2.1.0",
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-05-20T10:00:01.000Z",
        message: { role: "user", content: "hola" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-05-20T10:00:02.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            { type: "text", text: "respuesta" },
            { type: "tool_use", name: "Bash", id: "t1", input: { command: "ls" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-05-20T10:00:03.000Z",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1" }] },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-05-20T10:00:04.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            { type: "tool_use", name: "Edit", id: "t2", input: { file_path: "/repo/foo.ts", old_string: "a", new_string: "b" } },
            { type: "tool_use", name: "Edit", id: "t3", input: { file_path: "/repo/bar.ts", old_string: "x", new_string: "y" } },
          ],
        },
      }),
    ];
    await writeFile(file, lines.join("\n") + "\n");

    const s = await summarizeSession(file);
    expect(s.sessionId).toBe("abc12345-aaaa-bbbb-cccc-dddd00001111");
    expect(s.messageCount).toBe(4); // 2 user + 2 assistant
    expect(s.userCount).toBe(2);
    expect(s.assistantCount).toBe(2);
    expect(s.toolUseCount).toBe(3);
    expect(s.toolsUsed["Bash"]).toBe(1);
    expect(s.toolsUsed["Edit"]).toBe(2);
    expect(s.filesEdited.sort()).toEqual(["/repo/bar.ts", "/repo/foo.ts"]);
    expect(s.bashCommands).toBe(1);
    expect(s.model).toBe("claude-sonnet-4-6");
    expect(s.cwd).toBe("/repo");
    expect(s.gitBranch).toBe("main");
    expect(s.firstTimestamp).toBe("2026-05-20T10:00:00.000Z");
    expect(s.lastTimestamp).toBe("2026-05-20T10:00:04.000Z");
    expect(s.hasSubagents).toBe(false);
    expect(s.userIntent).toBeNull();
    expect(s.decisionSnippets).toEqual([]);
    expect(s.blockerSnippets).toEqual([]);

    await rm(dir, { recursive: true, force: true });
  });

  // Regression: 2026-07-13. `/effort ultracode` as the first message made the scaffolding the
  // userIntent, and its arguments travelled into the pulse prompt.
  test("summarizeSession skips slash-command scaffolding when picking userIntent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-sess-slash-"));
    const file = join(dir, "c0ffee00-1111-2222-3333-444455556666.jsonl");
    const lines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-07-13T09:00:00Z",
        message: {
          role: "user",
          content:
            "<command-name>/effort</command-name>\n            <command-message>effort</command-message>\n            <command-args>ultracode</command-args>",
        },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-07-13T09:00:01Z",
        message: { role: "user", content: "<local-command-stdout>Set effort level to ultracode</local-command-stdout>" },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-07-13T09:00:02Z",
        message: { role: "user", content: "Arreglá el validador de pulses para que no pierda el reporte" },
      }),
    ];
    await writeFile(file, lines.join("\n") + "\n");
    const s = await summarizeSession(file);
    expect(s.userIntent).toBe("Arreglá el validador de pulses para que no pierda el reporte");

    await rm(dir, { recursive: true, force: true });
  });

  test("summarizeSession extracts userIntent, decisionSnippets and blockerSnippets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-sess-mining-"));
    const file = join(dir, "deadbeef-cafe-1234-5678-abcdef012345.jsonl");
    const lines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-05-20T09:00:00Z",
        message: { role: "user", content: "Necesito implementar el parser de sesiones JSONL en el daily pulse" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-05-20T09:00:01Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            {
              type: "text",
              text: "Listo. Implementado el parser usando Bun.file por performance. Decidí mantener la API existente y solo extender SessionSummary con los campos nuevos.",
            },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-05-20T09:05:00Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            {
              type: "text",
              text: "El test de smoke falla con error de timeout al levantar el subprocess de claude. Voy a investigar.",
            },
          ],
        },
      }),
    ];
    await writeFile(file, lines.join("\n") + "\n");
    const s = await summarizeSession(file);
    expect(s.userIntent).toContain("parser de sesiones");
    expect(s.decisionSnippets.length).toBeGreaterThan(0);
    expect(s.decisionSnippets[0]).toMatch(/(Decid|Implementado|Listo)/);
    expect(s.blockerSnippets.length).toBeGreaterThan(0);
    expect(s.blockerSnippets[0]).toMatch(/(error|timeout|falla)/i);
    await rm(dir, { recursive: true, force: true });
  });

  test("summarizeSession ignores invalid lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "janus-sess-bad-"));
    const file = join(dir, "11111111-2222-3333-4444-555566667777.jsonl");
    const content = [
      "esto-no-es-json",
      JSON.stringify({ type: "assistant", timestamp: "2026-05-20T10:00:00Z", message: { content: [] } }),
      "",
      "{broken",
    ].join("\n");
    await writeFile(file, content);
    const s = await summarizeSession(file);
    expect(s.assistantCount).toBe(1);
    expect(s.messageCount).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });

  // Regression: 2026-07-13. Sessions were attributed by file mtime, so a session opened on
  // the 11th and still being appended to on the 13th counted as activity of the 13th only —
  // 821 messages and 5 decision snippets, none of them from the 13th, and the 11th lost it.
  describe("attribution by message timestamp", () => {
    /** Session with work on day 1 and day 2. Returns the .jsonl path. */
    async function twoDayFixture(day1: string, day2: string): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), "janus-sess-attr-"));
      const file = join(dir, "2ecfdfc7-aaaa-bbbb-cccc-000011112222.jsonl");
      const lines = [
        JSON.stringify({ type: "user", timestamp: at(day1, "10:00"), message: { role: "user", content: "Primer dia: arrancar el runner nuevo" } }),
        ...Array.from({ length: 5 }, (_, i) =>
          JSON.stringify({
            type: "assistant",
            timestamp: at(day1, `10:1${i}`),
            message: { model: "claude-x", content: [{ type: "text", text: `Decision ${i} del primer dia: implementado el adapter numero ${i} con su cobertura` }] },
          }),
        ),
        JSON.stringify({
          type: "assistant",
          timestamp: at(day1, "11:00"),
          message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/repo/dia-uno.ts" } }] },
        }),
        JSON.stringify({ type: "assistant", timestamp: at(day1, "11:05"), message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } }),
        JSON.stringify({ type: "user", timestamp: at(day2, "14:00"), message: { role: "user", content: "Segundo dia: arreglar el validador de pulses" } }),
        JSON.stringify({
          type: "assistant",
          timestamp: at(day2, "14:10"),
          message: { content: [{ type: "text", text: "Decision del segundo dia: descartado el prefiltro por birthtime porque la compactacion lo reescribe" }] },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: at(day2, "14:20"),
          message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/repo/dia-dos.ts" } }] },
        }),
      ];
      await writeFile(file, lines.join("\n") + "\n");
      return file;
    }

    test("sessionTouchesRange is true for every day the session has messages on", async () => {
      const file = await twoDayFixture("2026-07-11", "2026-07-13");
      expect(await sessionTouchesRange(file, dayStart("2026-07-11"), dayEnd("2026-07-11"))).toBe(true);
      expect(await sessionTouchesRange(file, dayStart("2026-07-13"), dayEnd("2026-07-13"))).toBe(true);
      await rm(join(file, ".."), { recursive: true, force: true });
    });

    test("sessionTouchesRange is false for a day the session only spans, without messages", async () => {
      const file = await twoDayFixture("2026-07-11", "2026-07-13");
      expect(await sessionTouchesRange(file, dayStart("2026-07-12"), dayEnd("2026-07-12"))).toBe(false);
      await rm(join(file, ".."), { recursive: true, force: true });
    });

    test("summarizeSession without a date still summarizes the whole transcript", async () => {
      const file = await twoDayFixture("2026-07-11", "2026-07-13");
      const s = await summarizeSession(file);
      expect(s.messageCount).toBe(11);
      expect(s.userCount).toBe(2);
      expect(s.filesEdited).toEqual(["/repo/dia-uno.ts", "/repo/dia-dos.ts"]);
      expect(s.bashCommands).toBe(1);
      await rm(join(file, ".."), { recursive: true, force: true });
    });

    test("summarizeSession with a date counts only that day's messages", async () => {
      const file = await twoDayFixture("2026-07-11", "2026-07-13");
      const s = await summarizeSession(file, "2026-07-13");
      expect(s.messageCount).toBe(3);
      expect(s.userCount).toBe(1);
      expect(s.assistantCount).toBe(2);
      expect(s.filesEdited).toEqual(["/repo/dia-dos.ts"]);
      expect(s.bashCommands).toBe(0);
      expect(s.firstTimestamp).toBe(at("2026-07-13", "14:00"));
      await rm(join(file, ".."), { recursive: true, force: true });
    });

    // The caps (5 decisions) used to fill up with day-1 blocks before reaching the target day,
    // so the target day's decisions never surfaced: total starvation, not just dilution.
    test("summarizeSession with a date surfaces that day's decisions instead of filling the cap with older ones", async () => {
      const file = await twoDayFixture("2026-07-11", "2026-07-13");
      const whole = await summarizeSession(file);
      expect(whole.decisionSnippets).toHaveLength(5);
      expect(whole.decisionSnippets.some((d) => d.includes("segundo dia"))).toBe(false);

      const scoped = await summarizeSession(file, "2026-07-13");
      expect(scoped.decisionSnippets).toHaveLength(1);
      expect(scoped.decisionSnippets[0]).toContain("segundo dia");
      await rm(join(file, ".."), { recursive: true, force: true });
    });

    test("summarizeSession with a date takes userIntent from that day, not from the session start", async () => {
      const file = await twoDayFixture("2026-07-11", "2026-07-13");
      expect((await summarizeSession(file)).userIntent).toBe("Primer dia: arrancar el runner nuevo");
      expect((await summarizeSession(file, "2026-07-13")).userIntent).toBe("Segundo dia: arreglar el validador de pulses");
      await rm(join(file, ".."), { recursive: true, force: true });
    });
  });
});
