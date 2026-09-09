import { defineCommand } from "citty";
import type { JanusConfig } from "../config/types.ts";
import type { BlockerSourceOutcome, WriteOutcome, WriteResult } from "../core/kanvas.ts";

/** The guards that end in a refusal, as opposed to a write or a no-op. */
const REFUSALS: readonly WriteOutcome[] = ["frozen", "not-ours", "degenerate", "invalid"];

function verdict(result: WriteResult, dryRun: boolean): string {
  if (REFUSALS.includes(result.outcome)) return `refused (${result.outcome}): ${result.detail}`;
  if (result.outcome === "written") return dryRun ? "would write" : "written";
  return result.outcome;
}

/**
 * One line, always. A run that prints nothing when it declines to write is
 * indistinguishable from a crash, and a refusal is only recoverable if the user
 * is told which guard fired.
 */
export function formatKanvasResult(opts: {
  result: WriteResult;
  dryRun: boolean;
  stateDir: string | undefined;
  blockedOutcome: BlockerSourceOutcome;
}): string {
  const { result } = opts;
  const prefix = opts.dryRun ? "dry-run — " : "";
  // The state dir is named on every run because the blocker lane silently reads
  // as empty when the verb runs from a directory whose state.db is elsewhere.
  const state = opts.stateDir ?? "unset";
  const stateNote = opts.blockedOutcome === "unreachable" ? " (no state.db — blocked lane unknown)" : "";
  return (
    `[kanvas] ${prefix}${verdict(result, opts.dryRun)}` +
    ` · rendered ${result.rendered} · summarized ${result.summarized} · declined ${result.declined}` +
    ` · state ${state}${stateNote} · board ${result.path}`
  );
}

export async function runKanvas(opts: {
  config: JanusConfig;
  today: string;
  dryRun?: boolean;
  allowEmpty?: boolean;
}): Promise<{ result: WriteResult; line: string }> {
  const { buildBoardModel, writeBoard } = await import("../core/kanvas.ts");
  const model = await buildBoardModel({ config: opts.config, today: opts.today });
  const result = await writeBoard({
    model,
    vaultPath: opts.config.obsidianVault,
    allowEmpty: opts.allowEmpty,
    dryRun: opts.dryRun,
  });
  return {
    result,
    line: formatKanvasResult({
      result,
      dryRun: opts.dryRun ?? false,
      stateDir: opts.config.stateDir,
      blockedOutcome: model.blockedOutcome,
    }),
  };
}

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
    const config = await loadConfig();
    const { line } = await runKanvas({
      config,
      today: new Date().toISOString().slice(0, 10),
      dryRun: args["dry-run"],
      allowEmpty: args["allow-empty"],
    });
    console.log(line);
  },
});
