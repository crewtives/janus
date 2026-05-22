import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "doctor",
    description: "Verify the environment is ready (claude CLI, git, paths, auth)",
  },
  async run() {
    const { runDoctor } = await import("../core/doctor.ts");
    const ok = await runDoctor();
    process.exit(ok ? 0 : 1);
  },
});
