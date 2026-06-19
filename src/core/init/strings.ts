/**
 * Bilingual string registry for the `janus init` wizard.
 *
 * The wizard supports English (default) and Spanish. The user is asked to
 * choose at the start of the wizard, and the preference is persisted to
 * `config.language` for subsequent re-checks.
 *
 * This module ONLY localizes the wizard UX. Generated pulse content stays
 * in English (the prompts are EN-only).
 */

export type Language = "en" | "es";

export interface WizardStrings {
  // Intro + setup
  intro: string;
  setupNote: (cwd: string) => string;
  setupTitle: string;
  languagePrompt: string;
  languageEnglish: string;
  languageSpanish: string;

  // Config detection
  configInvalidHeader: string;
  configInvalidPrompt: string;
  configStartFresh: string;
  configAbortFix: string;
  configCancelled: string;
  configExisting: (count: number) => string;
  configNone: string;

  // Auth step
  authChecking: string;
  authMaxActive: (email: string) => string;
  authNotMaxWarn: (plan: string) => string;
  authFailedWarn: string;
  authWhatNow: string;
  authRetry: string;
  authContinueAnyway: string;
  authAbort: string;
  authAborted: string;

  // Vault step
  vaultCurrent: (path: string) => string;
  vaultKeep: (path: string) => string;
  vaultWantScan: string;
  vaultScanning: string;
  vaultScanResult: (dirs: number, ms: number, reason: string) => string;
  vaultChoose: string;
  vaultOtherPath: string;
  vaultNoneDetected: string;
  vaultManualPath: string;
  vaultManualPlaceholder: string;
  vaultEnterPath: string;
  vaultDoesNotExist: (path: string) => string;

  // Projects step
  projectsCurrent: (names: string) => string;
  projectsCurrentNote: (count: number) => string;
  projectsWhatNow: string;
  projectsKeep: string;
  projectsAddMore: string;
  projectsReplace: string;
  projectsNeedOne: string;
  projectsWantDiscover: string;
  projectsScanning: string;
  projectsScanResult: (count: number) => string;
  projectsScanError: (error: string) => string;
  projectsChoose: string;
  projectsNoneDetected: string;
  projectsManualRepo: string;
  projectsManualRepoPlaceholder: string;
  projectsRepoEnterPath: string;
  projectsRepoNotExist: (path: string) => string;
  projectsRepoNotGit: (path: string) => string;
  projectsNameLabel: string;
  projectsObsidianPathLabel: string;
  projectsSelected: (count: number) => string;
  projectsAddAnother: string;
  projectsAnother: string;

  // Discord step
  discordCurrent: (url: string) => string;
  discordKeep: (url: string) => string;
  discordWant: string;
  discordUrlLabel: string;
  discordTestPing: string;
  discordPingSending: string;
  discordPingOk: (status: number) => string;
  discordPingFailed: (error: string) => string;
  discordPingContinueAnyway: string;

  // Confirm config
  confirmConfigTitle: string;
  confirmConfigPrompt: string;
  confirmDiffTitle: string;
  confirmDiffPrompt: string;
  confirmNoChanges: string;

  // Scheduler step
  schedulerUnsupported: (platform: string, detail: string) => string;
  schedulerLaunchdPrompt: string;
  schedulerSystemdPrompt: string;
  schedulerHourLabel: string;
  schedulerMinuteLabel: string;
  schedulerHourInvalid: string;
  schedulerMinuteInvalid: string;

  // Skill step
  skillPrompt: string;
  skillInstalled: (target: string) => string;
  skillNoSource: string;
  skillConflict: (target: string) => string;

  // Commit step
  commitConfigWritten: (path: string) => string;
  commitBackupNote: (path: string) => string;
  commitPlistInstalled: (path: string) => string;
  commitPlistFailed: (error: string) => string;

  // Validate step
  validateRunning: string;
  validateOk: string;
  validateFailed: (errors: string) => string;

  // Outro
  outroSuccess: (firstPulseCmd: string) => string;
  outroPartial: string;
}

