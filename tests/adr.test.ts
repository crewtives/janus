import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdr, listAdrs, promoteDecisionToAdr } from "../src/core/adr.ts";

async function emptyVault(): Promise<{ vaultPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "janus-adr-"));
  const vaultPath = join(dir, "vault");
  await mkdir(vaultPath, { recursive: true });
  return { vaultPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("createAdr", () => {
  test("creates ADR-001 with default frontmatter + sections", async () => {
    const { vaultPath, cleanup } = await emptyVault();
    const r = await createAdr({ vaultPath, title: "Adoptar Bun + SQLite", project: "janus" });
    expect(r.number).toBe(1);
    expect(r.filename).toBe("ADR-001-adoptar-bun-sqlite");
    const content = await readFile(r.path, "utf-8");
    expect(content).toContain("number: 1");
    expect(content).toContain('title: "Adoptar Bun + SQLite"');
    expect(content).toContain("status: accepted");
    expect(content).toContain("project: \"janus\"");
    expect(content).toContain("## Context");
    expect(content).toContain("## Decision");
    expect(content).toContain("## Consequences");
    expect(content).toContain("## Alternatives considered");
    await cleanup();
  });

  test("auto-increments the ADR number", async () => {
    const { vaultPath, cleanup } = await emptyVault();
    const r1 = await createAdr({ vaultPath, title: "First" });
    const r2 = await createAdr({ vaultPath, title: "Second" });
    const r3 = await createAdr({ vaultPath, title: "Third" });
    expect(r1.number).toBe(1);
    expect(r2.number).toBe(2);
    expect(r3.number).toBe(3);
    await cleanup();
  });

  test("rejects duplicate ADR with same slug + number", async () => {
    const { vaultPath, cleanup } = await emptyVault();
    await createAdr({ vaultPath, title: "Mismo", number: 5 });
    await expect(createAdr({ vaultPath, title: "Mismo", number: 5 })).rejects.toThrow(/already exists/);
    await cleanup();
  });

  test("custom status + without project", async () => {
    const { vaultPath, cleanup } = await emptyVault();
    const r = await createAdr({ vaultPath, title: "Propuesto", status: "proposed" });
    const content = await readFile(r.path, "utf-8");
    expect(content).toContain("status: proposed");
    expect(content).toContain("project: null");
    await cleanup();
  });
});

describe("promoteDecisionToAdr", () => {
  test("extracts the decision from the pulse and creates ADR + annotates the pulse", async () => {
    const { vaultPath, cleanup } = await emptyVault();
    const pulseDir = join(vaultPath, "Projects", "demo", "pulse");
    await mkdir(pulseDir, { recursive: true });
    const pulsePath = join(pulseDir, "2026-05-20-demo.md");
    const pulseContent = `---
date: 2026-05-20
project: demo
---

> [!quote] Decisions
> - [sesión \`abc12345\`] Adoptar Bun + bun:sqlite para state local — headless ^decision-1
> - [sesión \`def00000\`] Bump prompt a v4 con cross-references ^decision-2

## Related
- Hub: [[demo]]
`;
    await writeFile(pulsePath, pulseContent);

    const r = await promoteDecisionToAdr({
      vaultPath,
      pulsePath,
      decisionId: "decision-1",
      title: "Adoptar Bun + SQLite",
    });
    expect(r.number).toBe(1);

    const adrContent = await readFile(r.path, "utf-8");
    expect(adrContent).toContain("Adoptar Bun + bun:sqlite para state local");
    expect(adrContent).toContain("Promoted from decision `^decision-1`");
    expect(adrContent).toContain("project: \"demo\"");

    const updatedPulse = await readFile(pulsePath, "utf-8");
    expect(updatedPulse).toContain(`^decision-1 → [[${r.filename}]]`);
    // El otro decision sigue sin tocar
    expect(updatedPulse).toContain("^decision-2");
    expect(updatedPulse).not.toContain(`^decision-2 → [[`);
    await cleanup();
  });

  test("fails if the decision-id does not exist in the pulse", async () => {
    const { vaultPath, cleanup } = await emptyVault();
    const pulseDir = join(vaultPath, "Projects", "demo", "pulse");
    await mkdir(pulseDir, { recursive: true });
    const pulsePath = join(pulseDir, "p.md");
    await writeFile(pulsePath, "---\ndate: 2026-05-20\n---\n\n(no decisions)");
    await expect(promoteDecisionToAdr({
      vaultPath, pulsePath, decisionId: "decision-99", title: "x",
    })).rejects.toThrow(/not found/i);
    await cleanup();
  });
});

describe("listAdrs", () => {
  test("lists ADRs ordered by number", async () => {
    const { vaultPath, cleanup } = await emptyVault();
    await createAdr({ vaultPath, title: "Tercero", number: 3, status: "deprecated" });
    await createAdr({ vaultPath, title: "Primero", number: 1, project: "x" });
    await createAdr({ vaultPath, title: "Segundo", number: 2, status: "proposed" });
    const adrs = await listAdrs(vaultPath);
    expect(adrs.length).toBe(3);
    expect(adrs[0]!.number).toBe(1);
    expect(adrs[0]!.title).toBe("Primero");
    expect(adrs[0]!.project).toBe("x");
    expect(adrs[1]!.status).toBe("proposed");
    expect(adrs[2]!.status).toBe("deprecated");
    await cleanup();
  });

  test("returns [] when there are no ADRs", async () => {
    const { vaultPath, cleanup } = await emptyVault();
    expect(await listAdrs(vaultPath)).toEqual([]);
    await cleanup();
  });
});
