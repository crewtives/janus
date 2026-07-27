import { homedir } from "node:os";
import { join } from "node:path";

export function resolveCodexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

export async function getCodexAuthStatus(timeoutMs = 10_000): Promise<{
  loggedIn: boolean;
  detail: string;
}> {
  const proc = Bun.spawn(["codex", "login", "status"], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const detail = stdout.trim() || stderr.trim();
  return {
    loggedIn: proc.exitCode === 0,
    detail: detail.split("\n").at(-1) ?? "",
  };
}