const EN: WizardStrings = {
  intro: "🌙 Janus onboarding",
  setupNote: (cwd) =>
    `Current directory: ${cwd}\nConfig will be written to config.local.json.`,
  setupTitle: "Setup",
  languagePrompt: "Language / Idioma?",
  languageEnglish: "English",
  languageSpanish: "Español",

  configInvalidHeader: "An existing config.local.json was found but it's invalid:",
  configInvalidPrompt: "What now?",
  configStartFresh: "Start fresh (backup the existing one)",
  configAbortFix: "Abort and fix it manually",
  configCancelled: "Wizard cancelled — nothing was written.",
  configExisting: (count) =>
    `Existing config detected (${count} projects). Re-check mode enabled.`,
  configNone: "No previous config — fresh setup.",

  authChecking: "Verifying Claude auth (timeout 10s)…",
  authMaxActive: (email) => `Claude Max active · ${email}`,
  authNotMaxWarn: (plan) =>
    `Logged in but the plan is not Max (plan: ${plan}). Janus works best with Max.`,
  authFailedWarn:
    "Not logged in or `claude auth status` failed / timed out. Run `claude /login` and try again.",
  authWhatNow: "What now?",
  authRetry: "Retry",
  authContinueAnyway: "Continue anyway (you'll have to fix this later)",
  authAbort: "Abort",
  authAborted: "Wizard cancelled — nothing was written.",

  vaultCurrent: (path) => `Current vault: ${path}`,
  vaultKeep: (path) => `Current vault: ${path}. Keep it?`,
  vaultWantScan: "Should I scan common directories looking for Obsidian vaults?",
  vaultScanning: "Scanning ~/Documents, ~/iCloud Drive/Documents, ~/Obsidian… (max 5s)",
  vaultScanResult: (dirs, ms, reason) => `Scan: ${dirs} dirs in ${ms}ms (${reason})`,
  vaultChoose: "Pick your Obsidian vault:",
  vaultOtherPath: "Other path (enter manually)",
  vaultNoneDetected: "No vaults detected in common directories. Enter the path manually.",
  vaultManualPath: "Absolute path to your Obsidian vault:",
  vaultManualPlaceholder: "~/Obsidian",
  vaultEnterPath: "Enter a path",
  vaultDoesNotExist: (path) => `Doesn't exist: ${path}`,

  projectsCurrent: (names) => `Current projects: ${names}`,
  projectsCurrentNote: (count) => `Current projects: ${count}. Keeping them.`,
  projectsWhatNow: "What to do with the projects?",
  projectsKeep: "Keep as is",
  projectsAddMore: "Add more (via `janus discover` after the wizard)",
  projectsReplace: "Replace (start from scratch)",
  projectsNeedOne: "You need at least one project for Janus to have something to monitor.",
  projectsWantDiscover:
    "Should I use `discoverProjects` to detect git repos in common directories (~/projects)?",
  projectsScanning: "Scanning git repos…",
  projectsScanResult: (count) => `${count} repos detected`,
  projectsScanError: (error) => `discoverProjects failed: ${error}`,
  projectsChoose: "Pick the projects to include:",
  projectsNoneDetected: "No new repos detected. Add them manually.",
  projectsManualRepo: "Absolute path to the git repo:",
  projectsManualRepoPlaceholder: "~/projects/myorg/myrepo",
  projectsRepoEnterPath: "Enter a path",
  projectsRepoNotExist: (path) => `Doesn't exist: ${path}`,
  projectsRepoNotGit: (path) => `Not a git repo: ${path}`,
  projectsNameLabel: "Project name (for the config):",
  projectsObsidianPathLabel: "Path inside the Obsidian vault for this project:",
  projectsSelected: (count) => `${count} project(s) selected. Add another manually?`,
  projectsAddAnother: "Add another?",
  projectsAnother: "Another?",

  discordCurrent: (url) => `Current Discord webhook: ${url}`,
  discordKeep: (url) => `Current Discord webhook: ${url}. Keep it?`,
  discordWant: "Set up a Discord webhook for nightly notifications? (optional)",
  discordUrlLabel: "Webhook URL (https://discord.com/api/webhooks/...):",
  discordTestPing: "Send a test message to the channel? (visible to all channel members)",
  discordPingSending: "Sending test ping…",
  discordPingOk: (status) => `Ping ✓ (HTTP ${status})`,
  discordPingFailed: (error) => `Ping failed: ${error}`,
  discordPingContinueAnyway: "Continue anyway with this URL?",

  confirmConfigTitle: "Config to write",
  confirmConfigPrompt: "Write this config?",
  confirmDiffTitle: "Config changes",
  confirmDiffPrompt: "Apply these changes?",
  confirmNoChanges: "Config unchanged — nothing to write.",

  schedulerUnsupported: (platform, detail) =>
    `Platform ${platform} has no supported scheduler — skipping. ${detail}`,
  schedulerLaunchdPrompt:
    "Schedule a daily run with launchd? (default 10:00 — macOS does not recover runs missed during sleep)",
  schedulerSystemdPrompt:
    "Schedule a daily run with a systemd-user timer? (default 10:00 — Persistent=true recovers runs missed)",
  schedulerHourLabel: "Hour (0-23):",
  schedulerMinuteLabel: "Minute (0-59):",
  schedulerHourInvalid: "Must be an integer between 0 and 23",
  schedulerMinuteInvalid: "Must be an integer between 0 and 59",

  skillPrompt:
    "Install the /daily-pulse skill for Claude Code? (symlinks skill/ into ~/.claude/skills so you can run Janus from any session)",
  skillInstalled: (target) => `Skill installed: ${target} (try /daily-pulse in Claude Code)`,
  skillNoSource:
    "Skipping the /daily-pulse skill: no skill/ dir here (binary-only install). Clone the repo and run scripts/install-skill.sh to add it.",
  skillConflict: (target) =>
    `${target} already exists and isn't a symlink — left untouched. Remove it and re-run if you want the skill.`,

  commitConfigWritten: (path) => `Config written to ${path}`,
  commitBackupNote: (path) => `Backup of the previous config: ${path}`,
  commitPlistInstalled: (path) => `Scheduler installed: ${path}`,
  commitPlistFailed: (error) => `Scheduler install failed: ${error}`,

  validateRunning: "Running `janus doctor`…",
  validateOk: "All checks passed.",
  validateFailed: (errors) => `Validation failed:\n${errors}`,

  outroSuccess: (cmd) =>
    `You're all set. To generate your first pulse:\n\n  ${cmd}\n\nIf you installed the scheduler, the next run will fire automatically.`,
  outroPartial: "Wizard finished, but some checks failed. Review the warnings above.",
};

