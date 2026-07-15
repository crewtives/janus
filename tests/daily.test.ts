import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderFallback, stripCodeFenceWrap, writeDailyConsolidated } from "../src/core/daily.ts";
import type { JanusConfig } from "../src/config/types.ts";
import type { LLMRunner, RunOptions, RunResult } from "../src/runners/types.ts";

let vault: string;

/** Captures the rendered prompt so we can assert what the daily prompt tells the model. */
class PromptCapturingRunner implements LLMRunner {
  readonly id = "mock";
  readonly capabilities = {
    sessionResume: false, effortControl: false, costTracking: false,
    addDirs: false, jsonStream: false, disableTools: false, fallbackModel: false,
  };
  prompt = "";
  async run(opts: RunOptions): Promise<RunResult> {
    this.prompt = opts.prompt;
    return {
      sessionId: null, resultText: "---\ndate: x\n---\n\nfake daily.\n",
      totalCostUsd: null, durationMs: 0, numTurns: 1, exitCode: 0,
    };
  }
}

function cfg(v: string): JanusConfig {
  return { obsidianVault: v, model: "m", effort: "low", projects: [] } as unknown as JanusConfig;
}

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

// Regression: 2026-07-13's daily claimed "pulses_count: 7, total_commits: 0" while
// one project's pulse had failed and never reached the vault. A gap in the data
// must never render as a measured zero.
describe("failed projects are not silently dropped", () => {
  test("renderFallback records the gap in frontmatter and body", () => {
    const out = renderFallback("2026-05-20", [{ project: "alpha", content: "" }], ["gamma"]);
    expect(out).toContain("pulses_count: 1");
    expect(out).toContain("expected_projects: 2");
    expect(out).toContain("failed_projects: [gamma]");
    expect(out).toContain("> [!warning] Incomplete day");
    expect(out).toContain("covers 1 of 2 projects");
    expect(out).toContain("## gamma");
    expect(out).toContain("No pulse generated. Its activity today is unknown.");
  });

  test("renderFallback stays clean when nothing failed", () => {
    const out = renderFallback("2026-05-20", [{ project: "alpha", content: "" }]);
    expect(out).toContain("expected_projects: 1");
    expect(out).toContain("failed_projects: []");
    expect(out).not.toContain("Incomplete day");
  });

  test("writeDailyConsolidated derives failed projects from results (fallback path)", async () => {
    await createPulse("alpha", "2026-05-20", "---\nproject: alpha\n---\n");
    const res = await writeDailyConsolidated({
      vaultPath: vault,
      date: "2026-05-20",
      results: [
        { project: "alpha", date: "2026-05-20", status: "ok" },
        { project: "gamma", date: "2026-05-20", status: "failed", error: "validation failed" },
      ],
    });
    const content = await readFile(res!.path, "utf-8");
    expect(content).toContain("failed_projects: [gamma]");
    expect(content).toContain("expected_projects: 2");
    expect(content).toContain("> [!warning] Incomplete day");
  });

  test("a failed project whose pulse is already on disk is not a gap", async () => {
    await createPulse("alpha", "2026-05-20", "---\nproject: alpha\n---\n");
    await createPulse("gamma", "2026-05-20", "---\nproject: gamma\n---\n");
    const res = await writeDailyConsolidated({
      vaultPath: vault,
      date: "2026-05-20",
      results: [{ project: "gamma", date: "2026-05-20", status: "failed", error: "boom" }],
    });
    const content = await readFile(res!.path, "utf-8");
    expect(content).toContain("failed_projects: []");
    expect(content).toContain("expected_projects: 2");
    expect(content).not.toContain("Incomplete day");
  });

  test("LLM path is told about the gap and forbidden from asserting totals", async () => {
    await createPulse("alpha", "2026-05-20", "---\nproject: alpha\n---\n");
    const runner = new PromptCapturingRunner();
    const res = await writeDailyConsolidated({
      vaultPath: vault,
      date: "2026-05-20",
      results: [{ project: "gamma", date: "2026-05-20", status: "failed", error: "boom" }],
      config: cfg(vault),
      runnerOverride: runner,
    });
    expect(res?.llmGenerated).toBe(true);
    expect(runner.prompt).toContain("INCOMPLETE DAY");
    expect(runner.prompt).toContain("gamma");
    // Line-anchored: eta's default autoTrim ate the newline after each `%>` and
    // rendered `pulses_count: 1expected_projects: 2failed_projects: [gamma]`,
    // which a bare toContain still matched. The model copies this block literally.
    expect(runner.prompt).toContain("\npulses_count: 1\nexpected_projects: 2\nfailed_projects: [gamma]\nprompt_version: v7\n");
    expect(runner.prompt).toContain("\ndate: 2026-05-20\ntags: [daily, daily/2026-05, type/daily]\n");
    expect(runner.prompt).toContain("forbidden from asserting cross-project totals");
    // v6 asserted "N pulses (one per project)" — the lie that seeded the false total.
    expect(runner.prompt).not.toContain("(one per project)");
  });

  test("LLM path with no failures keeps the frontmatter honest and skips the warning", async () => {
    await createPulse("alpha", "2026-05-20", "---\nproject: alpha\n---\n");
    const runner = new PromptCapturingRunner();
    await writeDailyConsolidated({
      vaultPath: vault,
      date: "2026-05-20",
      results: [{ project: "alpha", date: "2026-05-20", status: "ok" }],
      config: cfg(vault),
      runnerOverride: runner,
    });
    expect(runner.prompt).toContain("\npulses_count: 1\nexpected_projects: 1\nfailed_projects: []\nprompt_version: v7\n");
    expect(runner.prompt).not.toContain("INCOMPLETE DAY");
    expect(runner.prompt).toContain("| Total commits | X |");
  });
});
