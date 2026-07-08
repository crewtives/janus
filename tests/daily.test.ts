import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderFallback, stripCodeFenceWrap, writeDailyConsolidated } from "../src/core/daily.ts";

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), "janus-vault-"));
});

afterEach(async () => {
  if (vault) await rm(vault, { recursive: true, force: true });
});

async function createPulse(project: string, date: string, content: string): Promise<void> {
  const dir = join(vault, "Projects", project, "pulse");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${date}-${project}.md`), content);
}

describe("daily consolidated", () => {
  test("renderFallback is de-fused: plain roster + dataview + dashboard, no embeds/date-chain (R9)", () => {
    const out = renderFallback("2026-05-20", [
      { project: "alpha", content: "" },
      { project: "beta", content: "" },
    ]);
    expect(out).toContain("date: 2026-05-20");
    expect(out).toContain("tags: [daily, daily/2026-05, type/daily]"); // R12 canonical type tag
    expect(out).toContain("pulses_count: 2");
    expect(out).toContain("## alpha"); // plain-text roster
    expect(out).toContain("## beta");
    // R9: no per-pulse transclusions or see-full-pulse wiki-links
    expect(out).not.toContain("![[2026-05-20-alpha#TL;DR]]");
    expect(out).not.toContain("|View full pulse]]");
    expect(out).toContain("```dataview");
    // R9: no Previous/Next date-chain; only the dashboard entry point remains
    expect(out).not.toContain("Previous day");
    expect(out).not.toContain("Next day");
    expect(out).toContain("[[Janus Pulse|Global dashboard]]");
    expect(out).toContain("fallback_render: true");
  });

  test("stripCodeFenceWrap removes wrapping ```markdown ... ```", () => {
    const wrapped = "```markdown\n---\ndate: 2026-05-13\n---\n\ncontenido\n```";
    expect(stripCodeFenceWrap(wrapped)).toBe("---\ndate: 2026-05-13\n---\n\ncontenido");
    const wrappedMd = "```md\n# t\n```";
    expect(stripCodeFenceWrap(wrappedMd)).toBe("# t");
    const wrappedBare = "```\n# t\n```";
    expect(stripCodeFenceWrap(wrappedBare)).toBe("# t");
    const naked = "---\ndate: x\n---\ncontent";
    expect(stripCodeFenceWrap(naked)).toBe(naked);
  });

  test("writeDailyConsolidated returns null when there are no pulses on filesystem", async () => {
    const res = await writeDailyConsolidated({ vaultPath: vault, date: "2026-05-20", results: [] });
    expect(res).toBeNull();
  });

  test("writeDailyConsolidated writes using fallback when there is no config", async () => {
    await createPulse("alpha", "2026-05-20", "---\nproject: alpha\nstatus: idle\n---\n## TL;DR\nNada hoy.");
    const res = await writeDailyConsolidated({ vaultPath: vault, date: "2026-05-20", results: [] });
    expect(res).not.toBeNull();
    expect(res?.path).toBe(join(vault, "Timeline", "Daily", "2026-05-20.md"));
    expect(res?.projectCount).toBe(1);
    expect(res?.llmGenerated).toBe(false);
    const content = await readFile(res!.path, "utf-8");
    expect(content).toContain("## alpha");
    expect(content).not.toContain("![[2026-05-20-alpha#TL;DR]]");
  });

  test("dry-run does not write but returns the path", async () => {
    await createPulse("alpha", "2026-05-20", "---\nproject: alpha\n---\n");
    const res = await writeDailyConsolidated({
      vaultPath: vault,
      date: "2026-05-20",
      results: [],
      dryRun: true,
    });
    expect(res).not.toBeNull();
    expect(res?.projectCount).toBe(1);
    let existed = true;
    try {
      await readFile(res!.path, "utf-8");
    } catch {
      existed = false;
    }
    expect(existed).toBe(false);
  });

  test("collects multiple projects on the same day", async () => {
    await createPulse("alpha", "2026-05-20", "---\nproject: alpha\n---\n");
    await createPulse("beta", "2026-05-20", "---\nproject: beta\n---\n");
    await createPulse("zeta", "2026-05-20", "---\nproject: zeta\n---\n");
    await createPulse("alpha", "2026-05-19", "---\nproject: alpha\n---\n"); // otro día — no entra
    const res = await writeDailyConsolidated({ vaultPath: vault, date: "2026-05-20", results: [] });
    expect(res?.projectCount).toBe(3);
    const content = await readFile(res!.path, "utf-8");
    // ordenado alfabéticamente
    const alpha = content.indexOf("## alpha");
    const beta = content.indexOf("## beta");
    const zeta = content.indexOf("## zeta");
    expect(alpha).toBeLessThan(beta);
    expect(beta).toBeLessThan(zeta);
  });
});
