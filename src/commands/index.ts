import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "index",
    description: "Rescan the vault and rebuild the FTS5 index (idempotent)",
  },
  args: {
    "skip-archive": {
      type: "boolean",
      description: "Exclude files under _archive/ from the index",
      default: false,
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { SearchIndex, scanVault } = await import("../core/search-index.ts");
    const config = await loadConfig();
    const idx = SearchIndex.open(config.stateDir!);
    console.log(`[index] scanning ${config.obsidianVault}…`);
    const docs = await scanVault({
      vaultPath: config.obsidianVault,
      includeArchive: !args["skip-archive"],
    });
    for (const doc of docs) idx.upsert(doc);
    const stats = idx.stats();
    idx.close();
    console.log(`[index] ${docs.length} documents indexed:`);
    for (const [kind, n] of Object.entries(stats).filter(([, n]) => n > 0)) {
      console.log(`  - ${kind.padEnd(10)}: ${n}`);
    }
  },
});
