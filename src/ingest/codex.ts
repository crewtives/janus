import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectConfig } from "../config/types.ts";
import { resolveCodexHome } from "../core/codex-cli.ts";
import { createTrackedProjectMatcher } from "../core/project-context.ts";
import { normalizeWhitespace } from "../core/sessions.ts";
import type { SessionSummary, SessionTranscript } from "./types.ts";

interface CodexRecord {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

const DECISION = /\b(decidido|decid[íi]|elegido|descartado|implementado|completed|conclusion|decision|fixed|resolved|shipped|merged)\b/i;
const BLOCKER = /\b(failed|error|broken|stuck|blocker|blocked|cannot|crash|timeout|rejected)\b/i;

export function defaultCodexHome(): string {
  return resolveCodexHome();
}

async function listJsonl(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const output: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await listJsonl(path));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.push(path);
  }
  return output;
}

function parseRecords(text: string): CodexRecord[] {
  const records: CodexRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as CodexRecord);
    } catch {
      // A partially-written or future record must not discard the session.
    }
  }
  return records;
}

function meta(records: CodexRecord[]): Record<string, unknown> | undefined {
  return records.find((record) => record.type === "session_meta")?.payload;
}

function isSubagent(records: CodexRecord[]): boolean {
  const metadata = meta(records);
  const source = metadata?.source;
  return (typeof metadata?.parent_thread_id === "string")
    || (!!source && typeof source === "object" && "subagent" in source);
}

function meaningful(record: CodexRecord): boolean {
  if (record.type === "event_msg") {
    return ["user_message", "agent_message", "sub_agent_activity", "patch_apply_end", "web_search_end"]
      .includes(String(record.payload?.type ?? ""));
  }
  if (record.type === "response_item") {
    return ["function_call", "custom_tool_call"].includes(String(record.payload?.type ?? ""));
  }
  return false;
}

function inRange(timestamp: string | undefined, start: number, end: number): boolean {
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  return !Number.isNaN(time) && time >= start && time <= end;
}

export async function findCodexSessionsForDate(opts: {
  project: ProjectConfig;
  projects: ProjectConfig[];
  date: string;
  codexHome?: string;
}): Promise<SessionTranscript[]> {
  const start = new Date(`${opts.date}T00:00:00`).getTime();
  const end = new Date(`${opts.date}T23:59:59.999`).getTime();
  const files = await listJsonl(join(opts.codexHome ?? defaultCodexHome(), "sessions"));
  const matchProject = await createTrackedProjectMatcher(opts.projects);
  const matches: SessionTranscript[] = [];
  for (const path of files) {
    try {
      if ((await stat(path)).mtime.getTime() < start) continue;
      const records = parseRecords(await Bun.file(path).text());
      if (isSubagent(records)) continue;
      const cwd = meta(records)?.cwd;
      if (typeof cwd !== "string") continue;
      const matched = await matchProject(cwd);
      if (matched?.name !== opts.project.name) continue;
      if (!records.some((record) => meaningful(record) && inRange(record.timestamp, start, end))) continue;
      matches.push({ source: "codex", path });
    } catch {
      // Session can disappear while Codex rotates it.
    }
  }
  return matches.sort((a, b) => a.path.localeCompare(b.path));
}

function pushSnippet(text: string, target: string[], max: number, length: number): void {
  const value = normalizeWhitespace(text);
  if (value.length < 20 || target.length >= max) return;
  const clipped = value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;
  if (!target.some((existing) => existing.slice(0, 80).toLowerCase() === clipped.slice(0, 80).toLowerCase())) {
    target.push(clipped);
  }
}

export async function summarizeCodexSession(path: string, date?: string): Promise<SessionSummary> {
  const records = parseRecords(await Bun.file(path).text());
  const metadata = meta(records);
  const summary: SessionSummary = {
    source: "codex",
    sessionId: String(metadata?.session_id ?? metadata?.id ?? path.match(/([0-9a-f-]{36})\.jsonl$/i)?.[1] ?? "unknown"),
    path,
    firstTimestamp: null,
    lastTimestamp: null,
    messageCount: 0,
    assistantCount: 0,
    userCount: 0,
    toolUseCount: 0,
    toolsUsed: {},
    filesEdited: [],
    bashCommands: 0,
    model: null,
    cwd: typeof metadata?.cwd === "string" ? metadata.cwd : null,
    gitBranch: null,
    hasSubagents: false,
    userIntent: null,
    decisionSnippets: [],
    blockerSnippets: [],
  };
  const git = metadata?.git;
  if (git && typeof git === "object" && typeof (git as { branch?: unknown }).branch === "string") {
    summary.gitBranch = (git as { branch: string }).branch;
  }
  const start = date ? new Date(`${date}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const end = date ? new Date(`${date}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
  const files = new Set<string>();
  const calls = new Set<string>();

  for (const record of records) {
    if (date && !inRange(record.timestamp, start, end)) continue;
    const payload = record.payload ?? {};
    if (record.timestamp && meaningful(record)) {
      summary.firstTimestamp ??= record.timestamp;
      summary.lastTimestamp = record.timestamp;
    }
    if (record.type === "turn_context") {
      if (!summary.model && typeof payload.model === "string") summary.model = payload.model;
      if (!summary.cwd && typeof payload.cwd === "string") summary.cwd = payload.cwd;
    }
    if (record.type === "event_msg") {
      const kind = String(payload.type ?? "");
      const message = typeof payload.message === "string" ? payload.message : "";
      if (kind === "user_message") {
        summary.messageCount += 1;
        summary.userCount += 1;
        const intent = normalizeWhitespace(message);
        if (!summary.userIntent && intent.length >= 10) summary.userIntent = intent.slice(0, 500);
      } else if (kind === "agent_message") {
        summary.messageCount += 1;
        summary.assistantCount += 1;
        for (const block of message.split(/\n\s*\n+/)) {
          if (DECISION.test(block)) pushSnippet(block, summary.decisionSnippets, 5, 400);
          if (BLOCKER.test(block)) pushSnippet(block, summary.blockerSnippets, 3, 300);
        }
      } else if (kind === "sub_agent_activity") {
        summary.hasSubagents = true;
      } else if (kind === "patch_apply_end") {
        const changes = payload.changes;
        if (changes && typeof changes === "object") {
          for (const [file, change] of Object.entries(changes)) {
            files.add(file);
            if (change && typeof change === "object" && typeof (change as { move_path?: unknown }).move_path === "string") {
              files.add((change as { move_path: string }).move_path);
            }
          }
        }
        const callId = typeof payload.call_id === "string" ? payload.call_id : "";
        if (!callId || !calls.has(callId)) countTool(summary, "apply_patch", callId, calls);
      }
    }
    if (record.type === "response_item" && ["function_call", "custom_tool_call"].includes(String(payload.type ?? ""))) {
      const namespace = typeof payload.namespace === "string" ? `${payload.namespace}.` : "";
      const name = typeof payload.name === "string" ? `${namespace}${payload.name}` : "unknown";
      countTool(summary, name, typeof payload.call_id === "string" ? payload.call_id : "", calls);
    }
  }
  summary.filesEdited = [...files].sort();
  return summary;
}

function countTool(summary: SessionSummary, name: string, callId: string, calls: Set<string>): void {
  if (callId && calls.has(callId)) return;
  if (callId) calls.add(callId);
  summary.toolUseCount += 1;
  summary.toolsUsed[name] = (summary.toolsUsed[name] ?? 0) + 1;
  if (name.split(".").at(-1) === "exec_command") summary.bashCommands += 1;
}
