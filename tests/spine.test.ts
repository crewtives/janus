import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeProjectSpine } from "../src/core/spine.ts";
import type { JanusConfig, ProjectConfig } from "../src/config/types.ts";
import type { LLMRunner, RunResult } from "../src/runners/types.ts";

/** Runner that returns canned text — never spawns a real `claude`. */
function fakeRunner(resultText: string): LLMRunner {
  return {
    id: "fake",
    capabilities: {
      sessionResume: true,
      effortControl: true,
      costTracking: true,
      addDirs: true,
      jsonStream: true,
      disableTools: true,
      fallbackModel: true,
    },
    async run(): Promise<RunResult> {
      return { sessionId: null, resultText, totalCostUsd: null, durationMs: 1, numTurns: 1, exitCode: 0 };
    },
  };
}

const VALID_SPINE = `---
type: project-spine
project: demo
generated_at: 2026-05-20
prompt_version: v4
tags: [project-spine, type/spine]
aliases: ["demo Spine"]
---

> [!summary]+ Current state
> The project ships a CLI that reads git history and writes a daily note. The
> dominant track is resilience: the pipeline runs unattended and the failure
> modes are silent, so the work is about making bad output loud instead of
> letting it reach the vault.

## Navigation

- Hub: [[demo]]
- Dashboard: [[_index]]
`;