const ES: WizardStrings = {
  intro: "🌙 Janus onboarding",
  setupNote: (cwd) =>
    `Directorio actual: ${cwd}\nEl config se escribirá en config.local.json.`,
  setupTitle: "Setup",
  languagePrompt: "Language / Idioma?",
  languageEnglish: "English",
  languageSpanish: "Español",

  configInvalidHeader: "Existe config.local.json pero no es válido:",
  configInvalidPrompt: "¿Qué hacés?",
  configStartFresh: "Empezar de cero (backup del existente)",
  configAbortFix: "Abortar y arreglarlo a mano",
  configCancelled: "Wizard cancelado, no se escribió nada.",
  configExisting: (count) =>
    `Config existente detectado (${count} proyectos). Re-check mode activado.`,
  configNone: "Sin config previo — fresh setup.",

  authChecking: "Verificando Claude auth (timeout 10s)…",
  authMaxActive: (email) => `Claude Max activo · ${email}`,
  authNotMaxWarn: (plan) =>
    `Logueado pero el plan no es Max (plan: ${plan}). Janus funciona mejor con Max.`,
  authFailedWarn:
    "No logueado o `claude auth status` falló/timeout. Corré `claude /login` y volvé a intentar.",
  authWhatNow: "¿Qué hacés?",
  authRetry: "Reintentar",
  authContinueAnyway: "Continuar igual (vas a tener que arreglarlo después)",
  authAbort: "Abortar",
  authAborted: "Wizard cancelado, no se escribió nada.",

  vaultCurrent: (path) => `Vault actual: ${path}`,
  vaultKeep: (path) => `Vault actual: ${path}. ¿Mantener?`,
  vaultWantScan: "¿Querés que escanee directorios comunes buscando bóvedas Obsidian?",
  vaultScanning: "Escaneando ~/Documents, ~/iCloud Drive/Documents, ~/Obsidian… (max 5s)",
  vaultScanResult: (dirs, ms, reason) => `Scan: ${dirs} dirs en ${ms}ms (${reason})`,
  vaultChoose: "Elegí tu bóveda Obsidian:",
  vaultOtherPath: "Otra ruta (ingresar manualmente)",
  vaultNoneDetected:
    "No se detectaron bóvedas en directorios comunes. Ingresá la ruta manualmente.",
  vaultManualPath: "Ruta absoluta a tu bóveda Obsidian:",
  vaultManualPlaceholder: "~/Obsidian",
  vaultEnterPath: "Ingresá una ruta",
  vaultDoesNotExist: (path) => `No existe: ${path}`,

  projectsCurrent: (names) => `Proyectos actuales: ${names}`,
  projectsCurrentNote: (count) => `Proyectos actuales: ${count}. Manteniendo.`,
  projectsWhatNow: "¿Qué hacés con los proyectos?",
  projectsKeep: "Mantener tal cual",
  projectsAddMore: "Agregar más (vía `janus discover` después del wizard)",
  projectsReplace: "Reemplazar (empezar de cero)",
  projectsNeedOne:
    "Necesitás al menos un proyecto para que Janus tenga algo que monitorear.",
  projectsWantDiscover:
    "¿Querés que use `discoverProjects` para detectar repos git en directorios comunes (~/projects)?",
  projectsScanning: "Escaneando repos git…",
  projectsScanResult: (count) => `${count} repos detectados`,
  projectsScanError: (error) => `discoverProjects falló: ${error}`,
  projectsChoose: "Elegí los proyectos a incluir:",
  projectsNoneDetected: "Ningún repo nuevo detectado. Agregalos manualmente.",
  projectsManualRepo: "Ruta absoluta al repo git:",
  projectsManualRepoPlaceholder: "~/projects/myorg/myrepo",
  projectsRepoEnterPath: "Ingresá una ruta",
  projectsRepoNotExist: (path) => `No existe: ${path}`,
  projectsRepoNotGit: (path) => `No es un repo git: ${path}`,
  projectsNameLabel: "Nombre del proyecto (para el config):",
  projectsObsidianPathLabel: "Path en la bóveda Obsidian para este proyecto:",
  projectsSelected: (count) => `${count} proyecto(s) seleccionados. ¿Agregar otro manual?`,
  projectsAddAnother: "¿Agregar otro?",
  projectsAnother: "¿Otro?",

  discordCurrent: (url) => `Discord webhook actual: ${url}`,
  discordKeep: (url) => `Discord webhook actual: ${url}. ¿Mantener?`,
  discordWant: "¿Configurar webhook de Discord para notificaciones nocturnas? (opcional)",
  discordUrlLabel: "URL del webhook (https://discord.com/api/webhooks/...):",
  discordTestPing:
    "¿Enviar un mensaje de prueba al canal? (será visible para todos los miembros del canal)",
  discordPingSending: "Enviando ping de prueba…",
  discordPingOk: (status) => `Ping ✓ (HTTP ${status})`,
  discordPingFailed: (error) => `Ping falló: ${error}`,
  discordPingContinueAnyway: "¿Continuar igual con esta URL?",

  confirmConfigTitle: "Config a escribir",
  confirmConfigPrompt: "¿Escribir este config?",
  confirmDiffTitle: "Cambios al config",
  confirmDiffPrompt: "¿Aplicar estos cambios?",
  confirmNoChanges: "Config sin cambios — nada que escribir.",

  schedulerUnsupported: (platform, detail) =>
    `Sistema ${platform} sin scheduler soportado — skip. ${detail}`,
  schedulerLaunchdPrompt:
    "¿Programar corrida diaria con launchd? (default 10:00 — macOS no recupera runs perdidos por sleep)",
  schedulerSystemdPrompt:
    "¿Programar corrida diaria con systemd-user timer? (default 10:00 — Persistent=true recupera runs perdidos)",
  schedulerHourLabel: "Hora (0-23):",
  schedulerMinuteLabel: "Minuto (0-59):",
  schedulerHourInvalid: "Tiene que ser un entero entre 0 y 23",
  schedulerMinuteInvalid: "Tiene que ser un entero entre 0 y 59",

  skillPrompt:
    "¿Instalar la skill /daily-pulse para Claude Code? (symlinkea skill/ en ~/.claude/skills para correr Janus desde cualquier sesión)",
  skillInstalled: (target) => `Skill instalada: ${target} (probá /daily-pulse en Claude Code)`,
  skillNoSource:
    "Salteando la skill /daily-pulse: no hay dir skill/ acá (instalación solo-binario). Cloná el repo y corré scripts/install-skill.sh para agregarla.",
  skillConflict: (target) =>
    `${target} ya existe y no es un symlink — sin tocar. Borralo y volvé a correr si querés la skill.`,

  commitConfigWritten: (path) => `Config escrito en ${path}`,
  commitBackupNote: (path) => `Backup del anterior: ${path}`,
  commitPlistInstalled: (path) => `Scheduler instalado: ${path}`,
  commitPlistFailed: (error) => `Scheduler install falló: ${error}`,

  validateRunning: "Corriendo `janus doctor`…",
  validateOk: "Todos los chequeos pasaron.",
  validateFailed: (errors) => `Validación falló:\n${errors}`,

  outroSuccess: (cmd) =>
    `Listo. Para generar tu primer pulse:\n\n  ${cmd}\n\nSi instalaste el scheduler, la próxima corrida se dispara automáticamente.`,
  outroPartial:
    "Wizard terminó, pero algunos chequeos fallaron. Revisá los warnings arriba.",
};

export function loadStrings(lang: Language): WizardStrings {
  return lang === "es" ? ES : EN;
}

/**
 * Auto-detect language from environment locale. Falls back to "en".
 * - LANG=es_ES.UTF-8 → "es"
 * - LANG=en_US.UTF-8 → "en"
 * - LANG unset → "en"
 */
export function detectLanguage(): Language {
  const locale = process.env["LANG"] ?? process.env["LC_ALL"] ?? process.env["LC_MESSAGES"] ?? "";
  return locale.toLowerCase().startsWith("es") ? "es" : "en";
}
