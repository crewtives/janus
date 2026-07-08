import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "defuse",
    description:
      "Fase 2 one-time historical graph de-fuse. Strips MOC footers + pulse date-chains, delinks pulse-to-pulse prose links, stamps prev/next + canonical tags across existing notes. DRY-RUN by default — pass --apply to write. Back up the vault first.",
  },
  args: {
    apply: {
      type: "boolean",
      description: "Actually write. Without this, runs a dry-run (no writes). Back up the vault before --apply.",
      default: false,
    },
    project: {
      type: "string",
      description: "Only de-fuse this project (by name). Global notes are skipped when set.",
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { defuseVault } = await import("../core/defuse.ts");
    const config = await loadConfig();

    const dryRun = !args.apply;
    const r = await defuseVault({
      vaultPath: config.obsidianVault,
      config,
      dryRun,
      projectFilter: args.project ?? null,
    });

    const mode = dryRun ? "DRY-RUN (no writes)" : "APPLIED";
    console.log(`[defuse] ${mode} — scanned ${r.scanned} · ${dryRun ? "would change" : "changed"} ${r.changed} · skipped ${r.skipped} (frozen)`);
    for (const [type, c] of Object.entries(r.perType).sort()) {
      if (c.changed > 0) console.log(`  ${type}: ${c.changed}/${c.scanned}`);
    }
    if (r.samples.length > 0) {
      console.log(`  sample: ${r.samples.slice(0, 5).join(", ")}`);
    }
    if (dryRun && r.changed > 0) {
      console.log(`\n[defuse] re-run with --apply to write (back up the vault first: cp -R <vault> <vault>.backup-pre-fase2).`);
    }
    if (!dryRun) {
      console.log(`\n[defuse] done. Re-run \`janus index\` to refresh FTS, then open Obsidian to verify the graph.`);
    }
  },
});
