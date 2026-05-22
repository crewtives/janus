import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTldrFromPulse, loadDayLastYearAnchor, loadDayLastYearDaily, previousYearDate } from "../src/core/reflection/anchors.ts";

describe("reflection/anchors", () => {
  test("previousYearDate subtracts exactly 1 year", () => {
    expect(previousYearDate("2026-05-22")).toBe("2025-05-22");
    expect(previousYearDate("2026-02-29")).toBe("2025-02-29");
    expect(previousYearDate("invalid")).toBeNull();
  });

  test("extractTldrFromPulse extracts multi-line summary callout", () => {
    const md = `---
date: 2025-05-22
---
## TL;DR

> [!summary]+
> El día se centró en el lanzamiento de Phase 1.
> Se shippearon los 7 prompts y el MCP server.

## Shipped

> [!success] Shipped
> - cosa
`;
    const out = extractTldrFromPulse(md);
    expect(out).toContain("Phase 1");
    expect(out).toContain("MCP server");
    expect(out).not.toContain("Shipped");
    expect(out).not.toContain(">");
  });

  test("extractTldrFromPulse returns null when there is no summary callout", () => {
    const md = `# Pulse sin summary\n\nTexto suelto.`;
    expect(extractTldrFromPulse(md)).toBeNull();
  });

  test("extractTldrFromPulse accepts [!summary] without fold marker", () => {
    const md = `> [!summary]\n> Línea única del summary.`;
    expect(extractTldrFromPulse(md)).toBe("Línea única del summary.");
  });

  test("loadDayLastYearAnchor returns null when there is no pulse", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-anchor-"));
    const obsidianPath = join(dir, "Projects", "p");
    mkdirSync(join(obsidianPath, "pulse"), { recursive: true });
    const result = await loadDayLastYearAnchor({
      obsidianPath,
      project: "p",
      today: "2026-05-22",
    });
    expect(result).toBeNull();
  });

  test("loadDayLastYearAnchor finds the pulse and extracts TL;DR", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-anchor-"));
    const obsidianPath = join(dir, "Projects", "p");
    const pulseDir = join(obsidianPath, "pulse");
    mkdirSync(pulseDir, { recursive: true });
    writeFileSync(
      join(pulseDir, "2025-05-22-p.md"),
      `---
date: 2025-05-22
---
## TL;DR

> [!summary]+
> Día clave del shipping inicial.
`,
    );
    const result = await loadDayLastYearAnchor({
      obsidianPath,
      project: "p",
      today: "2026-05-22",
    });
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2025-05-22");
    expect(result!.tldr).toContain("shipping inicial");
    expect(result!.pulseFilename).toBe("2025-05-22-p");
  });

  test("loadDayLastYearAnchor also searches in _archive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-anchor-"));
    const obsidianPath = join(dir, "Projects", "p");
    const archiveDir = join(obsidianPath, "_archive", "2025-05");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, "2025-05-22-p.md"),
      `> [!summary]+\n> Archivado pero recuperable.\n`,
    );
    const result = await loadDayLastYearAnchor({
      obsidianPath,
      project: "p",
      today: "2026-05-22",
    });
    expect(result).not.toBeNull();
    expect(result!.tldr).toContain("Archivado pero recuperable");
  });

  test("loadDayLastYearDaily finds last year's consolidated daily", async () => {
    const dir = mkdtempSync(join(tmpdir(), "janus-anchor-"));
    const dailyDir = join(dir, "Timeline", "Daily");
    mkdirSync(dailyDir, { recursive: true });
    writeFileSync(
      join(dailyDir, "2025-05-22.md"),
      `## TL;DR\n> [!summary]+\n> Daily de hace un año.\n`,
    );
    const result = await loadDayLastYearDaily({
      vaultPath: dir,
      today: "2026-05-22",
    });
    expect(result).not.toBeNull();
    expect(result!.tldr).toContain("Daily de hace un año");
  });
});
