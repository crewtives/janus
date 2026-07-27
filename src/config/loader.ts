import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { JanusConfig } from "./types.ts";
import {
  defaultModelSettings,
  PROVIDER_IDS,
  type ProviderId,
} from "./providers.ts";

function configPaths(): string[] {
  return [
    resolve(process.cwd(), "config.local.json"),
    resolve(homedir(), ".janus/config.json"),
  ];
}

export async function loadConfig(explicitPath?: string): Promise<JanusConfig> {
  const paths = explicitPath ? [resolve(explicitPath)] : configPaths();
  const path = paths.find((p) => existsSync(p));
  if (!path) {
    throw new Error(
      `No config found. Expected one of:\n  ${paths.join("\n  ")}\n\nCopy config.example.json to config.local.json and edit the paths.`,
    );
  }
  const raw = await Bun.file(path).json();
  return applyDefaults(raw);
}

function applyDefaults(raw: Partial<JanusConfig>): JanusConfig {
  if (!raw.obsidianVault) throw new Error("config: obsidianVault is required");
  if (!raw.projects?.length) throw new Error("config: projects[] is empty");

  const provider = parseProvider(raw.provider, "claude-code");
  const providerDefaults = defaultModelSettings(provider);
  return {
    obsidianVault: expandHome(raw.obsidianVault),
    projects: raw.projects.map((p) => ({
      ...p,
      repoPath: expandHome(p.repoPath),
      obsidianPath: expandHome(p.obsidianPath),
      status: p.status ?? "active",
    })),
    discoverRoots: raw.discoverRoots?.map(expandHome),
    discord: raw.discord,
    concurrency: raw.concurrency ?? 2,
    intervalCap: raw.intervalCap ?? 5,
    intervalMs: raw.intervalMs ?? 60_000,
    taskTimeoutMs: raw.taskTimeoutMs ?? 30 * 60_000,
    stateDir: expandHome(raw.stateDir ?? resolve(process.cwd(), ".janus")),
    model: raw.model ?? providerDefaults.model,
    effort: raw.effort ?? providerDefaults.effort,
    fallbackModel: raw.fallbackModel ?? providerDefaults.fallbackModel,
    provider,
    fallbackProvider: parseProvider(raw.fallbackProvider, undefined),
    privacy: {
      enabled: raw.privacy?.enabled ?? true,
      disablePatterns: raw.privacy?.disablePatterns,
      extraPatterns: raw.privacy?.extraPatterns,
      allowList: raw.privacy?.allowList,
      collapsePaths: raw.privacy?.collapsePaths ?? true,
    },
    integrations: raw.integrations,
  };
}

function parseProvider<T extends ProviderId | undefined>(
  v: unknown,
  fallback: T,
): T extends undefined ? ProviderId | undefined : ProviderId {
  if (v === undefined || v === null) return fallback as ProviderId | undefined as ReturnType<typeof parseProvider<T>>;
  if (typeof v !== "string") {
    throw new Error(`config: provider/fallbackProvider must be a string, received ${typeof v}`);
  }
  if (!(PROVIDER_IDS as readonly string[]).includes(v)) {
    throw new Error(
      `config: provider "${v}" invalid. Options: ${PROVIDER_IDS.join(", ")}`,
    );
  }
  return v as ProviderId as ReturnType<typeof parseProvider<T>>;
}

export function expandHome(path: string): string {
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}
