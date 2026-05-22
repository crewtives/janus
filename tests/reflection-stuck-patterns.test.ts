import { describe, expect, test } from "bun:test";
import { Checkpoint } from "../src/core/checkpoint.ts";
import {
  detectStuckPatterns,
  hashBlocker,
  normalizeBlockerText,
  parseBlockersFromWeekly,
  recordWeeklyBlockers,
} from "../src/core/reflection/stuck-patterns.ts";

describe("reflection/stuck-patterns — parse", () => {
  test("extracts blockers from [!danger] callout", () => {
    const weekly = `# Weekly

> [!summary]+
> arco semanal

> [!danger] Riesgos persistentes
> - Working tree sucio en feature/x — apareció en 3 pulses
> - Tests de smoke timing out

## Métricas
`;
    const blockers = parseBlockersFromWeekly(weekly);
    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toContain("Working tree sucio");
    expect(blockers[1]).toContain("smoke timing out");
  });

  test("normalizeBlockerText makes text comparable", () => {
    const a = normalizeBlockerText("Working tree sucio — [[feat-x]] — `commit 1234`");
    const b = normalizeBlockerText("WORKING tree sucio");
    expect(a).toContain("working tree sucio");
    expect(b).toContain("working tree sucio");
  });

  test("hashBlocker is deterministic and content-sensitive", () => {
    const h1 = hashBlocker("Test fail en x");
    const h2 = hashBlocker("Test fail en x");
    const h3 = hashBlocker("Test fail en y");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

describe("reflection/stuck-patterns — escalation", () => {
  test("blocker is flagged when it appears in 2+ weeklies", () => {
    const cp = Checkpoint.openInMemory();
    const weekly1 = `> [!danger] Riesgos\n> - Working tree sucio en feature/x\n`;
    const weekly2 = `> [!danger] Riesgos\n> - Working tree sucio en feature/x\n`;

    recordWeeklyBlockers({ checkpoint: cp, weeklyMarkdown: weekly1, weeklyEndDate: "2026-05-15", project: "_global" });
    recordWeeklyBlockers({ checkpoint: cp, weeklyMarkdown: weekly2, weeklyEndDate: "2026-05-22", project: "_global" });

    const stuck = detectStuckPatterns({ checkpoint: cp, weeklyEndDate: "2026-05-22" });
    expect(stuck.length).toBe(1);
    expect(stuck[0]!.weeklyCount).toBe(2);
    expect(stuck[0]!.firstSeen).toBe("2026-05-15");
    cp.close();
  });

  test("does not escalate when it appears only once", () => {
    const cp = Checkpoint.openInMemory();
    recordWeeklyBlockers({
      checkpoint: cp,
      weeklyMarkdown: `> [!danger]\n> - Single occurrence blocker\n`,
      weeklyEndDate: "2026-05-22",
      project: "_global",
    });
    const stuck = detectStuckPatterns({ checkpoint: cp, weeklyEndDate: "2026-05-22" });
    expect(stuck.length).toBe(0);
    cp.close();
  });

  test("double registration of the same weekly does not inflate count", () => {
    const cp = Checkpoint.openInMemory();
    const md = `> [!danger]\n> - X falla en x\n`;
    recordWeeklyBlockers({ checkpoint: cp, weeklyMarkdown: md, weeklyEndDate: "2026-05-22", project: "_global" });
    recordWeeklyBlockers({ checkpoint: cp, weeklyMarkdown: md, weeklyEndDate: "2026-05-22", project: "_global" });
    const all = cp.listBlockerHistory();
    expect(all[0]!.weeklyCount).toBe(1);
    cp.close();
  });
});
