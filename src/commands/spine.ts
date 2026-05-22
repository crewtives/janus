import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "spine",
    description: "Regenerate the Project Spine (continuous narrative) for one or all projects",
  },
  args: {
    project: {
      type: "string",
      description: "Project name. If omitted, regenerates the spine for all active/paused.",
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { writeAllProjectSpines, writeProjectSpine } = await import("../core/spine.ts");
    const config = await loadConfig();

    const onlyProject = args.project as string | undefined;
    if (onlyProject) {
      const project = config.projects.find((p) => p.name === onlyProject);
      if (!project) {
        throw new Error(`Project not found: ${onlyProject}`);
      }
      if (project.status === "archived") {
        console.log(`[spine] skip — ${onlyProject} is archived`);
        return;
      }
      const r = await writeProjectSpine({
        vaultPath: config.obsidianVault,
        project,
        config,
      });
      if (!r) {
        console.log(`[spine] ${onlyProject}: not enough data — skip`);
        return;
      }
      console.log(`[spine] ✓ ${r.path}`);
      console.log(`[spine]   weeklies: ${r.weekliesIncluded} · pulses: ${r.pulsesIncluded} · tracks: ${r.tracksIncluded} · ADRs: ${r.adrsIncluded}${r.hadPreviousSpine ? " · (update)" : " · (first generation)"}`);
      return;
    }

    console.log(`[spine] regenerating spines for ${config.projects.filter((p) => p.status !== "archived").length} projects…`);
    const results = await writeAllProjectSpines({ config });
    let ok = 0;
    let skipped = 0;
    for (const r of results) {
      if (r) {
        ok += 1;
        console.log(`[spine] ✓ ${r.project}: ${r.path}`);
      } else {
        skipped += 1;
      }
    }
    console.log(`[spine] summary: ${ok} generated, ${skipped} skipped (not enough data or failed)`);
  },
});
