import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Genera + instala systemd-user timer + service para Janus. Linux-only —
 * en otros OS las funciones throwean con mensaje claro.
 *
 * systemd-user vs launchd:
 *  - `Persistent=true` en el timer: systemd recupera runs perdidos cuando
 *    la máquina estaba dormida/apagada al schedule (launchd NO hace esto).
 *  - Logs van a journalctl + archivos opcionales con `StandardOutput=append:`.
 *  - Path estándar: `~/.config/systemd/user/<label>.{timer,service}`.
 *  - Necesita `daemon-reload` después de cada cambio, después `enable --now`.
 *
 * Default label: janus. Constante hardcodeada (mismo razonamiento que launchd:
 * evita path-traversal via label).
 */

export const DEFAULT_LABEL = "janus";
export const DEFAULT_HOUR = 10;
export const DEFAULT_MINUTE = 0;

function assertLinux(): void {
  if (process.platform !== "linux") {
    throw new Error(`systemd es Linux-only (actualmente: ${process.platform})`);
  }
}

export interface RenderUnitsOpts {
  /** Label del job. Default `janus`. */
  label?: string;
  /** Path absoluto al bin/janus.ts del repo. */
  binPath: string;
  /** Path absoluto al repo (WorkingDirectory). */
  repoPath: string;
  /** Hora (0-23). Default 10. */
  hour?: number;
  /** Minuto (0-59). Default 0. */
  minute?: number;
  /** Path absoluto donde escribir stdout. Default `<repoPath>/.janus/logs/systemd-out.log`. */
  stdoutPath?: string;
  /** Path absoluto donde escribir stderr. Default `<repoPath>/.janus/logs/systemd-err.log`. */
  stderrPath?: string;
  /**
   * Path absoluto al binary de bun. Default: `process.execPath`. Mismo razonamiento
   * que launchd: systemd hereda PATH minimal en algunos setups. Path absoluto es
   * siempre seguro.
   */
  bunPath?: string;
}

export interface RenderedUnits {
  timer: string;
  service: string;
}

export function renderUnits(opts: RenderUnitsOpts): RenderedUnits {
  const hour = opts.hour ?? DEFAULT_HOUR;
  const minute = opts.minute ?? DEFAULT_MINUTE;
  const stdoutPath = opts.stdoutPath ?? join(opts.repoPath, ".janus", "logs", "systemd-out.log");
  const stderrPath = opts.stderrPath ?? join(opts.repoPath, ".janus", "logs", "systemd-err.log");
  const bunPath = opts.bunPath ?? (typeof process !== "undefined" ? process.execPath : "");

  // Si bunPath no es absoluto (caso raro), fallback a /usr/bin/env. systemd
  // sí respeta /usr/bin/env (más permisivo que launchd) pero seguimos prefiriendo
  // path absoluto para evitar sorpresas.
  const execStart = bunPath && bunPath.startsWith("/")
    ? `${bunPath} run ${opts.binPath} pulse`
    : `/usr/bin/env bun run ${opts.binPath} pulse`;

  const calendarHour = String(hour).padStart(2, "0");
  const calendarMinute = String(minute).padStart(2, "0");

  const service = `[Unit]
Description=Janus — daily pulse del maker
Documentation=https://github.com/crewtives/janus

[Service]
Type=oneshot
ExecStart=${execStart}
WorkingDirectory=${opts.repoPath}
StandardOutput=append:${stdoutPath}
StandardError=append:${stderrPath}
`;

  const timer = `[Unit]
Description=Janus daily pulse timer
Documentation=https://github.com/crewtives/janus

[Timer]
OnCalendar=*-*-* ${calendarHour}:${calendarMinute}:00
Persistent=true
Unit=${opts.label ?? DEFAULT_LABEL}.service

[Install]
WantedBy=timers.target
`;

  return { timer, service };
}

export function getUnitDir(): string {
  return join(homedir(), ".config", "systemd", "user");
}

export function getTimerPath(label: string = DEFAULT_LABEL): string {
  return join(getUnitDir(), `${label}.timer`);
}

export function getServicePath(label: string = DEFAULT_LABEL): string {
  return join(getUnitDir(), `${label}.service`);
}

export interface InstallOpts {
  /** No escribe ni invoca systemctl; solo reporta qué acción haría. */
  dryRun: boolean;
  /** Override del directorio target. Default: getUnitDir(). Útil para tests. */
  targetDir?: string;
  /** Si false, no llama systemctl (útil para tests). Default true. */
  reload?: boolean;
  /** Label del job. Default `janus`. */
  label?: string;
}

export type InstallAction = "installed" | "updated" | "unchanged";

