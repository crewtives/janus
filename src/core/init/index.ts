import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { DiscordConfig, JanusConfig, ProjectConfig } from "../../config/types.ts";
import { discoverProjects, renderProjectEntry } from "../discover.ts";
import { runDoctor, validateDiscordWebhook } from "../doctor.ts";
import {
  defaultConfigPath,
  diffConfig,
  loadExistingConfig,
  writeConfig,
} from "./config-merge.ts";
import {
  defaultVaultSearchRoots,
  detectClaudeAuth,
  detectObsidianVaults,
  testDiscordWebhook,
} from "./detect.ts";
import { DEFAULT_HOUR, DEFAULT_MINUTE } from "./scheduler.ts";
import { detectLanguage, loadStrings, type Language, type WizardStrings } from "./strings.ts";

/**
 * Janus onboarding wizard. Takes the user from "repo cloned" to "first pulse
 * generated and validated". Idempotent: if config already exists, enters
 * re-check mode and proposes only what's missing or changed.
 *
 * Design:
 * - Transactional: nothing is written to disk until the final commit step.
 *   If the user cancels mid-wizard, nothing persists. Documented exceptions:
 *   the Discord test-ping (real POST, confirmed) and `claude auth status`
 *   (read-only subprocess).
 * - The first question chooses the wizard UI language (EN/ES). It's auto-
 *   detected from $LANG and offered as default. The choice is persisted to
 *   `config.language` for re-checks.
 */

export interface WizardState {
  mode: "fresh" | "recheck";
  cwd: string;
  configPath: string;
  existingConfig: JanusConfig | null;
  vaultPath: string;
  projects: ProjectConfig[];
  discoverRoots?: string[];
  discord?: DiscordConfig;
  installLaunchd: boolean;
  launchdHour: number;
  launchdMinute: number;
  /** UI language for the wizard. Persisted to config.language. */
  language: Language;
  /** Localized strings for the wizard, loaded from `language`. */
  s: WizardStrings;
  /** The proposed config to be written at the end. */
  proposedConfig?: JanusConfig;
}

export interface RunInitOptions {
  yes: boolean;
  /** Explicit language override. If unset, auto-detected and confirmed. */
  language?: Language;
}

