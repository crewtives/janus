import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Checkpoint } from "../src/core/checkpoint.ts";
import { loadUserEdits } from "../src/core/user-edits.ts";

async function makeVault(): Promise<{ obsidianPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "janus-edits-"));
  const obsidianPath = join(dir, "vault");
  await mkdir(join(obsidianPath, "pulse"), { recursive: true });
  return { obsidianPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("loadUserEdits", () => {
  test("returns [] when there are no baselines", async () => {
    const { obsidianPath, cleanup } = await makeVault();
    const cp = Checkpoint.openInMemory();
    const edits = await loadUserEdits({ checkpoint: cp, project: "proj", obsidianPath, currentDate: "2026-05-20" });
    expect(edits).toEqual([]);
    cp.close();
    await cleanup();
  });

  test("returns [] when the file on disk matches the baseline (no edits)", async () => {
    const { obsidianPath, cleanup } = await makeVault();
    const cp = Checkpoint.openInMemory();
    const content = "line A\nline B\nline C";
    cp.saveBaseline({ project: "proj", date: "2026-05-19", generatedContent: content });
    await writeFile(join(obsidianPath, "pulse", "2026-05-19-proj.md"), content);
    const edits = await loadUserEdits({ checkpoint: cp, project: "proj", obsidianPath, currentDate: "2026-05-20" });
    expect(edits).toEqual([]);
    cp.close();
    await cleanup();
  });

  test("detects diff when the user edited the file", async () => {
    const { obsidianPath, cleanup } = await makeVault();
    const cp = Checkpoint.openInMemory();
    const baseline = "## TL;DR\n> Un día genérico.\n## Shipped\n> [!success] Shipped\n> - cosa";
    const edited = "## TL;DR\n> Un día muy importante.\n## Shipped\n> [!success] Shipped\n> - cosa\n> - otra cosa";
    cp.saveBaseline({ project: "proj", date: "2026-05-19", generatedContent: baseline });
    await writeFile(join(obsidianPath, "pulse", "2026-05-19-proj.md"), edited);
    const edits = await loadUserEdits({ checkpoint: cp, project: "proj", obsidianPath, currentDate: "2026-05-20" });
    expect(edits.length).toBe(1);
    expect(edits[0]!.date).toBe("2026-05-19");
    expect(edits[0]!.diff).toContain("- > Un día genérico.");
    expect(edits[0]!.diff).toContain("+ > Un día muy importante.");
    expect(edits[0]!.diff).toContain("+ > - otra cosa");
    cp.close();
    await cleanup();
  });

  test("limits to maxEdits", async () => {
    const { obsidianPath, cleanup } = await makeVault();
    const cp = Checkpoint.openInMemory();
    for (let i = 13; i <= 19; i += 1) {
      const d = `2026-05-${String(i).padStart(2, "0")}`;
      cp.saveBaseline({ project: "proj", date: d, generatedContent: `original ${i}` });
      await writeFile(join(obsidianPath, "pulse", `${d}-proj.md`), `edited ${i}`);
    }
    const edits = await loadUserEdits({ checkpoint: cp, project: "proj", obsidianPath, currentDate: "2026-05-20", maxEdits: 2 });
    expect(edits.length).toBe(2);
    // Los más recientes primero
    expect(edits[0]!.date).toBe("2026-05-19");
    expect(edits[1]!.date).toBe("2026-05-18");
    cp.close();
    await cleanup();
  });

  test("ignores pulses without a file on disk", async () => {
    const { obsidianPath, cleanup } = await makeVault();
    const cp = Checkpoint.openInMemory();
    cp.saveBaseline({ project: "proj", date: "2026-05-19", generatedContent: "x" });
    // no creamos el archivo
    const edits = await loadUserEdits({ checkpoint: cp, project: "proj", obsidianPath, currentDate: "2026-05-20" });
    expect(edits).toEqual([]);
    cp.close();
    await cleanup();
  });
});
