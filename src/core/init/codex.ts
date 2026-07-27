import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const JANUS_CODEX_MARKER = "crewtives-janus";

export interface JanusCommandSpec {
  command: string;
  args: string[];
}

export function resolveJanusCommandSpec(opts: {
  execPath: string;
  main: string;
  repoRoot: string;
}): JanusCommandSpec {
  if (opts.main === opts.execPath) return { command: opts.execPath, args: [] };
  return {
    command: opts.execPath,
    args: ["run", join(opts.repoRoot, "bin", "janus.ts")],
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function codexHookCommand(spec: JanusCommandSpec, configPath: string): string {
  return [
    spec.command,
    ...spec.args,
    "context",
    "--config",
    configPath,
  ].map(shellQuote).join(" ") + ` # ${JANUS_CODEX_MARKER}`;
}

interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
  statusMessage?: string;
}

type HooksDocument = {
  hooks?: Record<string, Array<{ matcher?: string; hooks?: HookCommand[] }>>;
  [key: string]: unknown;
};

export function mergeCodexHooks(
  raw: unknown,
  command: string,
): { document: HooksDocument; changed: boolean } {
  const original = JSON.stringify(raw);
  const document: HooksDocument = raw && typeof raw === "object"
    ? structuredClone(raw as HooksDocument)
    : {};
  document.hooks ??= {};
  const starts = document.hooks.SessionStart ?? [];
  let found = false;
  for (const group of starts) {
    const hooks: HookCommand[] = [];
    for (const hook of group.hooks ?? []) {
      const isJanus = hook.type === "command" && hook.command.includes(JANUS_CODEX_MARKER);
      if (!isJanus) {
        hooks.push(hook);
        continue;
      }
      if (found) continue;
      found = true;
      hooks.push({
        ...hook,
        command,
        timeout: 10,
        statusMessage: "Loading Janus project memory",
      });
    }
    group.hooks = hooks;
  }
  if (!found) {
    starts.push({
      matcher: "*",
      hooks: [{
        type: "command",
        command,
        timeout: 10,
        statusMessage: "Loading Janus project memory",
      }],
    });
  }
  document.hooks.SessionStart = starts;
  return { document, changed: JSON.stringify(document) !== original };
}

/** Remove only Janus-owned SessionStart hooks, leaving all other hook config intact. */
export function removeCodexHooks(raw: unknown): { document: HooksDocument; changed: boolean } {
  const original = JSON.stringify(raw);
  const document: HooksDocument = raw && typeof raw === "object"
    ? structuredClone(raw as HooksDocument)
    : {};
  const starts = document.hooks?.SessionStart;
  if (!starts) return { document, changed: false };

  for (const group of starts) {
    group.hooks = (group.hooks ?? []).filter((hook) => !(
      hook.type === "command" && hook.command.includes(JANUS_CODEX_MARKER)
    ));
  }
  return { document, changed: JSON.stringify(document) !== original };
}

export async function installCodexHook(opts: {
  codexHome: string;
  configPath: string;
  commandSpec: JanusCommandSpec;
}): Promise<{ changed: boolean; path: string }> {
  const path = join(opts.codexHome, "hooks.json");
  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(path, "utf-8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const merged = mergeCodexHooks(raw, codexHookCommand(opts.commandSpec, opts.configPath));
  if (!merged.changed) return { changed: false, path };
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.janus.tmp`;
  await writeFile(temp, `${JSON.stringify(merged.document, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
  return { changed: true, path };
}

export async function uninstallCodexHook(opts: {
  codexHome: string;
}): Promise<{ changed: boolean; path: string }> {
  const path = join(opts.codexHome, "hooks.json");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf-8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { changed: false, path };
    throw error;
  }
  const cleaned = removeCodexHooks(raw);
  if (!cleaned.changed) return { changed: false, path };
  const temp = `${path}.janus.tmp`;
  await writeFile(temp, `${JSON.stringify(cleaned.document, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
  return { changed: true, path };
}

export function codexMcpServerSpec(
  spec: JanusCommandSpec,
  configPath: string,
): JanusCommandSpec {
  return {
    command: spec.command,
    args: [
      ...spec.args,
      "mcp",
      "--config",
      configPath,
    ],
  };
}

export function codexMcpArgs(spec: JanusCommandSpec, configPath: string): string[] {
  const server = codexMcpServerSpec(spec, configPath);
  return [
    "mcp", "add", "janus", "--", server.command,
    ...server.args,
  ];
}

interface CodexMcpTransport {
  type?: unknown;
  command?: unknown;
  args?: unknown;
}

export function codexMcpTransport(raw: unknown): CodexMcpTransport | null {
  if (!raw || typeof raw !== "object") return null;
  const transport = (raw as { transport?: unknown }).transport;
  return transport && typeof transport === "object"
    ? transport as CodexMcpTransport
    : null;
}

export function isCodexMcpMissing(stderr: string): boolean {
  return /(?:mcp )?server\b.{0,100}\b(?:not found|does not exist)\b|\bunknown (?:mcp )?server\b/i.test(stderr);
}

export async function ensureCodexMcp(opts: {
  commandSpec: JanusCommandSpec;
  configPath: string;
}): Promise<"installed" | "unchanged"> {
  const wanted = codexMcpServerSpec(opts.commandSpec, opts.configPath);
  const get = Bun.spawn(["codex", "mcp", "get", "janus", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const [getOut, getErr] = await Promise.all([
    new Response(get.stdout).text(),
    new Response(get.stderr).text(),
    get.exited,
  ]);
  if (get.exitCode === 0) {
    const transport = codexMcpTransport(JSON.parse(getOut));
    if (
      transport?.type === "stdio"
      && transport.command === wanted.command
      && JSON.stringify(transport.args ?? []) === JSON.stringify(wanted.args)
    ) {
      return "unchanged";
    }
    throw new Error("Codex MCP server 'janus' already exists with a different command; refusing to overwrite it");
  }

  if (!isCodexMcpMissing(getErr)) {
    throw new Error(`codex mcp get failed: ${getErr.trim() || `exit ${get.exitCode}`}`);
  }

  const add = Bun.spawn(["codex", ...codexMcpArgs(opts.commandSpec, opts.configPath)], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const [, addErr] = await Promise.all([
    new Response(add.stdout).text(),
    new Response(add.stderr).text(),
    add.exited,
  ]);
  if (add.exitCode !== 0) {
    throw new Error(`codex mcp add failed: ${addErr.trim() || `exit ${add.exitCode}`}`);
  }
  return "installed";
}

export async function removeCodexMcp(opts: {
  commandSpec: JanusCommandSpec;
  configPath: string;
}): Promise<"removed" | "unchanged" | "conflict"> {
  const wanted = codexMcpServerSpec(opts.commandSpec, opts.configPath);
  const get = Bun.spawn(["codex", "mcp", "get", "janus", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const [getOut, getErr] = await Promise.all([
    new Response(get.stdout).text(),
    new Response(get.stderr).text(),
    get.exited,
  ]);
  if (get.exitCode !== 0) {
    if (isCodexMcpMissing(getErr)) return "unchanged";
    throw new Error(`codex mcp get failed: ${getErr.trim() || `exit ${get.exitCode}`}`);
  }
  const transport = codexMcpTransport(JSON.parse(getOut));
  if (
    transport?.type !== "stdio"
    || transport.command !== wanted.command
    || JSON.stringify(transport.args ?? []) !== JSON.stringify(wanted.args)
  ) return "conflict";

  const remove = Bun.spawn(["codex", "mcp", "remove", "janus"], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const [, removeErr] = await Promise.all([
    new Response(remove.stdout).text(),
    new Response(remove.stderr).text(),
    remove.exited,
  ]);
  if (remove.exitCode !== 0) {
    throw new Error(`codex mcp remove failed: ${removeErr.trim() || `exit ${remove.exitCode}`}`);
  }
  return "removed";
}