export async function runInit(opts: RunInitOptions): Promise<number> {
  const cwd = process.cwd();

  // ─── Step 0: pick language (or accept auto-detected default) ──────────────────
  // The intro is intentionally bilingual so the first user-facing line is
  // never wrong regardless of the user's locale.
  intro("🌙 Janus onboarding");

  // Try existing config first — if it has a `language` set, honor it.
  const existingLoad = await loadExistingConfig(cwd);
  const existingLang: Language | undefined = (existingLoad.config?.language === "es" || existingLoad.config?.language === "en")
    ? existingLoad.config.language
    : undefined;

  const language: Language = await chooseLanguage({
    initialLang: opts.language ?? existingLang ?? detectLanguage(),
    auto: opts.yes,
  });
  const s = loadStrings(language);

  note(s.setupNote(cwd), s.setupTitle);

  // ─── Step 1: detect existing config ────────────────────────────────────────
  let state: WizardState;

  if (existingLoad.status === "invalid") {
    log.error(s.configInvalidHeader);
    for (const err of existingLoad.errors ?? []) log.error(`  · ${err}`);
    const decision = await select({
      message: s.configInvalidPrompt,
      options: [
        { value: "fresh", label: s.configStartFresh },
        { value: "abort", label: s.configAbortFix },
      ],
    });
    if (isCancel(decision) || decision === "abort") {
      cancel(s.configCancelled);
      return 1;
    }
    state = newState(cwd, existingLoad.path, "fresh", null, language, s);
  } else if (existingLoad.status === "valid") {
    state = newState(cwd, existingLoad.path, "recheck", existingLoad.config ?? null, language, s);
    log.success(s.configExisting(existingLoad.config?.projects.length ?? 0));
  } else {
    state = newState(cwd, existingLoad.path, "fresh", null, language, s);
    log.info(s.configNone);
  }

  // ─── Step 2: auth check ────────────────────────────────────────────────────
  if (await stepAuth(state) === "abort") return 1;

  // ─── Step 3: vault ─────────────────────────────────────────────────────────
  if (await stepVault(state, opts) === "abort") return 1;

  // ─── Step 4: projects ──────────────────────────────────────────────────────
  if (await stepProjects(state, opts) === "abort") return 1;

  // ─── Step 5: discord (optional) ────────────────────────────────────────────
  if (await stepDiscord(state, opts) === "abort") return 1;

  // ─── Step 6: build proposed config + diff + confirm ────────────────────────
  state.proposedConfig = buildProposedConfig(state);
  if (await stepConfirmConfig(state, opts) === "abort") return 1;

  // ─── Step 7: scheduler opt-in ──────────────────────────────────────────────
  if (await stepLaunchd(state) === "abort") return 1;

  // ─── Step 8: COMMIT — write config + install plist ─────────────────────────
  await commit(state);

  // ─── Step 9: validate with doctor + optional dry-run ───────────────────────
  await stepValidate(state);

  // ─── Outro ─────────────────────────────────────────────────────────────────
  outro(buildOutroMessage(state));
  return 0;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function chooseLanguage(opts: { initialLang: Language; auto: boolean }): Promise<Language> {
  if (opts.auto) return opts.initialLang;
  const choice = await select({
    message: "Language / Idioma?",
    options: [
      { value: "en", label: "English" },
      { value: "es", label: "Español" },
    ],
    initialValue: opts.initialLang,
  });
  if (isCancel(choice)) return opts.initialLang;
  return choice as Language;
}

function newState(
  cwd: string,
  configPath: string,
  mode: "fresh" | "recheck",
  existingConfig: JanusConfig | null,
  language: Language,
  s: WizardStrings,
): WizardState {
  return {
    mode,
    cwd,
    configPath,
    existingConfig,
    vaultPath: existingConfig?.obsidianVault ?? "",
    projects: existingConfig?.projects ?? [],
    discoverRoots: existingConfig?.discoverRoots,
    discord: existingConfig?.discord,
    installLaunchd: false,
    launchdHour: DEFAULT_HOUR,
    launchdMinute: DEFAULT_MINUTE,
    language,
    s,
  };
}

// ─── Step 2: auth ─────────────────────────────────────────────────────────────
async function stepAuth(state: WizardState): Promise<"continue" | "abort"> {
  const { s } = state;
  const sp = spinner();
  sp.start(s.authChecking);
  const status = await detectClaudeAuth();
  sp.stop();

  if (status && status.loggedIn && status.subscriptionType === "max") {
    log.success(s.authMaxActive(status.email ?? "?"));
    return "continue";
  }

  if (status && status.loggedIn) {
    log.warn(s.authNotMaxWarn(status.subscriptionType ?? "?"));
  } else {
    log.warn(s.authFailedWarn);
  }

  const choice = await select({
    message: s.authWhatNow,
    options: [
      { value: "retry", label: s.authRetry },
      { value: "continue", label: s.authContinueAnyway },
      { value: "abort", label: s.authAbort },
    ],
  });
  if (isCancel(choice) || choice === "abort") {
    cancel(s.authAborted);
    return "abort";
  }
  if (choice === "retry") return stepAuth(state);
  return "continue";
}

// ─── Step 3: vault ────────────────────────────────────────────────────────────
async function stepVault(state: WizardState, opts: RunInitOptions): Promise<"continue" | "abort"> {
  const { s } = state;
  if (state.mode === "recheck" && state.vaultPath && existsSync(state.vaultPath)) {
    if (opts.yes) {
      log.info(s.vaultCurrent(state.vaultPath));
      return "continue";
    }
    const change = await confirm({
      message: s.vaultKeep(state.vaultPath),
      initialValue: true,
    });
    if (isCancel(change)) return abortWizard(state);
    if (change === true) return "continue";
  }

  const wantScan = await confirm({
    message: s.vaultWantScan,
    initialValue: true,
  });
  if (isCancel(wantScan)) return abortWizard(state);

  if (wantScan) {
    const sp = spinner();
    sp.start(s.vaultScanning);
    const result = await detectObsidianVaults(defaultVaultSearchRoots());
    sp.stop(s.vaultScanResult(result.dirsScanned, result.elapsedMs, result.reason));

    if (result.vaults.length > 0) {
      const vaultOpts = [
        ...result.vaults.map((v) => ({ value: v, label: v })),
        { value: "__manual__", label: s.vaultOtherPath },
      ];
      const choice = await select({ message: s.vaultChoose, options: vaultOpts });
      if (isCancel(choice)) return abortWizard(state);
      if (choice !== "__manual__") {
        state.vaultPath = choice as string;
        return "continue";
      }
    } else {
      log.info(s.vaultNoneDetected);
    }
  }

  const path = await text({
    message: s.vaultManualPath,
    placeholder: s.vaultManualPlaceholder,
    validate(value) {
      const expanded = expandTilde((value ?? "").trim());
      if (!expanded) return s.vaultEnterPath;
      if (!existsSync(expanded)) return s.vaultDoesNotExist(expanded);
      return undefined;
    },
  });
  if (isCancel(path)) return abortWizard(state);
  state.vaultPath = expandTilde((path as string).trim());
  return "continue";
}

// ─── Step 4: projects ─────────────────────────────────────────────────────────
async function stepProjects(state: WizardState, opts: RunInitOptions): Promise<"continue" | "abort"> {
  const { s } = state;
  if (state.mode === "recheck" && state.projects.length > 0) {
    if (opts.yes) {
      log.info(s.projectsCurrentNote(state.projects.length));
      return "continue";
    }
    log.info(s.projectsCurrent(state.projects.map((p) => p.name).join(", ")));
    const choice = await select({
      message: s.projectsWhatNow,
      options: [
        { value: "keep", label: s.projectsKeep },
        { value: "add", label: s.projectsAddMore },
        { value: "replace", label: s.projectsReplace },
      ],
    });
    if (isCancel(choice)) return abortWizard(state);
    if (choice === "keep" || choice === "add") return "continue";
    state.projects = [];
  }

  log.info(s.projectsNeedOne);

  const tentativeConfig = buildProposedConfig(state);
  const wantDiscover = await confirm({
    message: s.projectsWantDiscover,
    initialValue: true,
  });
  if (isCancel(wantDiscover)) return abortWizard(state);

  if (wantDiscover) {
    const sp = spinner();
    sp.start(s.projectsScanning);
    let discovered: Awaited<ReturnType<typeof discoverProjects>>;
    try {
      discovered = await discoverProjects({ config: tentativeConfig });
      sp.stop(s.projectsScanResult(discovered.discovered.length));
    } catch (e) {
      sp.stop(s.projectsScanError(e instanceof Error ? e.message : String(e)));
      discovered = { discovered: [], alreadyConfigured: [], roots: [], rootsInferred: true };
    }

    if (discovered.discovered.length > 0) {
      const choices = discovered.discovered.map((d) => ({
        value: d.repoPath,
        label: `${d.name} (${d.repoPath})`,
      }));
      const selected = await selectMany(s.projectsChoose, choices);
      if (selected === null) return abortWizard(state);
      for (const repoPath of selected) {
        const d = discovered.discovered.find((x) => x.repoPath === repoPath)!;
        const entry = renderProjectEntry(d, state.vaultPath);
        state.projects.push({
          name: entry.name ?? d.name,
          repoPath: entry.repoPath ?? d.repoPath,
          obsidianPath: entry.obsidianPath ?? d.obsidianPath,
          status: "active",
        });
      }
    } else {
      log.info(s.projectsNoneDetected);
    }
  }

  while (state.projects.length === 0) {
    const ok = await addProjectManual(state);
    if (!ok) return abortWizard(state);
  }

  if (state.projects.length > 0) {
    const more = await confirm({
      message: s.projectsSelected(state.projects.length),
      initialValue: false,
    });
    if (isCancel(more)) return abortWizard(state);
    while (more === true) {
      const ok = await addProjectManual(state);
      if (!ok) return abortWizard(state);
      const again = await confirm({ message: s.projectsAnother, initialValue: false });
      if (isCancel(again) || again === false) break;
    }
  }

  return "continue";
}

async function addProjectManual(state: WizardState): Promise<boolean> {
  const { s } = state;
  const repoPath = await text({
    message: s.projectsManualRepo,
    placeholder: s.projectsManualRepoPlaceholder,
    validate(value) {
      const exp = expandTilde((value ?? "").trim());
      if (!exp) return s.projectsRepoEnterPath;
      if (!existsSync(exp)) return s.projectsRepoNotExist(exp);
      if (!existsSync(`${exp}/.git`)) return s.projectsRepoNotGit(exp);
      return undefined;
    },
  });
  if (isCancel(repoPath)) return false;

  const absRepoPath = expandTilde((repoPath as string).trim());
  const segments = absRepoPath.split("/").filter(Boolean);
  const defaultName = segments.slice(-2).join("-");

  const name = await text({
    message: s.projectsNameLabel,
    placeholder: defaultName,
    defaultValue: defaultName,
  });
  if (isCancel(name)) return false;

  const projectName = (name as string).trim() || defaultName;
  const defaultObsPath = `${state.vaultPath}/Projects/${segments.slice(-2).join("/")}`;
  const obsidianPath = await text({
    message: s.projectsObsidianPathLabel,
    placeholder: defaultObsPath,
    defaultValue: defaultObsPath,
  });
  if (isCancel(obsidianPath)) return false;

  state.projects.push({
    name: projectName,
    repoPath: absRepoPath,
    obsidianPath: (obsidianPath as string).trim() || defaultObsPath,
    status: "active",
  });
  return true;
}

// ─── Step 5: Discord ──────────────────────────────────────────────────────────
async function stepDiscord(state: WizardState, opts: RunInitOptions): Promise<"continue" | "abort"> {
  const { s } = state;
  if (state.mode === "recheck" && state.discord?.webhookUrl) {
    if (opts.yes) {
      log.info(s.discordCurrent(maskUrl(state.discord.webhookUrl)));
      return "continue";
    }
    const keep = await confirm({
      message: s.discordKeep(maskUrl(state.discord.webhookUrl)),
      initialValue: true,
    });
    if (isCancel(keep)) return abortWizard(state);
    if (keep === true) return "continue";
  }

  const want = await confirm({
    message: s.discordWant,
    initialValue: false,
  });
  if (isCancel(want)) return abortWizard(state);
  if (want !== true) {
    state.discord = undefined;
    return "continue";
  }

  let url: string;
  while (true) {
    const input = await text({
      message: s.discordUrlLabel,
      validate(value) {
        const r = validateDiscordWebhook((value ?? "").trim());
        return r.ok ? undefined : r.detail;
      },
    });
    if (isCancel(input)) return abortWizard(state);
    url = (input as string).trim();
    break;
  }

  const ping = await confirm({
    message: s.discordTestPing,
    initialValue: true,
  });
  if (isCancel(ping)) return abortWizard(state);

  if (ping === true) {
    const sp = spinner();
    sp.start(s.discordPingSending);
    const result = await testDiscordWebhook(url);
    sp.stop();
    if (result.ok) {
      log.success(s.discordPingOk(result.status ?? 0));
    } else {
      log.warn(s.discordPingFailed(result.error ?? `HTTP ${result.status ?? "?"}`));
      const continueAnyway = await confirm({
        message: s.discordPingContinueAnyway,
        initialValue: false,
      });
      if (isCancel(continueAnyway) || continueAnyway === false) return abortWizard(state);
    }
  }

  state.discord = { webhookUrl: url, username: "Janus" };
  return "continue";
}

// ─── Step 6: confirm config ───────────────────────────────────────────────────
async function stepConfirmConfig(state: WizardState, opts: RunInitOptions): Promise<"continue" | "abort"> {
  const { s } = state;
  const proposed = state.proposedConfig!;

  if (state.mode === "fresh") {
    note(formatConfigSummary(proposed), s.confirmConfigTitle);
    if (opts.yes) return "continue";
    const ok = await confirm({ message: s.confirmConfigPrompt, initialValue: true });
    if (isCancel(ok) || ok === false) return abortWizard(state);
    return "continue";
  }

  const diff = diffConfig(state.existingConfig, proposed);
  if (diff.changed.length === 0 && diff.added.length === 0 && diff.removed.length === 0) {
    log.success(s.confirmNoChanges);
    state.proposedConfig = state.existingConfig ?? proposed;
    return "continue";
  }

  note(formatDiffSummary(diff), s.confirmDiffTitle);
  if (opts.yes) return "continue";
  const ok = await confirm({ message: s.confirmDiffPrompt, initialValue: true });
  if (isCancel(ok) || ok === false) return abortWizard(state);
  return "continue";
}

// ─── Step 7: scheduler opt-in (launchd on macOS / systemd-user on Linux) ─────
async function stepLaunchd(state: WizardState): Promise<"continue" | "abort"> {
  const { s } = state;
  const { detectScheduler, describeScheduler } = await import("./scheduler.ts");
  const kind = detectScheduler();

  if (kind === "unsupported") {
    log.info(s.schedulerUnsupported(process.platform, describeScheduler()));
    state.installLaunchd = false;
    return "continue";
  }

  const message = kind === "launchd" ? s.schedulerLaunchdPrompt : s.schedulerSystemdPrompt;

  const want = await confirm({
    message,
    initialValue: true,
  });
  if (isCancel(want)) return abortWizard(state);
  if (want !== true) {
    state.installLaunchd = false;
    return "continue";
  }

  const hour = await text({
    message: s.schedulerHourLabel,
    placeholder: String(DEFAULT_HOUR),
    defaultValue: String(DEFAULT_HOUR),
    validate(value) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 23) return s.schedulerHourInvalid;
      return undefined;
    },
  });
  if (isCancel(hour)) return abortWizard(state);

  const minute = await text({
    message: s.schedulerMinuteLabel,
    placeholder: String(DEFAULT_MINUTE),
    defaultValue: String(DEFAULT_MINUTE),
    validate(value) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 59) return s.schedulerMinuteInvalid;
      return undefined;
    },
  });
  if (isCancel(minute)) return abortWizard(state);

  state.installLaunchd = true;
  state.launchdHour = Number(hour);
  state.launchdMinute = Number(minute);
  return "continue";
}

