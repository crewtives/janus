import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "init",
    description: "Onboarding wizard: configures config.local.json + scheduler + validates with doctor",
  },
  args: {
    yes: {
      type: "boolean",
      description: "In re-check mode, accept defaults for unchanged fields",
      default: false,
    },
  },
  async run({ args }) {
    const { runInit } = await import("../core/init/index.ts");
    const code = await runInit({ yes: args.yes });
    process.exit(code);
  },
});
