import { Eta } from "eta";
import type { GitActivity, GitCommit } from "./git.ts";
import type { SessionSummary } from "./sessions.ts";
import voiceSpec from "../prompts/_voice.md" with { type: "text" };
import dailyPulseTemplate from "../prompts/daily-pulse.v8.md" with { type: "text" };

export const PROMPT_VERSION = "v8" as const;

/**
 * Returns the shared voice spec (`_voice.md`). Async to preserve the
 * caller signature; resolves synchronously from the bundled string.
 * Prompts inject it at the top via `<%= it.voice %>`.
 */
export async function loadVoiceSpec(): Promise<string> {
  return voiceSpec;
}

/** Test-only: no-op now that the voice spec is a bundled constant. Kept for backward compat. */
export function _resetVoiceSpecCache(): void {
  // intentionally empty
}

export interface PulsePromptContext {
  project: string;
  date: string;
  promptVersion: string;
  /** Voice spec injected as a string. Loaded via loadVoiceSpec(). */
  voice: string;
  strategyMd: string;
  roadmap: string;
  readmeMd: string;
  claudeMd: string;
  commits: GitCommit[];
  diffStat: string;
  filesChanged: string[];
  branch: string;
  isClean: boolean;
  sessions: SessionSummary[];
  commitTypes: Record<string, number>;
  insertions: number;
  deletions: number;
  topFolders: Array<{ folder: string; count: number }>;
  /** If the agent already produced a roadmap draft for N consecutive days without the user applying it, don't repeat it. */
  suppressRoadmapDraft: boolean;
  /** Project's relative path inside the vault (e.g. "Projects/crewtives/acme/app"). Used in dataview queries. */
  vaultRelPath: string;
  /** Risks from the last N days of the same project, used to detect recurrence. */
  previousRisks: PreviousPulseSection[];
  /** Decisions from the last N days of the same project, used to detect reversions / modifications. */
  previousDecisions: PreviousPulseSection[];
  /** Whether a previous-day pulse exists on disk. If false, the prompt omits the "Previous day" wiki-link to avoid broken links. */
  hasPreviousPulse: boolean;
  /** Filename of the previous pulse (YYYY-MM-DD-<project>) without .md. Only valid if hasPreviousPulse=true. */
  previousPulseFilename: string;
  /** Consecutive `idle` days before today. If > 0, the agent knows it's coming from an inactive streak. */
  idleStreakBefore: number;
  /** Project STRATEGY.md status: filled (user completed it), draft (untouched template), missing (does not exist). */
  strategyStatus: "filled" | "draft" | "missing";
  /** Days since STRATEGY.md was created as a template (when draft). 0 if filled/missing. */
  strategyDaysAsDraft: number;
  /** Manual user edits detected in previous pulses. The agent must respect these patterns. */
  userEdits: UserEditSummary[];
  /** Active tracks of the project (from MOCs/Tracks/). The agent must tag the pulse with the relevant ones. */
  activeTracks: ActiveTrackSummary[];
  /** Pre-rendered anniversary callout (Phase 2 U7). Empty string if not applicable. */
  anniversaryCallout: string;
  /** Years completed today (Phase 2 U7). 0 if not applicable. */
  anniversaryYears: number;
  /** Date from which years are counted (YYYY-MM-DD). Empty if not applicable. */
  anniversarySince: string;
  /** Pulse from the same day one year ago (Phase 2 U9). null if it doesn't exist. */
  dayLastYear: DayLastYearAnchor | null;
}

export interface DayLastYearAnchor {
  /** Last year's date (YYYY-MM-DD). */
  date: string;
  /** TL;DR extracted from last year's pulse (callout summary text). */
  tldr: string;
  /** Pulse filename (YYYY-MM-DD-<project>) without .md, for wiki-link. */
  pulseFilename: string;
}

export interface ActiveTrackSummary {
  slug: string;
  name: string;
  emoji: string;
  status: string;
}

export interface UserEditSummary {
  date: string;
  diff: string;
}

export interface PreviousPulseSection {
  date: string;
  /** Previous pulse filename without .md (for wiki-link). */
  pulsePath: string;
  /** Callout/section content (with `>` lines stripped). */
  text: string;
}

const eta = new Eta({
  autoEscape: false, // we want literal markdown, not HTML escaping
  rmWhitespace: false,
});

export async function renderDailyPulsePrompt(ctx: PulsePromptContext): Promise<string> {
  const rendered = eta.renderString(dailyPulseTemplate, ctx);
  if (typeof rendered !== "string") {
    throw new Error("renderDailyPulsePrompt: template renderer returned non-string");
  }
  return rendered;
}

export function buildPromptContext(input: {
  project: string;
  date: string;
  voice: string;
  strategyMd: string | null;
  roadmap: string | null;
  readmeMd: string | null;
  claudeMd: string | null;
  activity: GitActivity;
  sessions: SessionSummary[];
  suppressRoadmapDraft?: boolean;
  vaultRelPath?: string;
  previousRisks?: PreviousPulseSection[];
  previousDecisions?: PreviousPulseSection[];
  hasPreviousPulse?: boolean;
  previousPulseFilename?: string;
  idleStreakBefore?: number;
  strategyStatus?: "filled" | "draft" | "missing";
  strategyDaysAsDraft?: number;
  userEdits?: UserEditSummary[];
  activeTracks?: ActiveTrackSummary[];
  anniversaryCallout?: string;
  anniversaryYears?: number;
  anniversarySince?: string;
  dayLastYear?: DayLastYearAnchor | null;
}): PulsePromptContext {
  return {
    project: input.project,
    date: input.date,
    promptVersion: PROMPT_VERSION,
    voice: input.voice,
    strategyMd: input.strategyMd ?? "",
    roadmap: input.roadmap ?? "",
    readmeMd: input.readmeMd ?? "",
    claudeMd: input.claudeMd ?? "",
    commits: input.activity.commits,
    diffStat: input.activity.diffStat,
    filesChanged: input.activity.filesChanged,
    branch: input.activity.currentBranch,
    isClean: input.activity.isClean,
    sessions: input.sessions,
    commitTypes: input.activity.commitTypes,
    insertions: input.activity.insertions,
    deletions: input.activity.deletions,
    topFolders: input.activity.topFolders,
    suppressRoadmapDraft: input.suppressRoadmapDraft ?? false,
    vaultRelPath: input.vaultRelPath ?? `Projects/${input.project}`,
    previousRisks: input.previousRisks ?? [],
    previousDecisions: input.previousDecisions ?? [],
    hasPreviousPulse: input.hasPreviousPulse ?? false,
    previousPulseFilename: input.previousPulseFilename ?? "",
    idleStreakBefore: input.idleStreakBefore ?? 0,
    strategyStatus: input.strategyStatus ?? (input.strategyMd ? "filled" : "missing"),
    strategyDaysAsDraft: input.strategyDaysAsDraft ?? 0,
    userEdits: input.userEdits ?? [],
    activeTracks: input.activeTracks ?? [],
    anniversaryCallout: input.anniversaryCallout ?? "",
    anniversaryYears: input.anniversaryYears ?? 0,
    anniversarySince: input.anniversarySince ?? "",
    dayLastYear: input.dayLastYear ?? null,
  };
}
