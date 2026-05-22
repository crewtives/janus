import { defineCommand } from "citty";

const create = defineCommand({
  meta: {
    name: "create",
    description: "Create a new ADR (Architecture Decision Record) under <vault>/Decisions/",
  },
  args: {
    title: {
      type: "string",
      description: "ADR title (e.g. \"Adopt Bun + SQLite for local state\")",
      required: true,
    },
    project: {
      type: "string",
      description: "Project it belongs to (optional)",
    },
    status: {
      type: "string",
      description: "proposed | accepted (default) | deprecated | superseded",
      default: "accepted",
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { createAdr } = await import("../core/adr.ts");
    const config = await loadConfig();
    const r = await createAdr({
      vaultPath: config.obsidianVault,
      title: args.title as string,
      project: args.project as string | undefined,
      status: args.status as "proposed" | "accepted" | "deprecated" | "superseded",
    });
    console.log(`[adr] ✓ ADR-${String(r.number).padStart(3, "0")} created: ${r.path}`);
    console.log(`[adr]   edit the Context/Decision/Consequences/Alternatives sections by hand or via /ce-* skills`);
  },
});

const promote = defineCommand({
  meta: {
    name: "promote",
    description: "Promote a specific decision from a pulse (`^decision-N`) into an ADR",
  },
  args: {
    pulse: {
      type: "string",
      description: "Pulse filename (e.g. \"2026-05-19--fly-foo\") or absolute path",
      required: true,
    },
    decision: {
      type: "string",
      description: "Block ID (e.g. \"decision-1\")",
      required: true,
    },
    title: {
      type: "string",
      description: "Canonical title for the ADR",
      required: true,
    },
    project: {
      type: "string",
      description: "Project override (if it can't be inferred from the filename)",
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { promoteDecisionToAdr } = await import("../core/adr.ts");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const config = await loadConfig();

    const pulseArg = args.pulse as string;
    let pulsePath = pulseArg;
    if (!existsSync(pulsePath)) {
      // Look in some Projects/*/pulse/<filename>.md
      const fname = pulseArg.endsWith(".md") ? pulseArg : `${pulseArg}.md`;
      const glob = new Bun.Glob(`Projects/**/pulse/${fname}`);
      let found: string | null = null;
      for await (const rel of glob.scan({ cwd: config.obsidianVault, absolute: false })) {
        found = join(config.obsidianVault, rel);
        break;
      }
      // And in _archive
      if (!found) {
        const glob2 = new Bun.Glob(`Projects/**/_archive/**/${fname}`);
        for await (const rel of glob2.scan({ cwd: config.obsidianVault, absolute: false })) {
          found = join(config.obsidianVault, rel);
          break;
        }
      }
      if (!found) throw new Error(`Pulse not found: ${pulseArg}`);
      pulsePath = found;
    }

    const r = await promoteDecisionToAdr({
      vaultPath: config.obsidianVault,
      pulsePath,
      decisionId: args.decision as string,
      title: args.title as string,
      project: args.project as string | undefined,
    });
    console.log(`[adr] ✓ ADR-${String(r.number).padStart(3, "0")} created from decision \`^${args.decision}\` in the pulse`);
    console.log(`[adr]   ADR: ${r.path}`);
    console.log(`[adr]   Pulse annotated with → [[${r.filename}]]`);
  },
});

const list = defineCommand({
  meta: { name: "list", description: "List every ADR in the vault" },
  async run() {
    const { loadConfig } = await import("../config/loader.ts");
    const { listAdrs } = await import("../core/adr.ts");
    const config = await loadConfig();
    const adrs = await listAdrs(config.obsidianVault);
    if (adrs.length === 0) {
      console.log("(no ADRs)");
      return;
    }
    for (const a of adrs) {
      const proj = a.project ? `[${a.project}] ` : "";
      const sup = a.supersededBy ? ` (superseded by ADR-${String(a.supersededBy).padStart(3, "0")})` : "";
      console.log(`ADR-${String(a.number).padStart(3, "0")} · ${a.status.padEnd(10)} · ${a.date} · ${proj}${a.title}${sup}`);
    }
  },
});

export default defineCommand({
  meta: {
    name: "adr",
    description: "Manage ADRs (Architecture Decision Records)",
  },
  subCommands: { create, promote, list },
});