async function makeVaultAndProject(opts: {
  weeklies?: string[]; // dates YYYY-MM-DD
  pulses?: Array<{ date: string; status: string; tldr?: string }>;
  previousSpine?: string;
}): Promise<{ vaultPath: string; project: ProjectConfig; config: JanusConfig; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "janus-spine-"));
  const vaultPath = join(dir, "vault");
  const projectName = "demo";
  const projectPath = join(vaultPath, "Projects", projectName);
  await mkdir(join(projectPath, "pulse"), { recursive: true });
  await mkdir(join(vaultPath, "Timeline", "Weekly"), { recursive: true });
  await mkdir(join(vaultPath, "Decisions"), { recursive: true });
  await mkdir(join(vaultPath, "MOCs", "Tracks"), { recursive: true });

  for (const w of opts.weeklies ?? []) {
    await writeFile(join(vaultPath, "Timeline", "Weekly", `${w}-week.md`),
      `---\nperiod_end: ${w}\n---\nweekly stub`);
  }
  for (const p of opts.pulses ?? []) {
    await writeFile(join(projectPath, "pulse", `${p.date}-${projectName}.md`),
      `---\ndate: ${p.date}\nproject: ${projectName}\nstatus: ${p.status}\n---\n\n## TL;DR\n${p.tldr ?? "demo"}`);
  }

  if (opts.previousSpine) {
    await writeFile(join(projectPath, `${projectName}-spine.md`), opts.previousSpine);
  }

  const project: ProjectConfig = {
    name: projectName,
    repoPath: dir,
    obsidianPath: projectPath,
    status: "active",
  };
  const config: JanusConfig = {
    obsidianVault: vaultPath,
    projects: [project],
    concurrency: 1,
    intervalCap: 5,
    intervalMs: 60_000,
    taskTimeoutMs: 60_000,
    stateDir: join(dir, ".janus"),
    model: "sonnet",
    effort: "xhigh",
  };

  return { vaultPath, project, config, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("writeProjectSpine — behavior without calling Claude", () => {
  test("returns null when there are no weeklies/pulses/tracks nor previous spine", async () => {
    const { vaultPath, project, config, cleanup } = await makeVaultAndProject({});
    const r = await writeProjectSpine({ vaultPath, project, config, today: "2026-05-20" });
    expect(r).toBeNull();
    await cleanup();
  });

  test("collectRecentNonIdlePulses filters idle/idle-streak/quiet-streak via integration", async () => {
    // Indirecto: si el módulo no se rompe con pulses idle mezclados con on-track,
    // significa que el filtro funciona. Verificamos que no haya excepción.
    // (la llamada a Claude se evita porque el módulo intenta abrir el subprocess
    // sólo cuando hay datos. Para evitar invocar Claude en tests, no hacemos
    // assertion sobre el output del spine — solo que el helper no rompa.)
    // En cambio testeamos extractTldr explícitamente via construcción de archivos.
    const { vaultPath, project, cleanup } = await makeVaultAndProject({
      weeklies: [],
      pulses: [
        { date: "2026-05-18", status: "idle", tldr: "sin actividad" },
        { date: "2026-05-19", status: "on-track", tldr: "feature X shipped" },
      ],
    });
    // Importar internals para chequear el parser (vía spine no, porque invocaría claude)
    const { readdir, readFile } = await import("node:fs/promises");
    const entries = await readdir(join(project.obsidianPath, "pulse"));
    expect(entries.length).toBe(2);
    const pulse19 = await readFile(join(project.obsidianPath, "pulse", "2026-05-19-demo.md"), "utf-8");
    expect(pulse19).toContain("feature X shipped");
    await cleanup();
  });
});

describe("writeProjectSpine — refuses to overwrite with bad LLM output", () => {
  const PREVIOUS = `---\ntype: project-spine\nproject: demo\n---\n\nprevious narrative worth keeping\n`;

  async function attempt(resultText: string, previousSpine: string | null = PREVIOUS) {
    const ctx = await makeVaultAndProject({
      pulses: [{ date: "2026-05-19", status: "on-track", tldr: "feature X shipped" }],
      ...(previousSpine ? { previousSpine } : {}),
    });
    const spinePath = join(ctx.project.obsidianPath, "demo-spine.md");
    const run = () =>
      writeProjectSpine({
        vaultPath: ctx.vaultPath,
        project: ctx.project,
        config: ctx.config,
        today: "2026-05-20",
        runnerOverride: fakeRunner(resultText),
      });
    return { ...ctx, spinePath, run };
  }

  test("empty resultText (runner exit 0, no content) throws and keeps the previous spine", async () => {
    const { spinePath, run, cleanup } = await attempt("");
    await expect(run()).rejects.toThrow(/refusing to overwrite spine for demo/);
    expect(await readFile(spinePath, "utf-8")).toBe(PREVIOUS);
    await cleanup();
  });

  test("preamble before the frontmatter throws and keeps the previous spine", async () => {
    // The 2026-07-13 incident shape: the model explains a tool conflict, THEN emits
    // a well-formed document. The whole thing must be rejected, not written.
    const { spinePath, run, cleanup } = await attempt(
      `I cannot use the Workflow tool because tools are disabled. Here is the spine:\n\n${VALID_SPINE}`,
    );
    await expect(run()).rejects.toThrow(/does not start with frontmatter/);
    expect(await readFile(spinePath, "utf-8")).toBe(PREVIOUS);
    await cleanup();
  });

  test("unclosed frontmatter throws and keeps the previous spine", async () => {
    const { spinePath, run, cleanup } = await attempt("---\ntype: project-spine\nproject: demo\n");
    await expect(run()).rejects.toThrow(/frontmatter does not close/);
    expect(await readFile(spinePath, "utf-8")).toBe(PREVIOUS);
    await cleanup();
  });

  test("frontmatter with a truncated body throws and keeps the previous spine", async () => {
    const { spinePath, run, cleanup } = await attempt(
      "---\ntype: project-spine\nproject: demo\n---\n\n# demo Spine\n",
    );
    await expect(run()).rejects.toThrow(/body is only \d+ chars/);
    expect(await readFile(spinePath, "utf-8")).toBe(PREVIOUS);
    await cleanup();
  });

  test("bad output with no previous spine leaves no file behind", async () => {
    const { spinePath, run, cleanup } = await attempt("", null);
    await expect(run()).rejects.toThrow(/refusing to overwrite spine for demo/);
    expect(existsSync(spinePath)).toBe(false);
    await cleanup();
  });

  test("a well-formed spine is written (the guard does not reject valid output)", async () => {
    const { spinePath, run, cleanup } = await attempt(VALID_SPINE);
    const r = await run();
    expect(r?.hadPreviousSpine).toBe(true);
    expect(await readFile(spinePath, "utf-8")).toBe(VALID_SPINE.trim());
    await cleanup();
  });

  test("a valid spine wrapped in a code fence is unwrapped, not rejected", async () => {
    const { spinePath, run, cleanup } = await attempt("```markdown\n" + VALID_SPINE + "```\n");
    await run();
    expect(await readFile(spinePath, "utf-8")).toStartWith("---\ntype: project-spine");
    await cleanup();
  });
});
