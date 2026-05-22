#!/usr/bin/env bun
/**
 * Migración del vault — Daily/{root,Weekly,Monthly,Quarterly,Yearly} → Timeline/.
 *
 * Hasta hoy Janus escribía todos los rollups temporales bajo `Daily/`:
 *
 *   Daily/
 *   ├── YYYY-MM-DD.md       (daily consolidado)
 *   ├── Weekly/<...>-week.md
 *   ├── Monthly/<...>-monthly.md
 *   ├── Quarterly/<...>.md
 *   └── Yearly/<...>-yearly.md
 *
 * Eso era deuda de diseño: un weekly NO es un daily. La nueva estructura los
 * agrupa bajo `Timeline/` como hermanos:
 *
 *   Timeline/
 *   ├── Daily/YYYY-MM-DD.md
 *   ├── Weekly/<...>-week.md
 *   ├── Monthly/<...>-monthly.md
 *   ├── Quarterly/<...>.md
 *   └── Yearly/<...>-yearly.md
 *
 * Este script mueve archivos del esquema viejo al nuevo. Idempotente: si el
 * archivo ya está en el path nuevo, skip. Si el path viejo NO existe, skip.
 *
 * Uso:
 *   bun run scripts/migrate-vault-timeline.ts            # mueve archivos
 *   bun run scripts/migrate-vault-timeline.ts --dry-run  # solo reporta
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../src/config/loader.ts";

const DRY_RUN = process.argv.includes("--dry-run");

interface Move {
  from: string;
  to: string;
}

async function listFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return await readdir(dir);
}

async function collectMoves(vaultPath: string): Promise<Move[]> {
  const moves: Move[] = [];
  const oldRoot = join(vaultPath, "Daily");
  if (!existsSync(oldRoot)) return moves;

  // 1. Dailies consolidados en Daily/<YYYY-MM-DD>.md → Timeline/Daily/
  const oldDailyRoot = oldRoot;
  const newDailyDir = join(vaultPath, "Timeline", "Daily");
  for (const name of await listFiles(oldDailyRoot)) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) continue;
    moves.push({ from: join(oldDailyRoot, name), to: join(newDailyDir, name) });
  }

  // 2. Subdirs: Daily/Weekly/, Daily/Monthly/, Daily/Quarterly/, Daily/Yearly/
  //    → Timeline/Weekly/, Timeline/Monthly/, etc.
  for (const sub of ["Weekly", "Monthly", "Quarterly", "Yearly"]) {
    const oldSub = join(oldRoot, sub);
    const newSub = join(vaultPath, "Timeline", sub);
    for (const name of await listFiles(oldSub)) {
      if (!name.endsWith(".md")) continue;
      moves.push({ from: join(oldSub, name), to: join(newSub, name) });
    }
  }

  return moves;
}

const config = await loadConfig();
console.log(`[migrate-timeline] vault: ${config.obsidianVault}`);
console.log(`[migrate-timeline] modo: ${DRY_RUN ? "DRY-RUN" : "ejecutando"}`);
console.log("");

const moves = await collectMoves(config.obsidianVault);
if (moves.length === 0) {
  console.log("[migrate-timeline] sin archivos para mover (vault ya migrado o sin rollups todavía)");
  process.exit(0);
}

let moved = 0;
let skipped = 0;

for (const m of moves) {
  if (existsSync(m.to)) {
    console.log(`  skip — ${m.to} ya existe`);
    skipped += 1;
    continue;
  }
  if (DRY_RUN) {
    console.log(`  would move — ${m.from} → ${m.to}`);
    continue;
  }
  await mkdir(join(m.to, ".."), { recursive: true });
  await rename(m.from, m.to);
  console.log(`  ✓ ${m.from} → ${m.to}`);
  moved += 1;
}

// Cleanup: si los directorios viejos quedaron vacíos, removerlos
if (!DRY_RUN) {
  const oldRoot = join(config.obsidianVault, "Daily");
  for (const sub of ["Weekly", "Monthly", "Quarterly", "Yearly"]) {
    const oldSub = join(oldRoot, sub);
    if (!existsSync(oldSub)) continue;
    const remaining = await listFiles(oldSub);
    if (remaining.length === 0) {
      await rm(oldSub, { recursive: true });
      console.log(`  ✓ removed empty dir: ${oldSub}`);
    }
  }
  // Si Daily/ quedó vacío también, remove
  if (existsSync(oldRoot)) {
    const remaining = await listFiles(oldRoot);
    if (remaining.length === 0) {
      await rm(oldRoot, { recursive: true });
      console.log(`  ✓ removed empty dir: ${oldRoot}`);
    }
  }
}

console.log("");
console.log(`[migrate-timeline] ${DRY_RUN ? "would-move" : "moved"} ${DRY_RUN ? moves.length - skipped : moved} archivos · ${skipped} skipped (ya existían)`);
