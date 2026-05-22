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

  test("rejects preamble before frontmatter", () => {
    const r = validatePulse("hola\n" + validPulse);
    expect(r.valid).toBe(false);
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
