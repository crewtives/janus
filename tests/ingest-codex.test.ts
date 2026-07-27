import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectConfig } from "../src/config/types.ts";
import { findCodexSessionsForDate, summarizeCodexSession } from "../src/ingest/codex.ts";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function writeSession(name: string, records: unknown[]): Promise<string> {
  const dir = join(root, "sessions", "2026", "07", "27");
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return path;
}

function record(timestamp: string, type: string, payload: Record<string, unknown>): unknown {
  return { timestamp, type, payload };
}

describe("Codex transcript ingestion", () => {
  test("normalizes visible messages, tools, edits, metadata, and source without duplicates", async () => {
    root = await mkdtemp(join(tmpdir(), "janus-ingest-codex-"));
    const path = await writeSession("rollout-00000000-0000-0000-0000-000000000001.jsonl", [
      record("2026-07-27T09:00:00Z", "session_meta", {
        id: "session-neutral",
        cwd: "/tmp/alpha",
        git: { branch: "feat/alpha" },
        source: "cli",
      }),
      record("2026-07-27T09:00:01Z", "turn_context", { model: "gpt-test", cwd: "/tmp/alpha" }),
      record("2026-07-27T09:01:00Z", "response_item", {
        type: "message",
        role: "developer",
        content: "Injected memory must be ignored",
      }),
      record("2026-07-27T09:02:00Z", "event_msg", {
        type: "user_message",
        message: "Implement the neutral parser safely.",
      }),
      record("2026-07-27T09:03:00Z", "response_item", {
        type: "function_call",
        name: "exec_command",
        call_id: "call-1",
      }),
      record("2026-07-27T09:04:00Z", "response_item", {
        type: "custom_tool_call",
        name: "apply_patch",
        call_id: "call-2",
      }),
      record("2026-07-27T09:05:00Z", "event_msg", {
        type: "patch_apply_end",
        call_id: "call-2",
        changes: { "src/alpha.ts": { type: "update", move_path: "src/beta.ts" } },
      }),
      record("2026-07-27T09:06:00Z", "event_msg", {
        type: "agent_message",
        message: "Implemented the parser and resolved the timeout blocker.",
      }),
      record("2026-07-27T09:07:00Z", "event_msg", { type: "sub_agent_activity" }),
    ]);
    const summary = await summarizeCodexSession(path, "2026-07-27");
    expect(summary).toMatchObject({
      source: "codex",
      cwd: "/tmp/alpha",
      gitBranch: "feat/alpha",
      model: "gpt-test",
      userCount: 1,
      assistantCount: 1,
      messageCount: 2,
      toolUseCount: 2,
      bashCommands: 1,
      hasSubagents: true,
      userIntent: "Implement the neutral parser safely.",
    });
    expect(summary.toolsUsed).toEqual({ exec_command: 1, apply_patch: 1 });
    expect(summary.filesEdited).toEqual(["src/alpha.ts", "src/beta.ts"]);
    expect(summary.decisionSnippets[0]).toContain("Implemented");
    expect(summary.blockerSnippets[0]).toContain("blocker");
  });

  test("discovers only the requested tracked project and excludes subagent rollouts", async () => {
    root = await mkdtemp(join(tmpdir(), "janus-ingest-codex-"));
    const repo = join(root, "alpha");
    const sibling = join(root, "alpha-old");
    await mkdir(repo, { recursive: true });
    await mkdir(sibling, { recursive: true });
    await writeSession("root.jsonl", [
      record("2026-07-27T09:00:00Z", "session_meta", { cwd: repo, source: "cli" }),
      record("2026-07-27T09:01:00Z", "event_msg", { type: "user_message", message: "Root work" }),
    ]);
    await writeSession("sibling.jsonl", [
      record("2026-07-27T09:00:00Z", "session_meta", { cwd: sibling, source: "cli" }),
      record("2026-07-27T09:01:00Z", "event_msg", { type: "user_message", message: "Sibling work" }),
    ]);
    await writeSession("child.jsonl", [
      record("2026-07-27T09:00:00Z", "session_meta", { cwd: repo, source: { subagent: "worker" } }),
      record("2026-07-27T09:01:00Z", "event_msg", { type: "user_message", message: "Forked history" }),
    ]);
    const project: ProjectConfig = { name: "alpha", repoPath: repo, obsidianPath: join(root, "vault") };
    const found = await findCodexSessionsForDate({
      project,
      projects: [project],
      date: "2026-07-27",
      codexHome: root,
    });
    expect(found.map((item) => item.path.split("/").at(-1))).toEqual(["root.jsonl"]);
  });

  test("scopes every activity field to the requested date", async () => {
    root = await mkdtemp(join(tmpdir(), "janus-ingest-codex-"));
    const path = await writeSession("cross-midnight.jsonl", [
      record("2026-07-26T23:59:00Z", "session_meta", { cwd: "/tmp/alpha", source: "cli" }),
      record("2026-07-26T23:59:30Z", "event_msg", { type: "user_message", message: "Previous day intent" }),
      record("2026-07-27T00:01:00Z", "event_msg", { type: "user_message", message: "Current day intent" }),
      record("2026-07-27T00:02:00Z", "event_msg", { type: "agent_message", message: "Completed current work." }),
    ]);
    const summary = await summarizeCodexSession(path, "2026-07-27");
    expect(summary.userCount).toBe(1);
    expect(summary.userIntent).toBe("Current day intent");
    expect(summary.firstTimestamp).toBe("2026-07-27T00:01:00Z");
  });
});
