import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Genera + instala plists de launchd para Janus. macOS-only — en otros OS
 * todas las funciones throwean con mensaje claro.
 *
 * Default label: com.crewtives.janus. Constante hardcodeada para evitar
 * cualquier riesgo de path-traversal via label (fix indirecto del finding
 * S5 del doc review — la analysis está documentada acá).
 */

export const DEFAULT_LABEL = "com.crewtives.janus";
export const DEFAULT_HOUR = 10; // 10am — likely-awake (fix A5 del doc review,
                                  // ver renderPlist docstring)
export const DEFAULT_MINUTE = 0;

function assertMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error(`launchd es macOS-only (actualmente: ${process.platform})`);
  }
}

export interface RenderPlistOpts {
  /** Label del job. Default `com.crewtives.janus`. */
  label?: string;
  /** Path absoluto al bin/janus.ts del repo. */
  binPath: string;
  /** Path absoluto al repo (WorkingDirectory). */
  repoPath: string;
  /** Hora (0-23). Default 10. */
  hour?: number;
  /** Minuto (0-59). Default 0. */
  minute?: number;
  /** Path absoluto donde escribir stdout. Default `<repoPath>/.janus/logs/launchd-out.log`. */
  stdoutPath?: string;
  /** Path absoluto donde escribir stderr. Default `<repoPath>/.janus/logs/launchd-err.log`. */
  stderrPath?: string;
  /**
   * Path absoluto al binary de bun. Default: `process.execPath` (correcto cuando
   * el caller corre bajo bun, que es siempre en Janus).
   *
   * Por qué necesario: launchd hereda PATH minimal (sin /opt/homebrew/bin ni
   * /usr/local/bin). Si el plist usa `/usr/bin/env bun`, falla con
   * "env: bun: No such file or directory" en cualquier Mac donde bun esté
   * instalado vía Homebrew. Hardcodear `/opt/homebrew/bin` tampoco sirve en
   * Intel Macs. Path absoluto via process.execPath es la solución correcta.
   */
  bunPath?: string;
}

/**
 * Genera el XML del plist con escaping XML completo para todos los string values
 * (fix S2 del doc review: paths con `< > & " '` produciría plist malformado o,
 * peor, sería parseado como ProgramArguments extras ejecutados con privilegios
 * de usuario nightly).
 *
 * Decisión de A5 del doc review: default a las 10am en vez de las 4am porque
 * launchd NO cataches up `StartCalendarInterval` runs que se perdieron por sleep.
 * El usuario puede igual elegir otra hora desde el wizard.
 */
export function renderPlist(opts: RenderPlistOpts): string {
  const label = opts.label ?? DEFAULT_LABEL;
  const hour = opts.hour ?? DEFAULT_HOUR;
  const minute = opts.minute ?? DEFAULT_MINUTE;
  const stdoutPath = opts.stdoutPath ?? join(opts.repoPath, ".janus", "logs", "launchd-out.log");
  const stderrPath = opts.stderrPath ?? join(opts.repoPath, ".janus", "logs", "launchd-err.log");
  const bunPath = opts.bunPath ?? (typeof process !== "undefined" ? process.execPath : "");

  // Si tenemos path absoluto a bun, lo usamos directo. Si no (caso raro), caemos
  // al wrapper /usr/bin/env bun, que funciona solo si bun está en el PATH de
  // launchd — frágil pero compatible con el comportamiento histórico.
  const programArgs = bunPath && bunPath.startsWith("/")
    ? [bunPath, "run", opts.binPath, "pulse"]
    : ["/usr/bin/env", "bun", "run", opts.binPath, "pulse"];

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTD/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs.map((a) => `    <string>${xmlEscape(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(opts.repoPath)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Path absoluto donde va el plist. macOS-only. */
export function getPlistPath(label: string = DEFAULT_LABEL): string {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

export interface InstallOpts {
  /** No escribe ni invoca launchctl; solo reporta qué acción haría. */
  dryRun: boolean;
  /** Override del path target. Default: getPlistPath(label). Útil para tests. */
  targetPath?: string;
  /** Si false, no llama launchctl (útil para tests). Default true. */
  reload?: boolean;
}

export type InstallAction = "installed" | "updated" | "unchanged";

export interface InstallResult {
  action: InstallAction;
  path: string;
  backupPath?: string;
  /** Verificación post-load. true si `launchctl list <label>` confirmó el load. */
  loaded?: boolean;
  /** Stderr de launchctl si falló. */
  launchctlError?: string;
}

/**
 * Instala el plist en `~/Library/LaunchAgents/`. Idempotente:
 * - target inexistente → action: "installed"
 * - target byte-equal al nuevo → action: "unchanged" (no escribe, no llama launchctl)
 * - target diferente → backup .bak.<ts> + write + unload+load
 *
 * Con `dryRun: true`: no escribe, no llama launchctl, retorna qué acción haría.
 */
export async function installPlist(
  content: string,
  opts: InstallOpts,
): Promise<InstallResult> {
  assertMacOS();

  const label = extractLabel(content) ?? DEFAULT_LABEL;
  const path = opts.targetPath ?? getPlistPath(label);

  let action: InstallAction;
  if (!existsSync(path)) {
    action = "installed";
  } else {
    const current = await readFile(path, "utf-8");
    action = current === content ? "unchanged" : "updated";
  }

  if (opts.dryRun) {
    return { action, path };
  }

  if (action === "unchanged") {
    return { action, path };
  }

  // Asegurar que el directorio existe
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (!existsSync(dir)) {
    await Bun.write(join(dir, ".keep"), "");
  }

  let backupPath: string | undefined;
  if (action === "updated") {
    backupPath = `${path}.bak.${Date.now()}`;
    await copyFile(path, backupPath);
  }

  await writeFile(path, content, "utf-8");

  if (opts.reload === false) {
    return { action, path, backupPath };
  }

  // Best-effort unload (puede no estar cargado), luego load, luego verificar
  await launchctl(["unload", path]); // ignora resultado
  const loadRes = await launchctl(["load", path]);
  if (loadRes.exitCode !== 0) {
    return {
      action,
      path,
      backupPath,
      loaded: false,
      launchctlError: loadRes.stderr.trim() || `load exit ${loadRes.exitCode}`,
    };
  }

  // Verificar que el label aparece en launchctl list
  const listRes = await launchctl(["list", label]);
  const loaded = listRes.exitCode === 0;

  return {
    action,
    path,
    backupPath,
    loaded,
    launchctlError: loaded ? undefined : `launchctl list ${label} exit ${listRes.exitCode}`,
  };
}

export interface UninstallResult {
  removed: boolean;
  path: string;
}

/** Unload + delete del plist. Idempotente: si no existe, removed:false sin throw. */
export async function uninstallPlist(label: string = DEFAULT_LABEL): Promise<UninstallResult> {
  assertMacOS();
  const path = getPlistPath(label);
  if (!existsSync(path)) {
    return { removed: false, path };
  }
  await launchctl(["unload", path]); // best-effort
  const { rm } = await import("node:fs/promises");
  await rm(path);
  return { removed: true, path };
}

function extractLabel(content: string): string | null {
  // <key>Label</key>\n  <string>com.crewtives.janus</string>
  const m = content.match(/<key>Label<\/key>\s*<string>([^<]+)<\/string>/);
  return m && m[1] ? m[1].trim() : null;
}

interface LaunchctlResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function launchctl(args: string[]): Promise<LaunchctlResult> {
  const proc = Bun.spawn(["launchctl", ...args], {
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
