import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "context",
    description: "Emit Codex SessionStart context for a Janus-tracked repository",
  },
  args: {
    config: {
      type: "string",
      description: "Absolute Janus config path selected during integration setup",
    },
  },
  async run({ args }) {
    const { loadConfig } = await import("../config/loader.ts");
    const { buildCodexSessionStartOutput } = await import("../core/codex-hook.ts");
    const inputText = await Bun.stdin.text();
    let input: unknown = {};
    try {
      input = inputText.trim() ? JSON.parse(inputText) : {};
    } catch {
      return;
    }
    const config = await loadConfig(args.config);
    const output = await buildCodexSessionStartOutput(input, config);
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  },
});
