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
    const includeArchive = !args["skip-archive"];
    const idx = SearchIndex.open(config.stateDir!);
    console.log(`[index] scanning ${config.obsidianVault}…`);
    const docs = await scanVault({
      vaultPath: config.obsidianVault,
      includeArchive,
    });
    for (const doc of docs) idx.upsert(doc);

    // Upsert alone never notices a deletion, and docIds are vault-relative paths, so every
    // pulse the monthly moves into _archive/ left its old path behind as a dangling
    // citation. Reconciling fixes that, but it DELETES rows: it may only run against a scan
    // that covered the whole index scope. --skip-archive is a deliberately partial scan, and
    // an empty result means the vault path is wrong far more often than it means the vault
    // is empty. Reconciling either one would wipe the index.
    const seen = new Set(docs.map((d) => d.docId));
    let removed: string[] = [];
    if (!includeArchive) {
      console.log(`[index] reconcile skipped: --skip-archive is a partial scan`);
    } else if (seen.size === 0) {
      console.warn(`[index] reconcile skipped: the scan found no documents (is ${config.obsidianVault} the right vault?)`);
    } else {
      removed = idx.reconcile(seen);
    }

    const stats = idx.stats();
    idx.close();
    console.log(`[index] ${seen.size} documents indexed:`);
    for (const [kind, n] of Object.entries(stats).filter(([, n]) => n > 0)) {
      console.log(`  - ${kind.padEnd(10)}: ${n}`);
    }
    if (removed.length > 0) {
      console.log(`[index] ${removed.length} stale documents removed (deleted or moved on disk)`);
    }
  },
});
