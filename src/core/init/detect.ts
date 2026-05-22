import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getClaudeAuthStatus, type ClaudeAuthStatus } from "../doctor.ts";

/**
 * Funciones puras de detección que usa el wizard. Sin prompts — solo I/O y subprocess.
 * Los prompts viven en src/core/init/index.ts (U6).
 */

// Bounds del vault scan (fix de A1 del doc review):
// depth=3 alone es insuficiente sobre ~/Documents con iCloud — sumamos
// hard count budget + wall-clock timeout + excluded dirs amplios.
const VAULT_SCAN_MAX_DIRS = 5000;
const VAULT_SCAN_TIMEOUT_MS = 5_000;
const VAULT_SCAN_MAX_DEPTH = 3;
const VAULT_SCAN_EXCLUDED = new Set([
  // Build artifacts
  "node_modules", "dist", "build", "out", ".next", ".cache",
  ".turbo", ".nx", "coverage", "target",
  // Language envs
  ".venv", "venv", "__pycache__", ".pytest_cache", "Pods", "DerivedData",
  // Editor/IDE
  ".idea", ".vscode", ".git",
  // macOS noise
  "Library", "Applications", ".Trash", "Pictures", "Movies", "Music",
  // Package caches
  ".npm", ".bun", ".cargo", ".rustup", ".docker", ".kube",
  // Janus internals
  "_archive",
]);

export interface VaultScanResult {
  vaults: string[];
  /** Razón por la que paró el scan. `complete` = visitó todo el árbol acotado. */
  reason: "complete" | "timeout" | "max-dirs";
  dirsScanned: number;
  elapsedMs: number;
}

/**
 * Roots por default donde buscar `.obsidian/`. El usuario puede pasar otros via param.
 * No incluye `~` raw — eso desborda con cosas tipo `Library/` aun con excludes.
 */
export function defaultVaultSearchRoots(): string[] {
  const home = homedir();
  return [
    join(home, "Documents"),
    join(home, "iCloud Drive", "Documents"),
    join(home, "Obsidian"),
    join(home, "Notes"),
    join(home, "vault"),
    join(home, "vaults"),
  ];
}

/** Wrap de getClaudeAuthStatus de doctor.ts. Hereda timeout 10s. */
export async function detectClaudeAuth(): Promise<ClaudeAuthStatus | null> {
  return getClaudeAuthStatus();
}

/**
 * BFS bounded buscando carpetas con `.obsidian/` adentro.
 * No recursa dentro de un vault una vez detectado, ni dentro de excluded dirs.
 * Skip symlinks para no entrar en loops.
 */
export async function detectObsidianVaults(
  searchRoots: string[] = defaultVaultSearchRoots(),
): Promise<VaultScanResult> {
  const start = performance.now();
  const vaults: string[] = [];
  let dirsScanned = 0;
  let reason: VaultScanResult["reason"] = "complete";

  const queue: Array<{ path: string; depth: number }> = searchRoots
    .filter(existsSync)
    .map((root) => ({ path: root, depth: 0 }));

  while (queue.length > 0) {
    if (performance.now() - start > VAULT_SCAN_TIMEOUT_MS) {
      reason = "timeout";
      break;
    }
    if (dirsScanned >= VAULT_SCAN_MAX_DIRS) {
      reason = "max-dirs";
      break;
    }

    const { path, depth } = queue.shift()!;
    dirsScanned++;

    if (existsSync(join(path, ".obsidian"))) {
      vaults.push(path);
      // No descender dentro de un vault detectado
      continue;
    }

    if (depth >= VAULT_SCAN_MAX_DEPTH) continue;

    try {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.isSymbolicLink()) continue;
        if (VAULT_SCAN_EXCLUDED.has(entry.name)) continue;
        // Dot-dirs skip excepto `.obsidian` (que ya se chequea como marker)
        if (entry.name.startsWith(".")) continue;
        queue.push({ path: join(path, entry.name), depth: depth + 1 });
      }
    } catch {
      // permission denied, ENOENT, etc — skip silenciosamente
    }
  }

  // Dedup (raro pero posible si hay symlinks no-detectados que apuntan al mismo target real)
  const unique = [...new Set(vaults)];

  return {
    vaults: unique,
    reason,
    dirsScanned,
    elapsedMs: Math.round(performance.now() - start),
  };
}

export interface WebhookTestResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * POST de test al webhook de Discord. Best-effort, no throwea.
 * IMPORTANTE: este mensaje aparece en el canal real. El wizard debe confirmar opt-in antes.
 */
export async function testDiscordWebhook(url: string): Promise<WebhookTestResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "🌙 Janus init: ping de prueba ✓ (este mensaje confirma que el webhook funciona)",
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text.slice(0, 200) };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
