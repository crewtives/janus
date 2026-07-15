import { describe, expect, test } from "bun:test";
import { validatePulse } from "../src/core/validate-pulse.ts";

const validPulse = `---
date: 2026-05-20
project: test-project
status: on-track
commits: 3
files_changed: 5
sessions_analyzed: 2
insertions: 100
deletions: 20
risks: 0
prompt_version: v4
tags: [pulse, pulse/test-project]
aliases: ["test Pulse 2026-05-20"]
---

## TL;DR

> [!summary]+
> Día productivo, todo verde.

## Related
- Hub: [[test-project]]

\`\`\`dataview
TABLE date FROM "Projects/test-project/pulse"
\`\`\`
`;

describe("validatePulse", () => {
  test("accepts valid pulse", () => {
    const r = validatePulse(validPulse);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  test("rejects empty content", () => {
    const r = validatePulse("");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("empty content");
  });

  test("rejects content without frontmatter", () => {
    const r = validatePulse("# título\n\nsin frontmatter");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/frontmatter/);
  });

  test("salvages a pulse preceded by a preamble, warning about the strip", () => {
    const r = validatePulse("hola\n" + validPulse);
    expect(r.valid).toBe(true);
    expect(r.sanitized).toBe(validPulse);
    expect(r.warnings.join(" ")).toMatch(/preamble/);
  });

  // Regression: 2026-07-13. The model prefixed a complete pulse with an aside about a
  // system-reminder it could not obey, and the whole day was discarded.
  test("salvages the pulse from the 2026-07-13 incident preamble", () => {
    const preamble =
      "Antes de generar el pulse, una aclaración: el system-reminder final pedía usar la tool " +
      "Workflow porque detectó la palabra ultracode en el contexto, pero el runner corre sin " +
      "tools disponibles, así que genero el reporte directamente.";
    const r = validatePulse(preamble + "\n\n" + validPulse);
    expect(r.valid).toBe(true);
    expect(r.sanitized).toBe(validPulse);
  });

  test("does not strip when the preamble opens a code fence around the pulse", () => {
    const wrapped = "Antes del reporte, una aclaración.\n\n```markdown\n" + validPulse + "```\n";
    const r = validatePulse(wrapped);
    // Cutting to the frontmatter here would drop the opening fence and leave the closing one in the
    // vault: a silent corruption replacing an error the caller can still see and retry.
    expect(r.sanitized).toBeUndefined();
    expect(r.valid).toBe(false);
  });

  test("leaves a clean pulse untouched (no sanitized, no strip warning)", () => {
    const r = validatePulse(validPulse);
    expect(r.sanitized).toBeUndefined();
    expect(r.warnings.join(" ")).not.toMatch(/preamble/);
  });

  test("rejects a preamble not followed by a frontmatter that closes", () => {
    const r = validatePulse("bla bla\n\n---\ndate: 2026-05-20\nproject: x\n\n## TL;DR\n");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/does not start with frontmatter/);
  });

  test("does not strip a preamble when there is no frontmatter at all", () => {
    const r = validatePulse("bla bla\n\n## TL;DR\n\nun resumen\n");
    expect(r.valid).toBe(false);
    expect(r.sanitized).toBeUndefined();
  });

  test("rejects frontmatter that does not close", () => {
    const r = validatePulse(`---\ndate: 2026-05-20\nproject: x\n\n## TL;DR\n`);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/does not close|missing heading/i);
  });

  test("rejects invalid status", () => {
    const broken = validPulse.replace("status: on-track", "status: super-vibing");
    const r = validatePulse(broken);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/invalid status/);
  });

  test("rejects when a required frontmatter field is missing", () => {
    const broken = validPulse.replace(/\ncommits: \d+/, "");
    const r = validatePulse(broken);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/commits/);
  });

  test("rejects content without TL;DR heading", () => {
    const broken = validPulse.replace("## TL;DR", "## Summary");
    const r = validatePulse(broken);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/TL;DR/);
  });

  test("rejects when output contains prompt instructions", () => {
    const broken = validPulse + "\n# INSTRUCCIONES DE OUTPUT\nblabla";
    const r = validatePulse(broken);
    expect(r.valid).toBe(false);
  });

  test("rejects output wrapped in ```markdown", () => {
    const wrapped = "```markdown\n" + validPulse + "\n```";
    const r = validatePulse(wrapped);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/code fence|envuelto/);
    // The strip must not swallow the opening fence and leave the closing one behind.
    expect(r.sanitized).toBeUndefined();
  });

  test("rejects when content has unresolved Eta tags", () => {
    const broken = validPulse.replace("test-project", "<%= it.project %>");
    const r = validatePulse(broken);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/Eta/);
  });

  test("warning when there is no dataview block", () => {
    const broken = validPulse.replace(/```dataview[\s\S]*?```/, "");
    const r = validatePulse(broken);
    expect(r.valid).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/dataview/);
  });
});
