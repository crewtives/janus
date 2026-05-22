import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToSlug, summarizeSession } from "../src/core/sessions.ts";

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
});
