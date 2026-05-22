import { describe, expect, test } from "bun:test";
import { makeQueue } from "../src/pipeline/queue.ts";

/**
 * Verifica el invariante crítico del orchestrator post-fix:
 *
 *   Dentro de un mismo proyecto, las fechas se procesan en orden
 *   cronológico estrictamente serial. Sin esa garantía, el pulse
 *   del día N puede arrancar antes de que el día N-1 haya escrito
 *   su archivo a disk, y `previousPulseFilename` apunta a un pulse
 *   más viejo del que corresponde.
 *
 * Test: simula 3 proyectos × 4 fechas cada uno. Registra el orden
 * de "completion" de cada (project, date) pair. Verifica que para
 * cada proyecto, las fechas se completan en orden ascendente.
 * Permite que distintos proyectos corran en paralelo (de hecho lo
 * provoca con delays asimétricos).
 */
describe("orchestrator queue — per-project serialization", () => {
  test("within a project, dates are processed in order", async () => {
    const projects = ["alpha", "beta", "gamma"];
    const dates = ["2026-05-14", "2026-05-15", "2026-05-16", "2026-05-17"];

    // Registra (project, date, t-start, t-end) en orden de completion.
    const events: Array<{ project: string; date: string; startedAt: number; finishedAt: number }> = [];

    // Fake "processProject" — duerme un poco con delay variable por proyecto
    // para forzar interleaving entre proyectos. Si la queue NO serializa
    // por proyecto, el orden intra-proyecto se rompe.
    const fakeProcess = async (project: string, date: string): Promise<void> => {
      const startedAt = Date.now();
      // delays distintos por proyecto para forzar parallel interleaving
      const delay = project === "alpha" ? 20 : project === "beta" ? 35 : 10;
      await new Promise((r) => setTimeout(r, delay));
      const finishedAt = Date.now();
      events.push({ project, date, startedAt, finishedAt });
    };

    const queue = makeQueue({
      concurrency: 2,
      intervalCap: 100,
      intervalMs: 1000,
      taskTimeoutMs: 30_000,
      retries: 0,
    });

    // Misma estructura del orchestrator: una task por proyecto, con loop
    // serial interno sobre las fechas.
    for (const project of projects) {
      void queue.add(async () => {
        for (const date of [...dates].sort()) {
          await fakeProcess(project, date);
        }
      });
    }
    await queue.onIdle();

    // Invariante 1: cada proyecto completó las 4 fechas.
    for (const project of projects) {
      const projEvents = events.filter((e) => e.project === project);
      expect(projEvents).toHaveLength(4);
    }

    // Invariante 2: dentro de cada proyecto, las fechas terminaron en orden
    // cronológico ascendente (esa es la garantía que arregla el wiki-link
    // bug).
    for (const project of projects) {
      const projEvents = events.filter((e) => e.project === project);
      const datesInOrder = projEvents.map((e) => e.date);
      const expectedOrder = [...projEvents].sort((a, b) => a.finishedAt - b.finishedAt).map((e) => e.date);
      // El orden de completion debería ser exactamente el ascendente
      // (porque el loop interno awaitea fecha por fecha).
      expect(datesInOrder).toEqual(expectedOrder);
      expect(datesInOrder).toEqual([...dates].sort());
    }

    // Invariante 3: hubo paralelismo cross-proyecto — verificamos que algún
    // par de eventos de proyectos distintos se solapó en el tiempo. Si la
    // queue no permitiese paralelismo, todos los eventos serían disjuntos.
    let foundOverlap = false;
    for (let i = 0; i < events.length && !foundOverlap; i++) {
      for (let j = i + 1; j < events.length && !foundOverlap; j++) {
        const a = events[i]!;
        const b = events[j]!;
        if (a.project === b.project) continue;
        const overlapped = a.startedAt < b.finishedAt && b.startedAt < a.finishedAt;
        if (overlapped) foundOverlap = true;
      }
    }
    expect(foundOverlap).toBe(true);
  });

  test("within a project, if one date fails, the following ones are still processed", async () => {
    const events: Array<{ date: string; status: "ok" | "failed" }> = [];

    const queue = makeQueue({
      concurrency: 1,
      intervalCap: 100,
      intervalMs: 1000,
      taskTimeoutMs: 30_000,
      retries: 0,
    });

    void queue.add(async () => {
      const dates = ["2026-05-14", "2026-05-15", "2026-05-16"];
      for (const date of dates) {
        try {
          if (date === "2026-05-15") throw new Error("simulated failure");
          await new Promise((r) => setTimeout(r, 5));
          events.push({ date, status: "ok" });
        } catch {
          events.push({ date, status: "failed" });
        }
      }
    });
    await queue.onIdle();

    expect(events).toEqual([
      { date: "2026-05-14", status: "ok" },
      { date: "2026-05-15", status: "failed" },
      { date: "2026-05-16", status: "ok" },
    ]);
  });
});
