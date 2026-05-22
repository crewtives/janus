/**
 * Project metadata — Phase 1C bookkeeping.
 *
 * `birth_date_git` = fecha del primer commit del repo.
 * `birth_date_pulse` = fecha del primer pulse de este proyecto en el vault.
 *
 * Habilita:
 *  - Anniversary detection (Phase 2 U7) — disparo del per-project Wrapped.
 *  - Project age en spine / Wrapped (Phase 3 U2).
 *
 * Caché: en `project_metadata` (SQLite). El compute corre git + filesystem,
 * y se recachea cada 24h o cuando explícitamente se invalida.
 */
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Checkpoint } from "./checkpoint.ts";
import type { ProjectConfig } from "../config/types.ts";

const CACHE_TTL_MS = 24 * 60 * 60_000;

export interface ProjectBirthDates {
  project: string;
  /** YYYY-MM-DD del primer commit, null si no hay commits. */
  birthDateGit: string | null;
  /** YYYY-MM-DD del primer pulse, null si no hay pulses todavía. */
  birthDatePulse: string | null;
  /** min(git, pulse) — null si ambos son null. */
  earliest: string | null;
}

/**
 * Compute birth dates de un proyecto. Lee de cache si fresco; recomputa si stale.
 *
 * @param opts.force — recomputa aunque el cache esté fresco.
 */
export async function getProjectBirthDates(opts: {
  project: ProjectConfig;
  checkpoint: Checkpoint;
  force?: boolean;
}): Promise<ProjectBirthDates> {
  const { project, checkpoint, force } = opts;
  if (!force) {
    const cached = checkpoint.getProjectMetadata(project.name);
    if (cached) {
      const age = Date.now() - new Date(cached.computedAt).getTime();
      if (age < CACHE_TTL_MS) {
        return {
          project: project.name,
          birthDateGit: cached.birthDateGit,
          birthDatePulse: cached.birthDatePulse,
          earliest: minDate(cached.birthDateGit, cached.birthDatePulse),
        };
      }
    }
  }

  const [birthDateGit, birthDatePulse] = await Promise.all([
    firstGitCommitDate(project.repoPath),
    firstPulseDate(project.obsidianPath),
  ]);

  checkpoint.upsertProjectMetadata({
    project: project.name,
    birthDateGit,
    birthDatePulse,
  });

  return {
    project: project.name,
    birthDateGit,
    birthDatePulse,
    earliest: minDate(birthDateGit, birthDatePulse),
  };
}

/** Lee el commit más viejo del repo. Devuelve YYYY-MM-DD o null. */
export async function firstGitCommitDate(repoPath: string): Promise<string | null> {
  if (!existsSync(repoPath)) return null;
  try {
    const proc = Bun.spawn(["git", "log", "--reverse", "--format=%ai", "--max-parents=0"], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    if (proc.exitCode !== 0) return null;
    const firstLine = stdout.split("\n").map((s) => s.trim()).filter(Boolean)[0];
    if (!firstLine) return null;
    // formato: "2024-05-21 12:34:56 -0300"
    const m = firstLine.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

/** Lee el pulse más viejo del directorio `<obsidianPath>/pulse/`. Devuelve YYYY-MM-DD o null. */
export async function firstPulseDate(obsidianPath: string): Promise<string | null> {
  const pulseDir = join(obsidianPath, "pulse");
  const archiveDir = join(obsidianPath, "_archive");
  const candidates: string[] = [];

  if (existsSync(pulseDir)) {
    try {
      const entries = await readdir(pulseDir);
      for (const name of entries) {
        const m = name.match(/^(\d{4}-\d{2}-\d{2})-/);
        if (m && m[1]) candidates.push(m[1]);
      }
    } catch {
      // noop
    }
  }

  // Pulses archivados a _archive/YYYY-MM/<date>-<project>.md también cuentan.
  if (existsSync(archiveDir)) {
    try {
      const monthsLevels = await readdir(archiveDir);
      for (const month of monthsLevels) {
        const dir = join(archiveDir, month);
        try {
          const entries = await readdir(dir);
          for (const name of entries) {
            const m = name.match(/^(\d{4}-\d{2}-\d{2})-/);
            if (m && m[1]) candidates.push(m[1]);
          }
        } catch {
          // _archive/<x> puede no ser un dir; skip
        }
      }
    } catch {
      // noop
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort();
  return candidates[0]!;
}

function minDate(a: string | null, b: string | null): string | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * Detecta si hoy es aniversario (mismo mes-día) del birth_date. Devuelve los
 * años transcurridos (>= 1) o null si no es aniversario.
 */
export function detectAnniversary(birth: string | null, today: string): number | null {
  if (!birth) return null;
  if (birth.length < 10 || today.length < 10) return null;
  const bm = birth.slice(5, 10); // MM-DD
  const tm = today.slice(5, 10);
  if (bm !== tm) return null;
  const by = parseInt(birth.slice(0, 4), 10);
  const ty = parseInt(today.slice(0, 4), 10);
  const diff = ty - by;
  return diff >= 1 ? diff : null;
}