export interface InstallResult {
  action: InstallAction;
  timerPath: string;
  servicePath: string;
  backupPaths?: { timer?: string; service?: string };
  /** true si `systemctl --user is-enabled <label>.timer` confirmó. */
  enabled?: boolean;
  /** stderr de systemctl si falló. */
  systemctlError?: string;
}

/**
 * Instala timer + service en `~/.config/systemd/user/`. Idempotente:
 *  - inexistente → "installed"
 *  - byte-equal → "unchanged" (no escribe, no llama systemctl)
 *  - diferente → backup .bak.<ts> + write + daemon-reload + restart
 */
export async function installUnits(
  units: RenderedUnits,
  opts: InstallOpts,
): Promise<InstallResult> {
  assertLinux();

  const label = opts.label ?? DEFAULT_LABEL;
  const dir = opts.targetDir ?? getUnitDir();
  const timerPath = join(dir, `${label}.timer`);
  const servicePath = join(dir, `${label}.service`);

  const timerExists = existsSync(timerPath);
  const serviceExists = existsSync(servicePath);
  const allExist = timerExists && serviceExists;

  let action: InstallAction;
  if (!timerExists && !serviceExists) {
    action = "installed";
  } else if (allExist) {
    const currentTimer = await readFile(timerPath, "utf-8");
    const currentService = await readFile(servicePath, "utf-8");
    action = currentTimer === units.timer && currentService === units.service ? "unchanged" : "updated";
  } else {
    // Caso parcial: uno existe y el otro no — tratar como update para
    // alinear ambos archivos.
    action = "updated";
  }

  if (opts.dryRun) {
    return { action, timerPath, servicePath };
  }

  if (action === "unchanged") {
    return { action, timerPath, servicePath };
  }

  await mkdir(dir, { recursive: true });

  const backupPaths: { timer?: string; service?: string } = {};
  const ts = Date.now();
  if (timerExists) {
    backupPaths.timer = `${timerPath}.bak.${ts}`;
    await copyFile(timerPath, backupPaths.timer);
  }
  if (serviceExists) {
    backupPaths.service = `${servicePath}.bak.${ts}`;
    await copyFile(servicePath, backupPaths.service);
  }

  await writeFile(timerPath, units.timer, "utf-8");
  await writeFile(servicePath, units.service, "utf-8");

  if (opts.reload === false) {
    return { action, timerPath, servicePath, backupPaths };
  }

  // Recarga + enable + start
  const reloadRes = await systemctl(["--user", "daemon-reload"]);
  if (reloadRes.exitCode !== 0) {
    return {
      action,
      timerPath,
      servicePath,
      backupPaths,
      enabled: false,
      systemctlError: `daemon-reload: ${reloadRes.stderr.trim()}`,
    };
  }

  const enableRes = await systemctl(["--user", "enable", "--now", `${label}.timer`]);
  if (enableRes.exitCode !== 0) {
    return {
      action,
      timerPath,
      servicePath,
      backupPaths,
      enabled: false,
      systemctlError: `enable --now: ${enableRes.stderr.trim()}`,
    };
  }

  const isEnabledRes = await systemctl(["--user", "is-enabled", `${label}.timer`]);
  const enabled = isEnabledRes.exitCode === 0;

  return {
    action,
    timerPath,
    servicePath,
    backupPaths,
    enabled,
    systemctlError: enabled ? undefined : `is-enabled exit ${isEnabledRes.exitCode}`,
  };
}

export interface UninstallResult {
  removed: boolean;
  timerPath: string;
  servicePath: string;
}

/** Disable + stop + delete del timer y service. Idempotente. */
export async function uninstallUnits(label: string = DEFAULT_LABEL): Promise<UninstallResult> {
  assertLinux();
  const timerPath = getTimerPath(label);
  const servicePath = getServicePath(label);

  const existed = existsSync(timerPath) || existsSync(servicePath);
  if (!existed) {
    return { removed: false, timerPath, servicePath };
  }

  // Best-effort disable + stop
  await systemctl(["--user", "disable", "--now", `${label}.timer`]);

  if (existsSync(timerPath)) await rm(timerPath);
  if (existsSync(servicePath)) await rm(servicePath);

  // daemon-reload para que systemd "olvide" el unit
  await systemctl(["--user", "daemon-reload"]);

  return { removed: true, timerPath, servicePath };
}

interface SystemctlResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function systemctl(args: string[]): Promise<SystemctlResult> {
  const proc = Bun.spawn(["systemctl", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return {
    exitCode: proc.exitCode ?? -1,
    stdout,
    stderr,
  };
}
