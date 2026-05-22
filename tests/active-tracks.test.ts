import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadActiveTracks } from "../src/core/active-tracks.ts";

async function setupVault(tracks: Array<{ slug: string; name: string; projects: string[]; emoji?: string; status?: string }>): Promise<{ vaultPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "janus-tracks-"));
  const vaultPath = join(dir, "vault");
  const tracksDir = join(vaultPath, "MOCs", "Tracks");
  await mkdir(tracksDir, { recursive: true });
  for (const t of tracks) {
    const content = `---
type: track
name: ${JSON.stringify(t.name)}
status: ${JSON.stringify(t.status ?? "—")}
projects: [${t.projects.map((p) => JSON.stringify(p)).join(", ")}]
tags: [track]
---

# ${t.emoji ?? "🔵"} ${t.name}

contenido
`;
    await writeFile(join(tracksDir, `${t.slug}.md`), content);
  }
  return { vaultPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("loadActiveTracks", () => {
  test("returns [] when there are no tracks", async () => {
    const { vaultPath, cleanup } = await setupVault([]);
    expect(await loadActiveTracks({ vaultPath })).toEqual([]);
    await cleanup();
  });

  test("loads tracks with name, emoji, projects, status", async () => {
    const { vaultPath, cleanup } = await setupVault([
      { slug: "globex", name: "Globex Checkout", projects: ["fly-foo"], emoji: "🟠", status: "completed" },
      { slug: "scraper", name: "Acme Scraper", projects: ["acme-app", "acme-picko"], emoji: "🔵" },
    ]);
    const tracks = await loadActiveTracks({ vaultPath });
    expect(tracks.length).toBe(2);
    const globex = tracks.find((t) => t.slug === "globex")!;
    expect(globex.name).toBe("Globex Checkout");
    expect(globex.projects).toEqual(["fly-foo"]);
    expect(globex.emoji).toBe("🟠");
    expect(globex.status).toBe("completed");
    await cleanup();
  });

  test("filters by project", async () => {
    const { vaultPath, cleanup } = await setupVault([
      { slug: "a", name: "A", projects: ["proj-1"] },
      { slug: "b", name: "B", projects: ["proj-2"] },
      { slug: "c", name: "C", projects: ["proj-1", "proj-2"] },
    ]);
    const proj1 = await loadActiveTracks({ vaultPath, project: "proj-1" });
    expect(proj1.map((t) => t.slug).sort()).toEqual(["a", "c"]);
    const proj2 = await loadActiveTracks({ vaultPath, project: "proj-2" });
    expect(proj2.map((t) => t.slug).sort()).toEqual(["b", "c"]);
    await cleanup();
  });
});
