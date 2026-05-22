import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "ask",
    description: "Full-text search across the vault. JSONL output by default (MCP-ready).",
  },
  args: {
    query: {
      type: "positional",
      description: "FTS5 query (space=AND, OR explicit, phrase between double quotes)",
      required: true,
    },
    project: {
      type: "string",
      description: "Filter by project",
    },
    kind: {
      type: "string",
      description: "Filter by kind: pulse,daily,weekly,monthly,quarterly,yearly,track,index (comma-separated)",
    },
    since: {
      type: "string",
      description: "Minimum date (YYYY-MM-DD)",
    },
    until: {
      type: "string",
      description: "Maximum date (YYYY-MM-DD)",
    },
    limit: {
      type: "string",
      description: "Maximum number of results (default 10)",
    },
    format: {
      type: "string",
      description: "jsonl (default) | markdown | text",
      default: "jsonl",
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { SearchIndex } = await import("../core/search-index.ts");
    const config = await loadConfig();
    const idx = SearchIndex.open(config.stateDir!);

    const kindArg = args.kind as string | undefined;
    const kinds = kindArg ? (kindArg.split(",").map((k) => k.trim()) as Array<"pulse" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "track" | "index">) : undefined;

    const hits = idx.search({
      query: args.query as string,
      project: args.project as string | undefined,
      kind: kinds,
      since: args.since as string | undefined,
      until: args.until as string | undefined,
      limit: args.limit ? parseInt(args.limit as string, 10) : 10,
    });
    idx.close();

    const format = (args.format as string).toLowerCase();
    if (format === "jsonl") {
      for (const hit of hits) {
        // Output designed for MCP / external agent consumption.
        // Each line is a parseable JSON with a complete citation.
        const citation = `${hit.docId}#${hit.kind}/${hit.date}`;
        process.stdout.write(JSON.stringify({
          doc_id: hit.docId,
          citation,
          project: hit.project,
          date: hit.date,
          kind: hit.kind,
          status: hit.status,
          title: hit.title,
          snippet: hit.snippet,
          score: hit.score,
        }) + "\n");
      }
    } else if (format === "markdown") {
      if (hits.length === 0) {
        console.log("*No results.*");
        return;
      }
      console.log(`# Search results: \`${args.query}\` (${hits.length} hits)`);
      console.log("");
      for (const hit of hits) {
        const projTag = hit.project ? `\`${hit.project}\`` : "";
        const kindTag = `\`${hit.kind}\``;
        console.log(`## [${hit.date}] ${hit.title} ${projTag} ${kindTag}`);
        console.log("");
        console.log(`> ${hit.snippet}`);
        console.log("");
        console.log(`- doc: \`${hit.docId}\``);
        console.log(`- score: ${hit.score.toFixed(2)}`);
        console.log("");
      }
    } else {
      // plain text (for humans in the terminal)
      if (hits.length === 0) {
        console.log("(no results)");
        return;
      }
      for (const hit of hits) {
        console.log(`${hit.date} · ${hit.kind.padEnd(10)} · ${hit.project ?? "—"} · score=${hit.score.toFixed(2)}`);
        console.log(`  ${hit.title}`);
        console.log(`  ${hit.snippet.replace(/\n/g, " ")}`);
        console.log(`  → ${hit.docId}`);
        console.log("");
      }
    }
  },
});
