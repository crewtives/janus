import type { SessionSummary } from "../core/sessions.ts";

export type SessionSource = SessionSummary["source"];

export interface SessionTranscript {
  source: SessionSource;
  path: string;
}

export type { SessionSummary };
