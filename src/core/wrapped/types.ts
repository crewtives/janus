/**
 * Wrapped data types — Phase 3.
 *
 * El aggregator produce un WrappedData que el renderer y el LLM consumen
 * para producir el markdown final. Es JSON serializable — sirve también
 * como input al MCP server si más adelante exponemos un endpoint.
 */

export type WrappedScope = "yearly" | "project";

export interface WrappedMetrics {
  pulses: number;
  /** Pulses con status !== "idle" — días con actividad real. */
  pulsesActive: number;
  projects: number;
  projectsActive: number;
  decisionsCanonical: number;
  decisionsCandidate: number;
  tracksOpen: number;
  tracksCompleted: number;
  tracksArchived: number;
  hoursSessions: number | null;
  commits: number | null;
  /** Sumas por mes — para gráficos de densidad y "biggest month". */
  pulsesByMonth: Record<string, number>;
}

export interface TopTrack {
  slug: string;
  project: string;
  mentionsCount: number;
  firstSeen: string;
  lastMentioned: string;
  status: string;
}

export interface TopDecision {
  adrId: string;
  /** Project del primer registro — algunas ADRs cruzan proyectos. */
  project: string;
  references: number;
}

export interface BiggestWeek {
  startDate: string;
  endDate: string;
  density: number; // pulses + ADRs en la semana
  pulsesCount: number;
  decisionsCount: number;
}

export interface ProjectBirthday {
  project: string;
  /** Fecha del primer commit o pulse (el más temprano). */
  birthDate: string;
  /** Años cumplidos AL CIERRE del scope (year-end). */
  years: number;
}

export interface WrappedData {
  scope: WrappedScope;
  /** Year del Wrapped. Ej: 2026. */
  year: number;
  /** Si scope === "project", el nombre. Si "yearly", "_global". */
  target: string;
  /** Rango procesado. */
  periodStart: string;
  periodEnd: string;

  metrics: WrappedMetrics;
  topTracks: TopTrack[];
  topDecisions: TopDecision[];
  biggestWeek: BiggestWeek | null;
  birthdays: ProjectBirthday[];
  /** Themes extraídos de los weeklies/monthlies del año (texto libre). */
  themes: string[];
  /** Sample TLDRs representativos — input adicional al renderer LLM. */
  sampleTldrs: Array<{ date: string; project: string; tldr: string }>;
  /** Archetype computado por Phase 3 U3 — null si dry-run / desactivado. */
  personality: PersonalityArchetype | null;
}

export interface PersonalityArchetype {
  /** "The Shipper" | "The Refactorer" | ... | "Hybrid: X+Y". */
  archetype: string;
  /** 1-3 oraciones que explican por qué este archetype gana. */
  explanation: string;
  /** Evidencia citable: lista de fechas/items concretos. */
  evidence: string[];
  /** Confianza 0-1 (deterministica desde las señales). */
  confidence: number;
  /** Señales numéricas que llevaron al archetype. */
  signals: PersonalitySignals;
}

export interface PersonalitySignals {
  /** Ratio tracks_completed / (tracks_open + tracks_completed). 0-1. */
  shipRatio: number;
  /** Commits chore + refactor / total commits. 0-1. Null si no hay commits. */
  refactorRatio: number | null;
  /** Cantidad de proyectos active en el año / total proyectos. 0-1. */
  exploreSpread: number;
  /** Cantidad de tracks que cruzan >= 2 proyectos / total tracks. 0-1. */
  connectorRatio: number;
  /** Promedio de mensajes por sesión. Null si no hay sesiones. */
  avgSessionLength: number | null;
  /** Cantidad de sesiones del año. */
  sessionsCount: number;
}
