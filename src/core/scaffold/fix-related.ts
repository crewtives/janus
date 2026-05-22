/**
 * Post-process determinista que repara la línea `Pulse anterior: ...` en
 * la sección `## Related` de cada pulse. Calcula el inmediato anterior
 * leyendo los filenames del directorio `pulse/` — sin LLM, sin costo.
 *
 * Por qué existe: el LLM con status=idle a veces alucina la frase
 * (e.g. "Pulse anterior: (sin pulse anterior en la ventana disponible)")
 * en lugar de copiar el wiki-link literal del template. También a veces
 * el LLM linkea al filename equivocado. Este módulo normaliza todo desde
 * el filesystem (que es la fuente de verdad).
 *
 * Idempotente: si la línea ya es la canónica para ese pulse, no la toca.
 *
 * También sincroniza la línea "Hub: [[<project>]]" si quedó mal escrita.
 *
 * Importable in-process desde el orchestrator. El thin wrapper en
 * `scripts/fix-pulse-anterior-links.ts` mantiene la invocación CLI standalone.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../config/loader.ts";
import type { JanusConfig, ProjectConfig } from "../../config/types.ts";

export interface FixResult {
  pulseFile: string;
  changed: boolean;
  reason: string;
}

export interface FixProjectResult {
  scanned: number;
  changed: number;
  results: FixResult[];
}

export interface FixAllOptions {
  dryRun?: boolean;
  config?: JanusConfig;
  projectFilter?: string | null;
}

export interface FixAllResult {
  totalScanned: number;
  totalChanged: number;
  perProject: Array<{ project: string; result: FixProjectResult }>;
}

/**
 * Reescribe la línea "Pulse anterior: ..." en la sección ## Related con
 * el wiki-link canónico para `expectedPrev`. Si `expectedPrev` es null
 * (primer pulse del proyecto), escribe la línea fallback del template.
 *
 * También repara la línea "Hub: [[<project>]]" si está rota.
 */
export function fixRelatedSection(
  content: string,
  expectedPrevFilename: string | null,
  projectName: string,
): { content: string; changed: boolean; reason: string } {
  const lines = content.split("\n");

  const relatedIdx = lines.findIndex((l) => /^##\s+Related\b/.test(l));
  if (relatedIdx === -1) {
    return { content, changed: false, reason: "sin sección ## Related" };
  }

  let endIdx = lines.length;
  for (let i = relatedIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s+/.test(line) || /^>\s*\[!/.test(line) || /^```/.test(line)) {
      endIdx = i;
      break;
    }
  }

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

export async function fixProject(
  project: ProjectConfig,
  dryRun: boolean,
): Promise<FixProjectResult> {
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

export async function fixAllRelated(opts: FixAllOptions = {}): Promise<FixAllResult> {
  const config = opts.config ?? (await loadConfig());
  const dryRun = opts.dryRun ?? false;
  const projectFilter = opts.projectFilter ?? null;

  const projects = projectFilter
    ? config.projects.filter((p) => p.name === projectFilter)
    : config.projects;

  let totalScanned = 0;
  let totalChanged = 0;
  const perProject: Array<{ project: string; result: FixProjectResult }> = [];

  for (const project of projects) {
    const result = await fixProject(project, dryRun);
    totalScanned += result.scanned;
    totalChanged += result.changed;
    perProject.push({ project: project.name, result });
  }

  return { totalScanned, totalChanged, perProject };
}
