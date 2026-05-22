import { describe, expect, test } from "bun:test";
import { fixRelatedSection } from "../scripts/fix-pulse-anterior-links.ts";

function makePulse(relatedBody: string): string {
  return `---
date: 2026-05-15
project: demo
status: idle
---

## TL;DR

> [!summary]+
> Día sin actividad registrada.

## Related
${relatedBody}

> [!info]- Raw activity
> - Commits: 0
`;
}

describe("fixRelatedSection", () => {
  test("LLM hallucinated 'sin pulse anterior en la ventana disponible' → fix with correct wiki-link", () => {
    const input = makePulse(`- Hub: [[demo]]
- Pulse anterior: (sin pulse anterior en la ventana disponible)
- MOCs: [[Decisions MOC]]`);
    const r = fixRelatedSection(input, "2026-05-14-demo", "demo");
    expect(r.changed).toBe(true);
    expect(r.content).toContain("- Pulse anterior: [[2026-05-14-demo]]");
    expect(r.content).not.toContain("ventana disponible");
  });

  test("first pulse (no prev) → writes canonical fallback", () => {
    const input = makePulse(`- Hub: [[demo]]
- Pulse anterior: [[2026-05-13-demo]]
- MOCs: [[Decisions MOC]]`);
    const r = fixRelatedSection(input, null, "demo");
    expect(r.changed).toBe(true);
    expect(r.content).toContain("(sin pulse anterior en la bóveda — primer pulse del proyecto o gap)");
    expect(r.content).not.toContain("[[2026-05-13-demo]]");
  });

  test("already canonical → no change", () => {
    const input = makePulse(`- Hub: [[demo]]
- Pulse anterior: [[2026-05-14-demo]]
- MOCs: [[Decisions MOC]]`);
    const r = fixRelatedSection(input, "2026-05-14-demo", "demo");
    expect(r.changed).toBe(false);
    expect(r.reason).toContain("canónico");
  });

  test("LLM linked to the wrong filename (old race) → fix", () => {
    const input = makePulse(`- Hub: [[demo]]
- Pulse anterior: [[2026-05-13-demo]]
- MOCs: [[Decisions MOC]]`);
    const r = fixRelatedSection(input, "2026-05-14-demo", "demo");
    expect(r.changed).toBe(true);
    expect(r.content).toContain("[[2026-05-14-demo]]");
    expect(r.content).not.toContain("[[2026-05-13-demo]]");
  });

  test("misspelled hub (alias or typo) → fix", () => {
    const input = makePulse(`- Hub: [[Demo Project Hub]]
- Pulse anterior: [[2026-05-14-demo]]
- MOCs: [[Decisions MOC]]`);
    const r = fixRelatedSection(input, "2026-05-14-demo", "demo");
    expect(r.changed).toBe(true);
    expect(r.content).toContain("- Hub: [[demo]]");
  });

  test("missing Pulse anterior line — adds it after the hub", () => {
    const input = makePulse(`- Hub: [[demo]]
- MOCs: [[Decisions MOC]]`);
    const r = fixRelatedSection(input, "2026-05-14-demo", "demo");
    expect(r.changed).toBe(true);
    expect(r.content).toContain("- Hub: [[demo]]\n- Pulse anterior: [[2026-05-14-demo]]\n- MOCs:");
  });

  test("no ## Related section → does nothing", () => {
    const r = fixRelatedSection("# nada\n\nbody sin related", "2026-05-14-demo", "demo");
    expect(r.changed).toBe(false);
    expect(r.reason).toContain("sin sección");
  });

  test("idempotent: running twice produces no diff the second time", () => {
    const input = makePulse(`- Hub: [[demo]]
- Pulse anterior: (sin pulse anterior en la ventana disponible)
- MOCs: [[Decisions MOC]]`);
    const r1 = fixRelatedSection(input, "2026-05-14-demo", "demo");
    expect(r1.changed).toBe(true);
    const r2 = fixRelatedSection(r1.content, "2026-05-14-demo", "demo");
    expect(r2.changed).toBe(false);
  });

  test("respects other lines in the Related section (MOCs, etc.)", () => {
    const input = makePulse(`- Hub: [[demo]]
- Pulse anterior: (sin pulse anterior en la ventana disponible)
- MOCs: [[Decisions MOC]] · [[Risks MOC]] · [[Projects MOC]]`);
    const r = fixRelatedSection(input, "2026-05-14-demo", "demo");
    expect(r.content).toContain("- MOCs: [[Decisions MOC]] · [[Risks MOC]] · [[Projects MOC]]");
  });
});
