#!/usr/bin/env bun
/**
 * Post-process determinista que repara la línea `Pulse anterior: ...` en
 * la sección `## Related` de cada pulse. Calcula el inmediato anterior
 * leyendo los filenames del directorio `pulse/` — sin LLM, sin costo.
 *
 * Por qué existe: el LLM con status=idle a veces alucina la frase
 * (e.g. "Pulse anterior: (sin pulse anterior en la ventana disponible)")
 * en lugar de copiar el wiki-link literal del template. También a veces
 * el LLM linkea al filename equivocado. Este script normaliza todo desde
 * el filesystem (que es la fuente de verdad).
 *
 * Idempotente: si la línea ya es la canónica para ese pulse, no la toca.
 *
 * También sincroniza la línea "Hub: [[<project>]]" si quedó mal escrita.
 *
 * Uso:
 *   bun run scripts/fix-pulse-anterior-links.ts            # repara y reporta
 *   bun run scripts/fix-pulse-anterior-links.ts --dry-run  # solo reporta
 *   bun run scripts/fix-pulse-anterior-links.ts --project NAME
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../src/config/loader.ts";
import type { ProjectConfig } from "../src/config/types.ts";

interface CliArgs {
  dryRun: boolean;
  project: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let dryRun = false;
  let project: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--project") project = args[++i] ?? null;
  }
  return { dryRun, project };
}

interface FixResult {
  pulseFile: string;
  changed: boolean;
  reason: string;
}

/**
 * Reescribe la línea "Pulse anterior: ..." en la sección ## Related con
 * el wiki-link canónico para `expectedPrev`. Si `expectedPrev` es null
 * (primer pulse del proyecto), escribe la línea fallback del template.
 *
 * También repara la línea "Hub: [[<project>]]" si está rota.
 *
 * Retorna { newContent, changed, reason }.
 */
export function fixRelatedSection(
  content: string,
  expectedPrevFilename: string | null,
  projectName: string,
): { content: string; changed: boolean; reason: string } {
  const lines = content.split("\n");

  // Encontrar la sección "## Related"
  const relatedIdx = lines.findIndex((l) => /^##\s+Related\b/.test(l));
  if (relatedIdx === -1) {
    return { content, changed: false, reason: "sin sección ## Related" };
  }

  // Rango de la sección: desde "## Related" hasta el próximo H2/H3 o un
  // callout (> [!...]) que abre la sección siguiente.
  let endIdx = lines.length;
  for (let i = relatedIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s+/.test(line) || /^>\s*\[!/.test(line) || /^```/.test(line)) {
      endIdx = i;
      break;
    }
  }

  // Buscar la línea "Pulse anterior" (puede estar con "- Pulse anterior:" o
  // con la frase fallback "- (sin pulse anterior en la bóveda...)").
  const canonicalPrev = expectedPrevFilename
    ? `- Pulse anterior: [[${expectedPrevFilename}]]`
    : `- (sin pulse anterior en la bóveda — primer pulse del proyecto o gap)`;

  const canonicalHub = `- Hub: [[${projectName}]]`;

  let prevLineIdx = -1;
  let hubLineIdx = -1;
  for (let i = relatedIdx + 1; i < endIdx; i++) {
    const line = lines[i]!;
    if (/^[-*]\s*Hub:\s*/i.test(line)) {
      hubLineIdx = i;
    } else if (
      /^[-*]\s*Pulse anterior:/i.test(line) ||
      /^[-*]\s*\(sin pulse anterior/i.test(line)
    ) {
      prevLineIdx = i;
    }
  }

  let changed = false;
  const reasons: string[] = [];

  if (hubLineIdx !== -1 && lines[hubLineIdx] !== canonicalHub) {
    lines[hubLineIdx] = canonicalHub;
    changed = true;
    reasons.push("hub");
  }

  if (prevLineIdx === -1) {
    // No había línea de pulse anterior en absoluto — la agregamos justo
    // después del hub si existe, sino después del heading Related.
    const insertAt = hubLineIdx !== -1 ? hubLineIdx + 1 : relatedIdx + 1;
    lines.splice(insertAt, 0, canonicalPrev);
    changed = true;
    reasons.push("agregado prev");
  } else if (lines[prevLineIdx] !== canonicalPrev) {
    lines[prevLineIdx] = canonicalPrev;
    changed = true;
    reasons.push(expectedPrevFilename ? "fix wiki-link" : "fix sin-prev");
  }

  return {
    content: lines.join("\n"),
    changed,
    reason: reasons.join(", ") || "ya canónico",
  };
}

async function fixProject(
  project: ProjectConfig,
  dryRun: boolean,
): Promise<{ scanned: number; changed: number; results: FixResult[] }> {
  const pulseDir = join(project.obsidianPath, "pulse");
  if (!existsSync(pulseDir)) {
    return { scanned: 0, changed: 0, results: [] };
  }

  const entries = await readdir(pulseDir);
  const pulseFiles = entries
    .filter((f) => f.endsWith(".md"))
    .filter((f) => /^\d{4}-\d{2}-\d{2}-/.test(f))
    .sort(); // ascendente cronológico

  const results: FixResult[] = [];
  let changedCount = 0;

  for (let i = 0; i < pulseFiles.length; i++) {
    const filename = pulseFiles[i]!;
    const filePath = join(pulseDir, filename);
    const content = await readFile(filePath, "utf-8");

    const prevFilename = i > 0 ? pulseFiles[i - 1]!.replace(/\.md$/, "") : null;

    const fix = fixRelatedSection(content, prevFilename, project.name);

    if (fix.changed) {
      changedCount += 1;
      if (!dryRun) {
        await writeFile(filePath, fix.content);
      }
    }

    results.push({
      pulseFile: filename,
      changed: fix.changed,
      reason: fix.reason,
    });
  }

  return { scanned: pulseFiles.length, changed: changedCount, results };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const config = await loadConfig();

  const projects = args.project
    ? config.projects.filter((p) => p.name === args.project)
    : config.projects;

  if (projects.length === 0) {
    console.error(`[fix-prev] sin proyectos${args.project ? ` (filtro: ${args.project})` : ""}`);
    process.exit(1);
  }

  console.log(`[fix-prev] ${args.dryRun ? "DRY-RUN" : "ejecutando"} sobre ${projects.length} proyectos`);
  console.log("");

  let totalScanned = 0;
  let totalChanged = 0;

  for (const project of projects) {
    const r = await fixProject(project, args.dryRun);
    totalScanned += r.scanned;
    totalChanged += r.changed;
    if (r.scanned === 0) {
      console.log(`  ${project.name}: sin pulses`);
      continue;
    }
    const tag = r.changed > 0 ? (args.dryRun ? "would fix" : "fixed") : "OK";
    console.log(`  ${project.name}: ${r.scanned} pulses · ${tag} ${r.changed}`);
    for (const res of r.results.filter((x) => x.changed)) {
      console.log(`    · ${res.pulseFile} → ${res.reason}`);
    }
  }

  console.log("");
  console.log(`[fix-prev] ${args.dryRun ? "would-fix" : "fixed"} ${totalChanged}/${totalScanned} pulses`);
}

// Solo correr cuando se invoca como CLI, no cuando es import desde un test.
if (import.meta.main) {
  await main();
}
