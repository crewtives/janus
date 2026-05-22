import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SessionSummary {
  sessionId: string;
  path: string;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  messageCount: number;
  assistantCount: number;
  userCount: number;
  toolUseCount: number;
  toolsUsed: Record<string, number>;
  filesEdited: string[];
  bashCommands: number;
  model: string | null;
  cwd: string | null;
  gitBranch: string | null;
  hasSubagents: boolean;
  /** First user message (work intent). Null if the session doesn't open with a reasonable text user msg. */
  userIntent: string | null;
  /** Text of assistant messages that look like decisions or key summaries.
   *  Heuristic: contain verbs "decidido", "elegido", "descartado", "implementado",
   *  "fixed", "completed", "**Decision**", "**Conclusion**", etc.
   *  Max 5 fragments, up to 400 chars each. */
  decisionSnippets: string[];
  /** Blocks that look like recurring blockers/errors in the session.
   *  Heuristic: "failed", "error", "broken", "retry", "stuck", "blocker", "blocked".
   *  Max 3 fragments, up to 300 chars. */
  blockerSnippets: string[];
}

const PROJECTS_ROOT = join(homedir(), ".claude", "projects");

const DECISION_PATTERNS = /\b(decidido|decid[íi]|elegido|elegimos|descartado|descartamos|implementado|completado|completed|conclusion|decision|fixed|resolved|shipped|merged|deployed)\b/i;
const BLOCKER_PATTERNS = /\b(failed|error|broken|stuck|blocker|blocked|cannot|won[''']?t work|crash|timeout|rejected)\b/i;

const MAX_DECISION_SNIPPETS = 5;
const MAX_BLOCKER_SNIPPETS = 3;
const DECISION_SNIPPET_LEN = 400;
const BLOCKER_SNIPPET_LEN = 300;
const USER_INTENT_MIN_LEN = 10;
const USER_INTENT_MAX_LEN = 500;

/**
 * Convert an absolute repo path into the slug Claude Code uses:
 * "/Users/alice/projects/janus" → "-Users-alice-projects-janus"
 */
export function pathToSlug(absPath: string): string {
  return absPath.replace(/\//g, "-");
}

export function sessionsDir(repoPath: string): string {
  return join(PROJECTS_ROOT, pathToSlug(repoPath));
}

/**
 * Lists project .jsonl files whose mtime falls inside the range.
 * `date` is the target date in YYYY-MM-DD (local zone). Filters by file
 * mtime (the date the session was last updated).
 */
export async function findSessionsForDate(repoPath: string, date: string): Promise<string[]> {
  const dir = sessionsDir(repoPath);
  if (!existsSync(dir)) return [];

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59.999`);

  const entries = await readdir(dir);
  const matches: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = join(dir, name);
    try {
      const st = await stat(full);
      if (st.mtime >= dayStart && st.mtime <= dayEnd) matches.push(full);
    } catch {
      // file moved/deleted between readdir and stat → ignore
    }
  }
  return matches;
}

/**
 * Lists sessions whose mtime falls on any date between `sinceDate` and `untilDate` (inclusive).
 * Useful for backfill.
 */
export async function findSessionsBetween(repoPath: string, sinceDate: string, untilDate: string): Promise<string[]> {
  const dir = sessionsDir(repoPath);
  if (!existsSync(dir)) return [];
  const start = new Date(`${sinceDate}T00:00:00`);
  const end = new Date(`${untilDate}T23:59:59.999`);
  const entries = await readdir(dir);
  const matches: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = join(dir, name);
    try {
      const st = await stat(full);
      if (st.mtime >= start && st.mtime <= end) matches.push(full);
    } catch {
      // noop
    }
  }
  return matches;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      const t = (block as { text?: unknown }).text;
      if (typeof t === "string") parts.push(t);
    }
  }
  return parts.join("\n");
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function isDuplicateSnippet(snippet: string, existing: string[]): boolean {
  const norm = normalizeWhitespace(snippet).toLowerCase().slice(0, 80);
  if (!norm) return true;
  for (const e of existing) {
    const en = normalizeWhitespace(e).toLowerCase().slice(0, 80);
    if (en === norm) return true;
    if (en.includes(norm) || norm.includes(en)) return true;
  }
  return false;
}

function pushSnippet(text: string, maxLen: number, target: string[], maxCount: number): void {
  if (target.length >= maxCount) return;
  const clean = normalizeWhitespace(text);
  if (clean.length < 20) return;
  const snippet = clean.length > maxLen ? clean.slice(0, maxLen).trimEnd() + "…" : clean;
  if (isDuplicateSnippet(snippet, target)) return;
  target.push(snippet);
}

/**
 * Parses a .jsonl file and produces a lightweight summary.
 * Does not reconstruct the full conversation — only counters and signals,
 * plus text selected by heuristic (userIntent, decisionSnippets, blockerSnippets).
 */
export async function summarizeSession(jsonlPath: string): Promise<SessionSummary> {
  const file = Bun.file(jsonlPath);
  const text = await file.text();

  const sessionId = jsonlPath.match(/([0-9a-f-]{36})\.jsonl$/i)?.[1] ?? "unknown";
  const subagentsDir = jsonlPath.replace(/\.jsonl$/, "");
  const hasSubagents = existsSync(subagentsDir);

  const summary: SessionSummary = {
    sessionId,
    path: jsonlPath,
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
    cwd: null,
    gitBranch: null,
    hasSubagents,
    userIntent: null,
    decisionSnippets: [],
    blockerSnippets: [],
  };

  const filesSet = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg: SessionMessage;
    try {
      msg = JSON.parse(trimmed) as SessionMessage;
    } catch {
      continue;
    }

    if (msg.timestamp) {
      if (!summary.firstTimestamp) summary.firstTimestamp = msg.timestamp;
      summary.lastTimestamp = msg.timestamp;
    }
    if (msg.cwd && !summary.cwd) summary.cwd = msg.cwd;
    if (msg.gitBranch && !summary.gitBranch) summary.gitBranch = msg.gitBranch;

    const inner = (msg.message ?? undefined) as { content?: unknown; model?: unknown } | undefined;

    if (msg.type === "user" || msg.type === "assistant") {
      summary.messageCount += 1;
      if (msg.type === "user") {
        summary.userCount += 1;
        if (!summary.userIntent) {
          const txt = normalizeWhitespace(extractText(inner?.content));
          // Exclude tool_result or local-command messages. The intent is the first real user message.
          if (
            txt.length >= USER_INTENT_MIN_LEN &&
            !txt.startsWith("<local-command") &&
            !txt.startsWith("[Request interrupted")
          ) {
            summary.userIntent = txt.length > USER_INTENT_MAX_LEN ? txt.slice(0, USER_INTENT_MAX_LEN).trimEnd() + "…" : txt;
          }
        }
      }
      if (msg.type === "assistant") {
        summary.assistantCount += 1;
        if (!summary.model && inner && typeof inner.model === "string") {
          summary.model = inner.model;
        }
        const assistantText = extractText(inner?.content);
        if (assistantText) {
          // Split into blocks (paragraphs / bullets) for more manageable snippets.
          const blocks = assistantText.split(/\n\s*\n+/);
          for (const block of blocks) {
            if (DECISION_PATTERNS.test(block)) {
              pushSnippet(block, DECISION_SNIPPET_LEN, summary.decisionSnippets, MAX_DECISION_SNIPPETS);
            }
            if (BLOCKER_PATTERNS.test(block)) {
              pushSnippet(block, BLOCKER_SNIPPET_LEN, summary.blockerSnippets, MAX_BLOCKER_SNIPPETS);
            }
          }
        }
      }
    }

    // tool_use is nested inside assistant.message.content[]
    const content = inner?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as { type?: string; name?: string; input?: Record<string, unknown> };
        if (b.type === "tool_use" && typeof b.name === "string") {
          summary.toolUseCount += 1;
          summary.toolsUsed[b.name] = (summary.toolsUsed[b.name] ?? 0) + 1;
          if ((b.name === "Edit" || b.name === "Write" || b.name === "NotebookEdit") && typeof b.input?.file_path === "string") {
            filesSet.add(b.input.file_path);
          }
          if (b.name === "Bash") summary.bashCommands += 1;
        }
      }
    }
  }

  summary.filesEdited = [...filesSet];
  return summary;
}

interface SessionMessage {
  type?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  message?: unknown;
}
