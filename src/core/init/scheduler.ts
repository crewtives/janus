/**
 * Abstracción cross-platform del scheduler para Janus.
 *
 *  - macOS  → launchd (`~/Library/LaunchAgents/com.crewtives.janus.plist`)
 *  - Linux  → systemd-user timer (`~/.config/systemd/user/janus.{timer,service}`)
 *  - Otros  → throw con mensaje claro (Windows nativo requiere Task Scheduler,
 *             out of scope hoy; WSL ejecuta como Linux y funciona automático)
 *
 * Diferencias importantes entre los dos:
 *  - launchd NO recupera runs perdidos por sleep (default 10:00 AM "likely-awake")
 *  - systemd `Persistent=true` SÍ recupera runs perdidos
 *
 * Esta abstracción la usa el wizard `janus init` y cualquier caller programático
 * que quiera instalar el scheduler nightly sin preocuparse del platform.
 */
import * as launchd from "./launchd.ts";
import * as systemd from "./systemd.ts";

export const DEFAULT_HOUR = 10;
export const DEFAULT_MINUTE = 0;

export type SchedulerKind = "launchd" | "systemd" | "unsupported";

export interface SchedulerInstallOpts {
  /** Path absoluto al bin/janus.ts del repo. */
  binPath: string;
  /** Path absoluto al repo (WorkingDirectory). */
  repoPath: string;
  /** Hora (0-23). Default 10. */
  hour?: number;
  /** Minuto (0-59). Default 0. */
  minute?: number;
  /** No escribe ni invoca CLI tools; solo reporta qué acción haría. */
  dryRun?: boolean;
  /** Si false, no llama al CLI tool (launchctl/systemctl). Útil para tests. Default true. */
  reload?: boolean;
}

export interface SchedulerInstallResult {
  kind: SchedulerKind;
  /** Acción que se tomó. */
  action: "installed" | "updated" | "unchanged" | "skipped-unsupported";
  /** Path(s) escritos. Para launchd es uno, para systemd son dos. */
  paths: string[];
  /** true si el scheduler aceptó cargar el unit (post-write verification). */
  loaded?: boolean;
  /** Error del CLI tool si falló. */
  error?: string;
}

/**
 * Devuelve qué scheduler corresponde a esta plataforma. Útil para que el
 * wizard muestre el nombre correcto en el prompt opt-in.
 */
export function detectScheduler(): SchedulerKind {
  switch (process.platform) {
    case "darwin":
      return "launchd";
    case "linux":
      return "systemd";
    default:
      return "unsupported";
  }
}

/**
 * Instala el scheduler correcto para la plataforma actual. Idempotente:
 * re-correr no toca archivos byte-equal, hace backup y update si difieren.
 */
export async function installScheduler(opts: SchedulerInstallOpts): Promise<SchedulerInstallResult> {
  const kind = detectScheduler();

  if (kind === "unsupported") {
    return {
      kind,
      action: "skipped-unsupported",
      paths: [],
      error: `Scheduler nightly no soportado en ${process.platform}. Janus core funciona, pero tenés que disparar 'bun janus pulse' manualmente (o configurar cron/Task Scheduler vos mismo).`,
    };
  }

  if (kind === "launchd") {
    const content = launchd.renderPlist({
      binPath: opts.binPath,
      repoPath: opts.repoPath,
      hour: opts.hour ?? DEFAULT_HOUR,
      minute: opts.minute ?? DEFAULT_MINUTE,
    });
    const r = await launchd.installPlist(content, {
      dryRun: opts.dryRun ?? false,
      reload: opts.reload ?? true,
    });
    return {
      kind: "launchd",
      action: r.action,
      paths: [r.path],
      loaded: r.loaded,
      error: r.launchctlError,
    };
  }

  // systemd
  const units = systemd.renderUnits({
    binPath: opts.binPath,
    repoPath: opts.repoPath,
    hour: opts.hour ?? DEFAULT_HOUR,
    minute: opts.minute ?? DEFAULT_MINUTE,
  });
  const r = await systemd.installUnits(units, {
    dryRun: opts.dryRun ?? false,
    reload: opts.reload ?? true,
  });
  return {
    kind: "systemd",
    action: r.action,
    paths: [r.timerPath, r.servicePath],
    loaded: r.enabled,
    error: r.systemctlError,
  };
}

export async function uninstallScheduler(): Promise<{ kind: SchedulerKind; removed: boolean; paths: string[] }> {
  const kind = detectScheduler();
  if (kind === "launchd") {
    const r = await launchd.uninstallPlist();
    return { kind, removed: r.removed, paths: [r.path] };
  }
  if (kind === "systemd") {
    const r = await systemd.uninstallUnits();
    return { kind, removed: r.removed, paths: [r.timerPath, r.servicePath] };
  }
  return { kind, removed: false, paths: [] };
}

/**
 * Texto humano-legible que describe qué hace el scheduler en esta plataforma.
 * Útil para mostrar al usuario antes de pedir confirmación en el wizard.
 */
export function describeScheduler(): string {
  const kind = detectScheduler();
  if (kind === "launchd") {
    return "macOS · launchd · agent en ~/Library/LaunchAgents/com.crewtives.janus.plist · corre 10:00 AM diario · NO recupera runs perdidos por sleep";
  }
  if (kind === "systemd") {
    return "Linux · systemd-user timer · units en ~/.config/systemd/user/janus.{timer,service} · corre 10:00 AM diario · Persistent=true recupera runs perdidos por sleep/shutdown";
  }
  return `Scheduler nightly no soportado en ${process.platform} — tenés que disparar 'bun janus pulse' manualmente o configurar cron/Task Scheduler vos mismo.`;
}
