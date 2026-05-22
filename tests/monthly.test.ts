import { describe, expect, test } from "bun:test";
import { isFirstOfMonth, previousMonth } from "../src/core/monthly.ts";

describe("monthly helpers", () => {
  test("isFirstOfMonth only detects day 01", () => {
    expect(isFirstOfMonth("2026-06-01")).toBe(true);
    expect(isFirstOfMonth("2026-06-02")).toBe(false);
    expect(isFirstOfMonth("2026-12-01")).toBe(true);
    expect(isFirstOfMonth("2026-12-31")).toBe(false);
  });

  test("previousMonth returns the previous month in YYYY-MM format", () => {
    expect(previousMonth("2026-06-01")).toBe("2026-05");
    expect(previousMonth("2026-01-01")).toBe("2025-12");
    expect(previousMonth("2026-03-15")).toBe("2026-02");
    expect(previousMonth("2026-12-01")).toBe("2026-11");
  });
});
