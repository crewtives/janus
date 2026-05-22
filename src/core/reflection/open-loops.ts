/**
 * Open-loop detection — Phase 2 U1 + U2.
 *
 * U1: open tracks without activity for > N days.
 *   Source: `track_lineage` (Phase 1C).
 *
 * U2: decisions > N days old without subsequent pulses referencing them.
 *   Source: `decision_graph` (Phase 1C).
 *
 * The weekly rollup injects these open loops as dedicated callouts — they go
 * from invisible noise to actionable signal.
 */
import type { Checkpoint } from "../checkpoint.ts";

export interface OpenTrackLoop {
  slug: string;
  project: string;
  lastMentioned: string;
  daysSince: number;
}

export interface OrphanDecisionLoop {
  adrId: string;
  project: string;
  /** Date of the pulse that first created/mentioned the decision. */
  firstSeen: string;
  /** Last date it was referenced (may equal firstSeen). */
  lastReferenced: string;
  daysSinceReference: number;
}

const DEFAULT_TRACK_STALE_DAYS = 14;
const DEFAULT_DECISION_ORPHAN_DAYS_CREATED = 14;
const DEFAULT_DECISION_ORPHAN_DAYS_REFERENCED = 7;

/**
 * Returns tracks with `status='open'` whose `last_mentioned` is further back
 * than `staleDays` before `today`. Sorted by dormant days descending.
 */
export function detectOpenTrackLoops(opts: {
  checkpoint: Checkpoint;
  today: string;
  staleDays?: number;
  project?: string;
}): OpenTrackLoop[] {
  const staleDays = opts.staleDays ?? DEFAULT_TRACK_STALE_DAYS;
  const tracks = opts.checkpoint.listTrackLineage(opts.project ? { project: opts.project } : undefined);
  const loops: OpenTrackLoop[] = [];
  for (const t of tracks) {
    if (t.status !== "open") continue;
    const days = daysBetween(t.lastMentioned, opts.today);
    if (days <= staleDays) continue;
    loops.push({
      slug: t.slug,
      project: t.project,
      lastMentioned: t.lastMentioned,
      daysSince: days,
    });
  }
  loops.sort((a, b) => b.daysSince - a.daysSince);
  return loops;
}

/**
 * Detects orphan ADRs: decisions whose first record is old and that have not
 * been referenced recently. Filters out synthetic candidates
 * (`candidate:...`) — only real ADRs (with id `ADR-NNN`) matter.
 */
export function detectOrphanDecisions(opts: {
  checkpoint: Checkpoint;
  today: string;
  createdDays?: number;
  referencedDays?: number;
}): OrphanDecisionLoop[] {
  const createdDays = opts.createdDays ?? DEFAULT_DECISION_ORPHAN_DAYS_CREATED;
  const referencedDays = opts.referencedDays ?? DEFAULT_DECISION_ORPHAN_DAYS_REFERENCED;

  const all = opts.checkpoint.listDecisionReferences();
  // Group by adrId — discard synthetic candidates.
  const byAdr = new Map<string, { project: string; firstSeen: string; lastReferenced: string }>();
  for (const ref of all) {
    if (ref.adrId.startsWith("candidate:")) continue;
    const existing = byAdr.get(ref.adrId);
    if (!existing) {
      byAdr.set(ref.adrId, {
        project: ref.project,
        firstSeen: ref.pulseDate,
        lastReferenced: ref.pulseDate,
      });
      continue;
    }
    if (ref.pulseDate < existing.firstSeen) existing.firstSeen = ref.pulseDate;
    if (ref.pulseDate > existing.lastReferenced) existing.lastReferenced = ref.pulseDate;
  }

  const orphans: OrphanDecisionLoop[] = [];
  for (const [adrId, data] of byAdr) {
    const createdDaysAgo = daysBetween(data.firstSeen, opts.today);
    if (createdDaysAgo < createdDays) continue;
    const referencedDaysAgo = daysBetween(data.lastReferenced, opts.today);
    if (referencedDaysAgo < referencedDays) continue;
    orphans.push({
      adrId,
      project: data.project,
      firstSeen: data.firstSeen,
      lastReferenced: data.lastReferenced,
      daysSinceReference: referencedDaysAgo,
    });
  }
  orphans.sort((a, b) => b.daysSinceReference - a.daysSinceReference);
  return orphans;
}

/**
 * Renders the open-loops callout to inject into the weekly. Returns an empty
 * string if there are no open loops — the prompt treats it as "skip section".
 */
export function renderOpenLoopsCallout(opts: {
  tracks: OpenTrackLoop[];
  decisions: OrphanDecisionLoop[];
}): string {
  if (opts.tracks.length === 0 && opts.decisions.length === 0) return "";
  const lines: string[] = ["> [!info] Open loops"];
  if (opts.tracks.length > 0) {
    lines.push("> ");
    lines.push("> **Dormant tracks** (no recent mention):");
    for (const t of opts.tracks.slice(0, 5)) {
      lines.push(`> - \`${t.slug}\` (${t.project}) — not mentioned for **${t.daysSince} days** · last: ${t.lastMentioned}`);
    }
  }
  if (opts.decisions.length > 0) {
    lines.push("> ");
    lines.push("> **Decisions without follow-up**:");
    for (const d of opts.decisions.slice(0, 5)) {
      lines.push(`> - **${d.adrId}** (${d.project}) — no reference for **${d.daysSinceReference} days** · created: ${d.firstSeen}`);
    }
  }
  return lines.join("\n");
}

function daysBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  const f = new Date(`${from}T00:00:00Z`).getTime();
  const t = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((t - f) / 86_400_000);
}