// ─── Step 8: COMMIT — write config + install plist ────────────────────────────
async function commit(state: WizardState): Promise<void> {
  const { s } = state;
  const target = state.configPath;
  const proposed = state.proposedConfig!;

  const writeRes = await writeConfig(target, proposed, { backup: state.existingConfig !== null });
  if (writeRes.written) {
    log.success(s.commitConfigWritten(target));
    if (writeRes.backupPath) log.info(s.commitBackupNote(writeRes.backupPath));
  } else {
    log.info(s.confirmNoChanges);
  }

  if (state.installLaunchd) {
    const binPath = resolve(state.cwd, "bin", "janus.ts");
    const { installScheduler } = await import("./scheduler.ts");
    const sp = spinner();
    sp.start("Installing nightly scheduler…");
    const result = await installScheduler({
      binPath,
      repoPath: state.cwd,
      hour: state.launchdHour,
      minute: state.launchdMinute,
    });
    sp.stop();
    const kindName = result.kind === "launchd" ? "launchd" : result.kind === "systemd" ? "systemd-user" : result.kind;
    if (result.action === "unchanged") {
      log.info(`${kindName} unchanged: ${result.paths.join(", ")}`);
    } else if (result.action === "skipped-unsupported") {
      log.warn(result.error ?? "Scheduler not supported on this platform");
    } else {
      log.success(s.commitPlistInstalled(`${kindName}: ${result.paths.join(", ")}`));
    }
    if (result.loaded === false) {
      log.error(s.commitPlistFailed(result.error ?? "?"));
      if (result.kind === "launchd") {
        log.warn("You can run `launchctl load -w ~/Library/LaunchAgents/com.crewtives.janus.plist` manually.");
      } else if (result.kind === "systemd") {
        log.warn("You can run `systemctl --user enable --now janus.timer` manually.");
      }
    } else if (result.loaded === true) {
      log.success(`Verified: ${kindName} scheduler loaded and enabled`);
    }
  }
}

