import type { ProjectConfig } from "../config/types.ts";
import { findSessionsForDate, summarizeSession } from "../core/sessions.ts";
import { findCodexSessionsForDate, summarizeCodexSession } from "./codex.ts";
import type { SessionSummary, SessionTranscript } from "./types.ts";

export async function findSessionTranscriptsForDate(opts: {
  project: ProjectConfig;
  projects: ProjectConfig[];
  date: string;
  codexHome?: string;
}): Promise<SessionTranscript[]> {
  const [claude, codex] = await Promise.all([
    findSessionsForDate(opts.project.repoPath, opts.date),
    findCodexSessionsForDate(opts).catch(() => {
      console.warn("[ingest] Codex session discovery failed; continuing without Codex evidence");
      return [];
    }),
  ]);
  return [
    ...claude.map((path) => ({ source: "claude-code" as const, path })),
    ...codex,
  ].sort((a, b) => a.path.localeCompare(b.path) || a.source.localeCompare(b.source));
}

export function summarizeTranscript(transcript: SessionTranscript, date?: string): Promise<SessionSummary> {
  return transcript.source === "codex"
    ? summarizeCodexSession(transcript.path, date)
    : summarizeSession(transcript.path, date);
}
