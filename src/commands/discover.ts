import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "discover",
    description: "Detect new git projects under discoverRoots and propose adding them to config.local.json",
  },
  args: {
    apply: {
      type: "boolean",
      description: "Write the discovered entries to config.local.json (preserves existing ones)",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Only report — no writes (same as the default)",
      default: false,
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { discoverProjects, renderProjectEntry } = await import("../core/discover.ts");
    const { existsSync } = await import("node:fs");
    const { readFile, writeFile, copyFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");

    const config = await loadConfig();
    const result = await discoverProjects({ config });

    if (result.rootsInferred) {
      console.log(`[discover] no 'discoverRoots' in config — inferred from existing projects:`);
    } else {
      console.log(`[discover] roots scanned:`);
    }
    for (const r of result.roots) console.log(`  · ${r}`);
    console.log("");

    if (result.discovered.length === 0) {
      console.log(`[discover] no new projects found. ${result.alreadyConfigured.length} already in config:`);
      for (const n of result.alreadyConfigured) console.log(`  ✓ ${n}`);
      return;
    }

    console.log(`[discover] ${result.discovered.length} new project(s) detected:\n`);
    for (const d of result.discovered) {
      console.log(`  → ${d.name}`);
      console.log(`     repoPath:     ${d.repoPath}`);
      console.log(`     obsidianPath: ${d.obsidianPath}`);
      console.log(`     status:       ${d.status}`);
      console.log(`     (matched root: ${d.matchedRoot})`);
      console.log("");
    }

    if (!args.apply) {
      console.log(`[discover] dry-run. To add them to the config, run:`);
      console.log(`  bun janus discover --apply`);
      return;
    }

    // Apply: read config.local.json, append the new ones to projects, write with backup.
    const configPath = resolve(process.cwd(), "config.local.json");
    if (!existsSync(configPath)) {
      throw new Error(`config.local.json not found at ${configPath}. Apply only works when the config lives in CWD.`);
    }
    const backupPath = `${configPath}.backup-${Date.now()}`;
    await copyFile(configPath, backupPath);

    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as { projects: unknown[]; [k: string]: unknown };
    if (!Array.isArray(parsed.projects)) {
      throw new Error("config.local.json: 'projects' is not an array");
    }
    const newEntries = result.discovered.map((d) => renderProjectEntry(d, config.obsidianVault));
    parsed.projects = [...parsed.projects, ...newEntries];
    await writeFile(configPath, JSON.stringify(parsed, null, 2) + "\n");

    console.log(`[discover] ✓ ${newEntries.length} project(s) added to config.local.json`);
    console.log(`[discover]   backup: ${backupPath}`);
    console.log(`[discover]   run 'bun janus doctor' to validate paths.`);
  },
});
