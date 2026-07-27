import type { JanusConfig } from "../config/types.ts";
import { getProjectContext } from "./project-context.ts";

interface SessionStartInput {
  cwd?: unknown;
  hook_event_name?: unknown;
}

export async function buildCodexSessionStartOutput(
  input: unknown,
  config: JanusConfig,
): Promise<Record<string, unknown> | null> {
  const event = input && typeof input === "object" ? input as SessionStartInput : {};
  if (event.hook_event_name !== undefined && event.hook_event_name !== "SessionStart") return null;
  const cwd = typeof event.cwd === "string" ? event.cwd : "";
  const context = await getProjectContext(cwd, config.projects);
  if (!context.tracked) return null;

  const additionalContext = context.state === "ready"
    ? [
        `Janus tracks this repository as "${context.project}".`,
        "Use this project memory before substantive work:",
        "",
        context.spine ?? "",
        "",
        "For deeper history, call the Janus MCP tools.",
      ].join("\n")
    : `Janus tracks this repository as "${context.project}", but no project spine exists yet. Use the Janus MCP tools for available history.`;

  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  };
}
