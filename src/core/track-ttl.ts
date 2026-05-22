import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";

export interface TrackArchiveResult {
  tracksScanned: number;
  tracksArchived: number;
  archived: Array<{ slug: string; weeksSinceLastMention: number; reason: string }>;
}

export interface TrackArchiveOptions {
  vaultPath: string;
  /** If the track is not mentioned in N consecutive weekly rollups, archive. Default: 4 weeks. */
  ttlWeeks?: number;
  /** If true, doesn't move files — only reports. */
  dryRun?: boolean;
}

const DEFAULT_TTL_WEEKS = 4;

/**
 * Detects "stale" tracks — those not mentioned in the last N weekly rollups
 * (the "Weekly mention history" that materializeTracks keeps).
 * Moves them to `<vault>/MOCs/Tracks/_archive/<slug>.md`.
 *
 * The track is not lost — it remains indexed by FTS5 (via `_archive` scan) and
 * is removed from the active MOC. Manually move it back to restore.
 *
 * Idempotent: already-archived tracks are not touched again.
 */
export async function archiveStaleTracks(opts: TrackArchiveOptions): Promise<TrackArchiveResult> {
  const ttlWeeks = opts.ttlWeeks ?? DEFAULT_TTL_WEEKS;
  const tracksDir = join(opts.vaultPath, "MOCs", "Tracks");
  const archiveDir = join(tracksDir, "_archive");
  const result: TrackArchiveResult = { tracksScanned: 0, tracksArchived: 0, archived: [] };

  if (!existsSync(tracksDir)) return result;
  await mkdir(archiveDir, { recursive: true });

  // To compute "weeks since last mention", we need the date of the most
  // recent weekly rollup in the vault.
  const latestWeeklyDate = await findLatestWeeklyDate(opts.vaultPath);

  const entries = await readdir(tracksDir);
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const filePath = join(tracksDir, name);
    const stat = statSync(filePath);
    if (!stat.isFile()) continue;
    result.tracksScanned += 1;

    const slug = name.replace(/\.md$/, "");
    const content = await readFile(filePath, "utf-8");
    const lastMentionDate = extractLatestWeeklyMention(content);

    // If there are no weekly mentions, use mtime as a proxy. If old → archive.
    const referenceDate = lastMentionDate ?? stat.mtime.toISOString().slice(0, 10);
    const weeksSince = weeksBetween(referenceDate, latestWeeklyDate ?? todayISO());

    if (weeksSince < ttlWeeks) continue;

    result.archived.push({
      slug,
      weeksSinceLastMention: weeksSince,
      reason: lastMentionDate
        ? `last weekly mention: ${lastMentionDate} (${weeksSince} weeks ago)`
        : `no weekly mentions; mtime ${referenceDate} (${weeksSince} weeks ago)`,
    });

    if (!opts.dryRun) {
      const target = join(archiveDir, name);
      if (existsSync(target)) continue;
      try {
        await rename(filePath, target);
        result.tracksArchived += 1;
      } catch {
        // tolerant
      }
    } else {
      result.tracksArchived += 1; // preview counter
    }
  }

  return result;
}

async function findLatestWeeklyDate(vaultPath: string): Promise<string | null> {
  const dir = join(vaultPath, "Timeline", "Weekly");
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir);
  const dates: string[] = [];
  for (const name of entries) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-week\.md$/);
    if (m) dates.push(m[1]!);
  }
  if (dates.length === 0) return null;
  dates.sort();
  return dates[dates.length - 1]!;
}

/**
 * Extracts the date of the most recent weekly mentioned in the track.
 * Looks for wiki-links `[[YYYY-MM-DD-week|...]]`, `[[YYYY-MM-monthly|...]]`, or `[[YYYY-QN|...]]`.
 */
function extractLatestWeeklyMention(content: string): string | null {
  const matches = [
    ...content.matchAll(/\[\[(\d{4}-\d{2}-\d{2})-week\b/g),
  ].map((m) => m[1]!);
  // Monthly: month as reference
  const monthlies = [...content.matchAll(/\[\[(\d{4}-\d{2})-monthly\b/g)].map((m) => `${m[1]!}-15`);
  // Quarterly: use the middle month of the quarter
  const quarterlies = [...content.matchAll(/\[\[(\d{4})-Q([1-4])\b/g)].map((m) => {
    const q = parseInt(m[2]!, 10);
    const month = (q - 1) * 3 + 2; // middle month
    return `${m[1]!}-${String(month).padStart(2, "0")}-15`;
  });
  const all = [...matches, ...monthlies, ...quarterlies];
  if (all.length === 0) return null;
  all.sort();
  return all[all.length - 1]!;
}

function weeksBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / (7 * 86_400_000)));
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Helper: restore an archived track back to the active dir (manual). */
export async function unarchiveTrack(opts: { vaultPath: string; slug: string }): Promise<boolean> {
  const archivePath = join(opts.vaultPath, "MOCs", "Tracks", "_archive", `${opts.slug}.md`);
  const targetPath = join(opts.vaultPath, "MOCs", "Tracks", `${opts.slug}.md`);
  if (!existsSync(archivePath)) return false;
  if (existsSync(targetPath)) return false; // don't overwrite
  await rename(archivePath, targetPath);
  return true;
}
