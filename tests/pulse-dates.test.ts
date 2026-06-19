import { describe, expect, test } from "bun:test";
import { determineDates } from "../src/pipeline/orchestrator.ts";

/**
 * `--date` es la única rama de determineDates() que no depende del reloj
 * (since/backfill/default derivan de hoy), así que es la única determinista
 * y la que cubrimos aquí. Selecciona exactamente una fecha y tiene prioridad
 * sobre since/backfill — habilita reprocesar un día puntual con `pulse --date
 * YYYY-MM-DD --force` sin arrastrar el resto del rango.
 */
describe("determineDates — --date", () => {
  test("returns exactly the requested date", () => {
    expect(determineDates({ date: "2026-06-18" })).toEqual(["2026-06-18"]);
  });

  test("takes precedence over since and backfill", () => {
    expect(determineDates({ date: "2026-06-18", since: "2026-01-01", backfill: "30d" })).toEqual([
      "2026-06-18",
    ]);
  });

  test("rejects a malformed date instead of silently producing a bad range", () => {
    expect(() => determineDates({ date: "18-06-2026" })).toThrow(/--date invalid/);
    expect(() => determineDates({ date: "2026-6-8" })).toThrow(/--date invalid/);
    expect(() => determineDates({ date: "yesterday" })).toThrow(/--date invalid/);
  });
});
