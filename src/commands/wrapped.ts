import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "wrapped",
    description: "Generate the Janus Wrapped — cross-project yearly or per-project anniversary.",
  },
  args: {
    year: {
      type: "string",
      description: "Year (YYYY). Default: previous year.",
    },
    project: {
      type: "string",
      description: "If passed, generates a per-project Wrapped. Otherwise yearly cross-project.",
    },
    "dry-run": {
      type: "boolean",
      description: "Don't invoke the LLM; only compute data + deterministic personality. Doesn't write.",
      default: false,
    },
    format: {
      type: "string",
      description: "Output format: markdown | html | png. Default markdown.",
      default: "markdown",
    },
    "deterministic-only": {
      type: "boolean",
      description: "Force deterministic fallback for the markdown (no LLM).",
      default: false,
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { aggregateWrappedData } = await import("../core/wrapped/aggregator.ts");
    const { computePersonality } = await import("../core/wrapped/personality.ts");
    const { renderWrapped } = await import("../core/wrapped/renderer.ts");

    const config = await loadConfig();
    const year = (args.year as string | undefined) ?? String(new Date().getFullYear() - 1);
    if (!/^\d{4}$/.test(year)) {
      throw new Error(`--year invalid: ${year} (expected YYYY)`);
    }
    const yearNum = parseInt(year, 10);
    const project = args.project as string | undefined;
    const dryRun = Boolean(args["dry-run"]);
    const format = (args.format as string) ?? "markdown";
    const deterministicOnly = Boolean(args["deterministic-only"]);

    if (!["markdown", "html", "png"].includes(format)) {
      throw new Error(`--format invalid: ${format} (markdown | html | png)`);
    }

    const scope: "yearly" | "project" = project ? "project" : "yearly";
    console.log(`[wrapped] scope=${scope} year=${year}${project ? ` project=${project}` : ""} format=${format} dry-run=${dryRun}`);

    const data = await aggregateWrappedData({
      config,
      scope,
      year: yearNum,
      project,
    });
    console.log(`[wrapped] data aggregated: ${data.metrics.pulsesActive} pulses, ${data.topTracks.length} top tracks, ${data.topDecisions.length} top decisions`);

    data.personality = await computePersonality({
      config,
      data,
      deterministicOnly: dryRun || deterministicOnly,
    });
    console.log(`[wrapped] personality: ${data.personality.archetype} (confidence ${data.personality.confidence.toFixed(2)})`);

    if (dryRun) {
      console.log(`[wrapped] dry-run — skip filesystem`);
      console.log(`[wrapped] sample data:\n${JSON.stringify({ metrics: data.metrics, topTracks: data.topTracks.slice(0, 3), personality: { archetype: data.personality.archetype } }, null, 2)}`);
      return;
    }

    if (format === "markdown") {
      const result = await renderWrapped({ config, data, deterministicOnly });
      console.log(`[wrapped] ✓ ${result.path}`);
      console.log(`[wrapped]   - generated via ${result.llmGenerated ? "LLM" : "deterministic fallback"}`);
    } else if (format === "html") {
      const { renderWrappedHtml } = await import("../core/wrapped/html.ts");
      const result = await renderWrappedHtml({ config, data });
      console.log(`[wrapped] ✓ ${result.path}`);
    } else if (format === "png") {
      const { renderWrappedPng } = await import("../core/wrapped/png.ts");
      const result = await renderWrappedPng({ config, data });
      console.log(`[wrapped] ✓ ${result.path} (${(result.bytes / 1024).toFixed(1)} KB)`);
    }
  },
});
