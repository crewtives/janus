import { describe, expect, test } from "bun:test";
import { parseTracks } from "../src/core/tracks.ts";

const sampleWeekly = `---
period_start: 2026-05-13
---

## Tracks dominantes

### 🔵 Integración Globex
- **Proyectos**: [[fly-foo]]
- **Avance**: OAuth + RSA-SHA256 shipped, legacy V1 removida.
- **Estado al cierre**: on-track con blocker externo del proveedor

### 🟢 Sandbox público Acme
- **Proyectos**: [[crewtives-acme-app]], [[crewtives-acme-extra]]
- **Avance**: lead capture + lockdown + bench-up --demo entregado.
- **Estado al cierre**: completado

## Top outcomes
> [!success] Top outcomes
> - foo
`;

describe("parseTracks", () => {
  test("extracts 2 tracks with emoji, projects and status", () => {
    const tracks = parseTracks(sampleWeekly);
    expect(tracks.length).toBe(2);
    expect(tracks[0]!.emoji).toBe("🔵");
    expect(tracks[0]!.name).toBe("Integración Globex");
    expect(tracks[0]!.slug).toBe("integracion-globex");
    expect(tracks[0]!.projects).toEqual(["fly-foo"]);
    expect(tracks[0]!.status).toContain("on-track");

    expect(tracks[1]!.emoji).toBe("🟢");
    expect(tracks[1]!.name).toBe("Sandbox público Acme");
    expect(tracks[1]!.projects).toEqual(["crewtives-acme-app", "crewtives-acme-extra"]);
  });

  test("without Dominant tracks section returns []", () => {
    expect(parseTracks("# foo\n## bar")).toEqual([]);
  });

  test("ignores tracks without body", () => {
    const md = `## Tracks dominantes\n\n### 🔵 Track vacío\n\n### 🟢 Otro track\n- **Proyectos**: [[x]]\n`;
    const tracks = parseTracks(md);
    expect(tracks.length).toBe(1);
    expect(tracks[0]!.name).toBe("Otro track");
  });
});
