/**
 * Wrapped trickle release — Phase 3 U7.
 *
 * Durante los 7 días previos al 31-dic, el daily rollup inyecta snippets
 * progresivos del Wrapped que se viene.
 *
 * Schedule (relativo al 31-dic):
 *   T-7 (dec-24): "Janus está cocinando tu Wrapped. Falta 7."
 *   T-5 (dec-26): "Sneak peek: tu maker personality este año es ..."
 *   T-3 (dec-28): "Adelanto: tu track #1 del año fue ..."
 *   T-1 (dec-30): "Mañana sale tu Wrapped completo."
 *   T-0 (dec-31): "Hoy salió el Wrapped" + link.
 *
 * Configurable via `config.wrapped.trickle.enabled` (default true). Si el
 * usuario opta out, no se inyecta nada.
 */
import type { JanusConfig } from "../../config/types.ts";
import type { WrappedData } from "./types.ts";

export interface TrickleSnippet {
  /** Día actual relativo a dec-31. 0 = dec-31. */
  dayOffset: number;
  /** Texto markdown a inyectar en el daily. */
  text: string;
}

/**
 * Devuelve null si hoy no cae en la ventana de trickle, o si está
 * deshabilitado por config.
 */
export async function getTrickleSnippetForDate(opts: {
  config: JanusConfig & { wrapped?: { trickle?: { enabled?: boolean } } };
  date: string;
  /** Lazy loader del WrappedData. Solo se invoca si la ventana aplica. */
  loadWrappedData?: () => Promise<WrappedData | null>;
}): Promise<TrickleSnippet | null> {
  if (opts.config.wrapped?.trickle?.enabled === false) return null;

  const offset = daysToYearEnd(opts.date);
  if (offset === null || offset < 0 || offset > 7) return null;

  // T-6, T-4, T-2 → silencio. Solo T-7, T-5, T-3, T-1, T-0 emiten.
  const emitOffsets = new Set([7, 5, 3, 1, 0]);
  if (!emitOffsets.has(offset)) return null;

  let data: WrappedData | null = null;
  if (opts.loadWrappedData) {
    try {
      data = await opts.loadWrappedData();
    } catch {
      data = null;
    }
  }

  return { dayOffset: offset, text: renderSnippet(offset, data, opts.date) };
}

/** Días desde `date` hasta dec-31 del mismo año. null si formato inválido. */
export function daysToYearEnd(date: string): number | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1]!, 10);
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const today = new Date(Date.UTC(year, parseInt(m[2]!, 10) - 1, parseInt(m[3]!, 10)));
  return Math.round((yearEnd.getTime() - today.getTime()) / 86_400_000);
}

export function renderSnippet(offset: number, data: WrappedData | null, date: string): string {
  const year = date.slice(0, 4);
  switch (offset) {
    case 7:
      return `> [!info] 🎁 Wrapped ${year}\n> Janus está cocinando tu Wrapped. Falta una semana.`;
    case 5: {
      const arch = data?.personality?.archetype ?? "se está computando";
      return `> [!info] 🎁 Sneak peek del Wrapped ${year}\n> Tu maker personality este año: **${arch}**.`;
    }
    case 3: {
      const track = data?.topTracks[0];
      const trackLabel = track ? `**${track.slug}** (${track.project}) — ${track.mentionsCount} menciones` : "se está calculando";
      return `> [!info] 🎁 Adelanto del Wrapped ${year}\n> Tu track #1 del año: ${trackLabel}.`;
    }
    case 1:
      return `> [!info] 🎁 Wrapped ${year} llega mañana\n> Mañana sale el Wrapped completo. \`bun janus wrapped --year ${year}\` para forzarlo antes.`;
    case 0:
      return `> [!success] 🎁 Wrapped ${year} salió hoy\n> Disponible en \`Wrapped/Wrapped-${year}.md\` (markdown) y \`.html\` si lo renderizaste.`;
    default:
      return "";
  }
}
