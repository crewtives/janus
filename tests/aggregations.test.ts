import { describe, expect, test } from "bun:test";
import { currentQuarterOf, parseQuarter, previousQuarter } from "../src/core/aggregations.ts";

describe("aggregations helpers", () => {
  test("currentQuarterOf maps month → correct Q", () => {
    expect(currentQuarterOf("2026-01-15")).toBe("2026-Q1");
    expect(currentQuarterOf("2026-03-31")).toBe("2026-Q1");
    expect(currentQuarterOf("2026-04-01")).toBe("2026-Q2");
    expect(currentQuarterOf("2026-07-15")).toBe("2026-Q3");
    expect(currentQuarterOf("2026-12-31")).toBe("2026-Q4");
  });

  test("previousQuarter crosses year correctly", () => {
    expect(previousQuarter("2026-Q2")).toBe("2026-Q1");
    expect(previousQuarter("2026-Q1")).toBe("2025-Q4");
    expect(previousQuarter("2026-Q4")).toBe("2026-Q3");
  });

  test("parseQuarter returns correct bounds", () => {
    const q1 = parseQuarter("2026-Q1");
    expect(q1.startDate).toBe("2026-01-01");
    expect(q1.endDate).toBe("2026-03-31");
    expect(q1.days).toBe(90); // 2026 no es bisiesto

    const q2 = parseQuarter("2026-Q2");
    expect(q2.startDate).toBe("2026-04-01");
    expect(q2.endDate).toBe("2026-06-30");

    const q4 = parseQuarter("2026-Q4");
    expect(q4.startDate).toBe("2026-10-01");
    expect(q4.endDate).toBe("2026-12-31");
  });

  test("parseQuarter rejects invalid format", () => {
    expect(() => parseQuarter("2026-Q5")).toThrow();
    expect(() => parseQuarter("2026-q1")).toThrow();
    expect(() => parseQuarter("foo")).toThrow();
  });
});