// ─── Step 9: validate ─────────────────────────────────────────────────────────
async function stepValidate(state: WizardState): Promise<void> {
  const { s } = state;
  log.info(s.validateRunning);
  const ok = await runDoctor();

  if (!ok) {
    log.warn("Doctor reported failures above. Setup was still written; review and fix.");
  } else {
    log.success(s.validateOk);
  }

  if (state.projects.length === 0) return;
  const want = await confirm({
    message: `Run 'pulse --dry-run' against '${state.projects[0]!.name}' to validate the prompt?`,
    initialValue: true,
  });
  if (isCancel(want) || want !== true) return;

  log.info("Running pulse --dry-run…");
  try {
    const { runPulse } = await import("../../pipeline/orchestrator.ts");
    await runPulse({
      project: state.projects[0]!.name,
      dryRun: true,
    });
    log.success("Dry-run completed. Check the rendered prompt above.");
  } catch (e) {
    log.warn(`Dry-run failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildProposedConfig(state: WizardState): JanusConfig {
  const existing = state.existingConfig;
  return {
    obsidianVault: state.vaultPath,
    projects: state.projects,
    discoverRoots: state.discoverRoots ?? existing?.discoverRoots,
    discord: state.discord,
    concurrency: existing?.concurrency ?? 2,
    intervalCap: existing?.intervalCap ?? 5,
    intervalMs: existing?.intervalMs ?? 60_000,
    taskTimeoutMs: existing?.taskTimeoutMs ?? 30 * 60_000,
    stateDir: existing?.stateDir ?? resolve(state.cwd, ".janus"),
    model: existing?.model ?? "sonnet",
    effort: existing?.effort ?? "xhigh",
    fallbackModel: existing?.fallbackModel ?? "opus",
    language: state.language,
  };
}

function expandTilde(path: string): string {
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

function maskUrl(url: string): string {
  if (url.length < 40) return "***";
  return `${url.slice(0, 35)}…${url.slice(-6)}`;
}

function formatConfigSummary(cfg: JanusConfig): string {
  const lines = [
    `Vault:     ${cfg.obsidianVault}`,
    `Projects:  ${cfg.projects.length} (${cfg.projects.map((p) => p.name).join(", ")})`,
  ];
  if (cfg.discord?.webhookUrl) lines.push(`Discord:   ${maskUrl(cfg.discord.webhookUrl)}`);
  if (cfg.discoverRoots?.length) lines.push(`Discover:  ${cfg.discoverRoots.join(", ")}`);
  lines.push(`Model:     ${cfg.model} (fallback: ${cfg.fallbackModel}, effort: ${cfg.effort})`);
  if (cfg.language) lines.push(`Language:  ${cfg.language}`);
  return lines.join("\n");
}

function formatDiffSummary(diff: ReturnType<typeof diffConfig>): string {
  const lines: string[] = [];
  for (const f of diff.added) lines.push(`+ ${f.field}: ${formatValue(f.newValue)}`);
  for (const f of diff.changed) {
    lines.push(`~ ${f.field}: ${formatValue(f.oldValue)} → ${formatValue(f.newValue)}`);
  }
  for (const f of diff.removed) lines.push(`- ${f.field}: ${formatValue(f.oldValue)}`);
  if (diff.unchanged.length > 0) {
    lines.push(``);
    lines.push(`Unchanged: ${diff.unchanged.map((f) => f.field).join(", ")}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(no changes)";
}

function formatValue(v: unknown): string {
  if (v === undefined) return "(unset)";
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === "object") return "{...}";
  return String(v);
}

function buildOutroMessage(state: WizardState): string {
  const lines = ["Janus is ready. Next steps:"];
  lines.push("  · bun janus pulse                  — generate pulses now");
  lines.push("  · bun janus discover               — detect new projects");
  lines.push("  · bun janus discover --apply       — add them to the config");
  if (state.installLaunchd) {
    lines.push(`  · scheduler runs nightly at ${pad(state.launchdHour)}:${pad(state.launchdMinute)}`);
    lines.push(`  · logs in .janus/logs/launchd-{out,err}.log`);
  }
  lines.push("  · docs/ARCHITECTURE.md              — how it all works");
  return lines.join("\n");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function abortWizard(state: WizardState): "abort" {
  cancel(state.s.configCancelled);
  return "abort";
}

/**
 * select-many helper based on N confirm calls — clack 1.x has a native multiselect
 * but its UX on long confirmation flows is sometimes confusing. We keep this
 * simple: ask yes/no for each candidate.
 */
async function selectMany<T extends string>(
  prompt: string,
  options: Array<{ value: T; label: string }>,
): Promise<T[] | null> {
  log.info(prompt);
  const selected: T[] = [];
  for (const opt of options) {
    const pick = await confirm({ message: `  · ${opt.label}`, initialValue: true });
    if (isCancel(pick)) return null;
    if (pick === true) selected.push(opt.value);
  }
  return selected;
}
