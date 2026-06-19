import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "enrich",
    description:
      "Rebuild vault docs (index, roadmap, strategy) + scaffold (hubs, MOCs, dashboards) idempotently. Repair button that doesn't need a successful pulse.",
  },
  args: {
    project: {
      type: "string",
      description: "Only enrich this project (by name)",
    },
    "no-scaffold": {
      type: "boolean",
      description: "Skip hubs/MOCs/dashboards/fix-related scaffold",
      default: false,
    },
    "sync-roadmaps": {
      type: "boolean",
      description: "Force a full roadmap sync (mirror repo ROADMAP.md / pulse callout) across all projects",
      default: false,
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { enrichVault } = await import("../core/enrich.ts");
    const config = await loadConfig();

    const er = await enrichVault(config, args.project ? { onlyProject: args.project } : {});
    console.log(
      `[enrich] vault enriched — ${er.indexesWritten} _index · ${er.roadmapsWritten} _roadmap · ${er.strategiesWritten} STRATEGY (${er.projectsProcessed} projects)`,
    );

    if (args["sync-roadmaps"]) {
      const { syncRoadmaps } = await import("../core/sync-roadmaps.ts");
      const projects = (args.project ? config.projects.filter((p) => p.name === args.project) : config.projects).map(
        (p) => ({ name: p.name, obsidianPath: p.obsidianPath, repoPath: p.repoPath }),
      );
      const sr = await syncRoadmaps({ projects });
      console.log(
        `[enrich] roadmaps synced — ${sr.roadmapsSyncedFromRepo} from repo · ${sr.roadmapsSyncedFromPulse} from pulse · ${sr.roadmapsPendingNoSource} pending · ${sr.roadmapsSkippedUserEdited} user-edited`,
      );
    }

    // Mirror the post-pulse scaffold so a bare `janus enrich` reconstructs the
    // whole vault. Runs in-process (no scripts/ dir in the compiled binary).
    if (!args["no-scaffold"]) {
      const [{ generateHubs }, { generateMocs }, { generateDashboards }, { fixAllRelated }] = await Promise.all([
        import("../core/scaffold/hubs.ts"),
        import("../core/scaffold/mocs.ts"),
        import("../core/scaffold/dashboards.ts"),
        import("../core/scaffold/fix-related.ts"),
      ]);
      const hubs = await generateHubs({ config });
      console.log(`[enrich] [hubs] ${hubs.created} created, ${hubs.skipped} skipped (of ${hubs.total})`);
      const mocs = await generateMocs({ config });
      console.log(`[enrich] [mocs] ${mocs.created} created, ${mocs.skipped} skipped (of ${mocs.total})`);
      const dash = await generateDashboards({ config });
      console.log(`[enrich] [dashboards] ${dash.created} created, ${dash.skipped} skipped (of ${dash.total})`);
      const fix = await fixAllRelated({ config, dryRun: false });
      console.log(`[enrich] [fix-prev] fixed ${fix.totalChanged}/${fix.totalScanned} pulses`);
    }
  },
});
