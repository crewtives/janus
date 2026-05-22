import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "archive-tracks",
    description: "Move tracks not mentioned in the last N weeklies into _archive/",
  },
  args: {
    "ttl-weeks": {
      type: "string",
      description: "TTL in weeks. Default: 4.",
    },
    "dry-run": {
      type: "boolean",
      description: "Only report, don't move files",
      default: false,
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { archiveStaleTracks } = await import("../core/track-ttl.ts");
    const config = await loadConfig();
    const ttlWeeks = args["ttl-weeks"] ? parseInt(args["ttl-weeks"] as string, 10) : 4;
    const r = await archiveStaleTracks({
      vaultPath: config.obsidianVault,
      ttlWeeks,
      dryRun: args["dry-run"] as boolean,
    });
    const tag = args["dry-run"] ? " [DRY-RUN]" : "";
    console.log(`[archive-tracks]${tag} ${r.tracksScanned} tracks scanned, ${r.tracksArchived} archived (TTL: ${ttlWeeks} weeks)`);
    for (const a of r.archived) {
      console.log(`  → ${a.slug}: ${a.reason}`);
    }
    if (r.archived.length === 0) {
      console.log(`  (all tracks are within TTL)`);
    }
  },
});
