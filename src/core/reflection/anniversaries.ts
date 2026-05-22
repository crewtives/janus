/**
 * Anniversary detection — Phase 2 U7.
 *
 * Combina `project_metadata.birth_date_*` (de Phase 1C) con la fecha del
 * pulse para decidir si hoy es aniversario del proyecto. Devuelve los años
 * cumplidos (>= 1) y la fecha original. El callout en el daily lo usa para
 * marcar el día; el Wrapped per-project (Phase 3 U4) usa el mismo trigger
 * para disparar la generación.
 */
import { getProjectBirthDates, detectAnniversary } from "../project-metadata.ts";
import type { Checkpoint } from "../checkpoint.ts";
import type { ProjectConfig } from "../../config/types.ts";

export interface AnniversaryInfo {
  /** Años cumplidos hoy (>= 1). */
  years: number;
  /** Fecha original que disparó el aniversario (YYYY-MM-DD). */
  sinceDate: string;
  /** Origen de la fecha: 'git' (primer commit) o 'pulse' (primer pulse). */
  source: "git" | "pulse";
}

/**
 * Chequea si `today` es aniversario del proyecto. Preferí birth_date_git si
 * existe; cae a birth_date_pulse si no. Devuelve null si no hay birth date
 * o si hoy no coincide con MM-DD del birth.
 */
export async function detectProjectAnniversary(opts: {
  project: ProjectConfig;
  checkpoint: Checkpoint;
  today: string;
}): Promise<AnniversaryInfo | null> {
  const meta = await getProjectBirthDates({
    project: opts.project,
    checkpoint: opts.checkpoint,
  });

  // Probar git primero (más estable / preciso).
  const gitYears = detectAnniversary(meta.birthDateGit, opts.today);
  if (gitYears !== null && meta.birthDateGit) {
    return { years: gitYears, sinceDate: meta.birthDateGit, source: "git" };
  }

  const pulseYears = detectAnniversary(meta.birthDatePulse, opts.today);
  if (pulseYears !== null && meta.birthDatePulse) {
    return { years: pulseYears, sinceDate: meta.birthDatePulse, source: "pulse" };
  }

  return null;
}

/** Renderiza el callout markdown a inyectar en el daily pulse. */
export function renderAnniversaryCallout(info: AnniversaryInfo, projectName: string): string {
  const yearsLabel = info.years === 1 ? "1 year" : `${info.years} years`;
  const sourceLabel = info.source === "git" ? "first commit" : "first pulse";
  return `> [!important] 🎂 Anniversary — ${yearsLabel} of ${projectName}\n> Today marks ${yearsLabel} since the project's ${sourceLabel} (${info.sinceDate}). A good moment to look at where we came from.`;
}
