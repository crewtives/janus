import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "note",
    description: "Generate a Note draft for the portfolio (style of crewtives.com/notes/). Uses material from the vault (pulses, weeklies, spines, ADRs) as context.",
  },
  args: {
    topic: {
      type: "positional",
      description: "Note topic. Short phrase or slug (e.g. 'provider-portable runners' or 'agent-native-everything').",
      required: true,
    },
    title: {
      type: "string",
      description: "Suggested title (optional). The LLM may iterate. If omitted, it invents one.",
    },
    slug: {
      type: "string",
      description: "Filename slug (optional). Default: derived from the topic.",
    },
    date: {
      type: "string",
      description: "File date YYYY-MM-DD (optional). Default: today.",
    },
    project: {
      type: "string",
      description: "Filter context to a specific project (optional).",
    },
    limit: {
      type: "string",
      description: "Max docs to include as context. Default: 8.",
    },
    "dry-run": {
      type: "boolean",
      description: "Render the prompt without invoking the LLM. Shows how many docs would be included.",
      default: false,
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { generateNoteDraft } = await import("../core/notes.ts");
    const config = await loadConfig();

    const r = await generateNoteDraft(config, {
      topic: args.topic as string,
      title: args.title as string | undefined,
      slug: args.slug as string | undefined,
      date: args.date as string | undefined,
      project: args.project as string | undefined,
      contextLimit: args.limit ? parseInt(args.limit as string, 10) : undefined,
      dryRun: args["dry-run"] as boolean,
    });

    if (args["dry-run"]) {
      console.log(`[note] dry-run · slug=${r.slug} · ${r.contextDocs} context docs · prompt=${r.promptChars} chars`);
      console.log(`[note] project: ${r.project ?? "(none — orphan)"} · target path: ${r.path}`);
      return;
    }

    console.log(`[note] ✓ ${r.path}`);
    console.log(`[note] project: ${r.project ?? "(none — orphan)"} · ${r.contextDocs} context docs · prompt=${r.promptChars} chars · output=${r.outputChars} chars`);
    console.log("");
    console.log("Next step: edit the draft and move it into the Crewtives CMS.");
  },
});
