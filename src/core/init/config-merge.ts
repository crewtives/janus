import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { JanusConfig } from "../../config/types.ts";

/**
 * Helpers para el flow re-check del wizard: detectar config existente, computar diff
 * por campo, y escribir el config con backup atómico. Sin prompts — vive en U6.
 */

export type LoadStatus = "missing" | "valid" | "invalid";

export interface LoadResult {
  status: LoadStatus;
  /** Path absoluto al config.local.json (siempre cwd/config.local.json en init). */
  path: string;
  config?: JanusConfig;
  errors?: string[];
}

export function defaultConfigPath(cwd: string = process.cwd()): string {
  return resolve(cwd, "config.local.json");
}

/**
 * Lee y valida `cwd/config.local.json`. Devuelve status estructurado.
 * No usa loadConfig() de src/config/loader.ts porque ese aplica defaults y throwea —
 * acá necesitamos ver el config "crudo" para diffs significativos.
 */
export async function loadExistingConfig(cwd: string = process.cwd()): Promise<LoadResult> {
  const path = defaultConfigPath(cwd);
  if (!existsSync(path)) {
    return { status: "missing", path };
  }

  let raw: unknown;
  try {
    const text = await readFile(path, "utf-8");
    raw = JSON.parse(text);
  } catch (e) {
    return {
      status: "invalid",
      path,
      errors: [`JSON parse error: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const errors = validateConfigShape(raw);
  if (errors.length > 0) {
    return { status: "invalid", path, errors };
  }

  return { status: "valid", path, config: raw as JanusConfig };
}

function validateConfigShape(raw: unknown): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return ["config no es un objeto"];
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.obsidianVault !== "string" || !r.obsidianVault) {
    errors.push("obsidianVault es obligatorio (string no vacío)");
  }
  if (!Array.isArray(r.projects)) {
    errors.push("projects debe ser un array");
  } else if (r.projects.length === 0) {
    errors.push("projects[] no puede estar vacío");
  }
  return errors;
}

export type DiffStatus = "added" | "changed" | "removed" | "unchanged";

export interface FieldDiff {
  field: string;
  status: DiffStatus;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface ConfigDiff {
  added: FieldDiff[];
  changed: FieldDiff[];
  removed: FieldDiff[];
  unchanged: FieldDiff[];
}

/**
 * Diff por campo entre config existente y propuesto. Compara via deep-equal sobre JSON
 * (suficiente para nuestros tipos: strings, numbers, arrays, objetos planos).
 *
 * Si `existing` es null → todo va a `added`.
 * Para arrays (projects, discoverRoots), trata el array entero como un único campo —
 * el flow de proyectos va por `janus discover`, no por re-check.
 */
export function diffConfig(
  existing: JanusConfig | null,
  proposed: JanusConfig,
): ConfigDiff {
  const result: ConfigDiff = { added: [], changed: [], removed: [], unchanged: [] };

  if (existing === null) {
    for (const [field, value] of Object.entries(proposed)) {
      if (value === undefined) continue;
      result.added.push({ field, status: "added", newValue: value });
    }
    return result;
  }

  const allFields = new Set([
    ...Object.keys(existing),
    ...Object.keys(proposed),
  ]);

  const existingRec = existing as unknown as Record<string, unknown>;
  const proposedRec = proposed as unknown as Record<string, unknown>;
  for (const field of allFields) {
    const oldVal = existingRec[field];
    const newVal = proposedRec[field];

    if (oldVal === undefined && newVal !== undefined) {
      result.added.push({ field, status: "added", newValue: newVal });
    } else if (oldVal !== undefined && newVal === undefined) {
      result.removed.push({ field, status: "removed", oldValue: oldVal });
    } else if (deepEqual(oldVal, newVal)) {
      result.unchanged.push({ field, status: "unchanged", oldValue: oldVal });
    } else {
      result.changed.push({ field, status: "changed", oldValue: oldVal, newValue: newVal });
    }
  }

  return result;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface WriteOptions {
  /** Crea backup `.bak.<ts>` antes de sobrescribir si el contenido difiere. */
  backup: boolean;
}

export interface WriteResult {
  written: boolean;
  backupPath?: string;
}

/**
 * Escribe config a `target` con backup opcional. Idempotente:
 * - Si el target no existe → escribe, no crea backup.
 * - Si el target existe y el contenido es byte-equal al nuevo → no escribe, no backup.
 * - Si el target existe y difiere → backup + escribe (si `opts.backup`).
 *
 * Formato: JSON con 2-space indent + trailing newline (matcheo a config.example.json).
 *
 * NOTA: el patrón de backup `.bak.<ts>` está cubierto por .gitignore
 * (`config.local.*` matchea desde el commit 92fe82e).
 */
export async function writeConfig(
  target: string,
  config: JanusConfig,
  opts: WriteOptions,
): Promise<WriteResult> {
  const newContent = JSON.stringify(config, null, 2) + "\n";

  if (!existsSync(target)) {
    await writeFile(target, newContent, "utf-8");
    return { written: true };
  }

  const currentContent = await readFile(target, "utf-8");
  if (currentContent === newContent) {
    return { written: false };
  }

  let backupPath: string | undefined;
  if (opts.backup) {
    const ts = Date.now();
    backupPath = `${target}.bak.${ts}`;
    await copyFile(target, backupPath);
  }

  await writeFile(target, newContent, "utf-8");
  return { written: true, backupPath };
}
