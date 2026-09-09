import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "kanvas",
    description:
      "Render Dashboards/Kanvas.md: the cross-project board of what is in flight and what a weekly reported as blocking. Deterministic, no LLM call.",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Report the outcome without touching the vault",
      default: false,
    },
    "allow-empty": {
      // Not --force: that flag means "reprocess even if already done" everywhere
      // else in Janus, a non-destructive override. This one can wipe a board.
      type: "boolean",
      description: "Let a board with no cards replace an existing one (destroys its contents)",
      default: false,
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { runKanvas, todayLocal } = await import("../core/kanvas.ts");
    const { line } = await runKanvas({
      config: await loadConfig(),
      today: todayLocal(),
      dryRun: args["dry-run"],
      allowEmpty: args["allow-empty"],
    });
    console.log(line);
  },
});
