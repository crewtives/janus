import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ActiveTrack {
  slug: string;
  name: string;
  emoji: string;
  projects: string[];
  status: string;
  /** True if the note lives under `MOCs/Tracks/_archive/`. */
  archived: boolean;
}

/**
 * Reads MOCs/Tracks/ from the vault and returns ACTIVE tracks (not archived),
 * optionally filtered by project.
 *
 * A track is "active" if it lives directly in `MOCs/Tracks/<slug>.md`.
 * Archived ones live in `MOCs/Tracks/_archive/<slug>.md` and are excluded
 * by default (TODO: add automatic TTL that moves stale ones).
 */
export async function loadActiveTracks(opts: {
  vaultPath: string;
  /** If set, returns only tracks that list this project in `projects`. */
  project?: string;
}): Promise<ActiveTrack[]> {
  const dir = join(opts.vaultPath, "MOCs", "Tracks");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);

  const tracks: ActiveTrack[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const slug = name.replace(/\.md$/, "");
    const filePath = join(dir, name);
    const content = await readFile(filePath, "utf-8");
    const track = parseTrack(slug, content, false);
    if (track) tracks.push(track);
  }

  if (opts.project) {
    return tracks.filter((t) => t.projects.includes(opts.project!));
  }
  return tracks;
}

function parseTrack(slug: string, content: string, archived: boolean): ActiveTrack | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1] ?? "";

  const name = fm.match(/^name:\s*"?([^"\n]+)"?$/m)?.[1]?.trim() ?? slug;
  const statusM = fm.match(/^status:\s*"?([^"\n]+)"?$/m);
  const status = statusM?.[1]?.trim() ?? "—";

  // projects: ["a", "b"]
  const projectsM = fm.match(/^projects:\s*\[(.+)\]$/m);
  const projects = projectsM
    ? projectsM[1]!.split(",").map((p) => p.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    : [];

  // emoji from the first H1 heading if present
  const titleMatch = content.match(/^#\s+(\S+)?\s*(.+)$/m);
  let emoji = "";
  if (titleMatch?.[1] && /^[^a-zA-Z0-9]/.test(titleMatch[1])) {
    emoji = titleMatch[1];
  }

  return { slug, name, emoji, projects, status, archived };
}
