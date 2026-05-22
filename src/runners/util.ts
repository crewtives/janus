/**
 * Helpers shared by all CLI adapters.
 * Kept small and dependency-free so each adapter can pick what it uses
 * without paying extra surface area.
 */

export async function streamLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) onLine(line);
    }
  }
  if (buf.trim()) onLine(buf);
}

export async function drainToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: string[] = [];
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  return chunks.join("");
}

export function safeParse(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Copies process.env, dropping problematic keys (undefined values or those
 * that would force an auth mode different from what we want for subprocesses).
 *
 * Additionally enriches PATH with standard directories where `claude`, `bun`,
 * `gemini`, etc. typically live. This is critical when Janus runs via launchd
 * or systemd: both inherit a minimal PATH that does NOT include
 * `/opt/homebrew/bin`, `~/.local/bin`, `~/.bun/bin`. Without this enrichment,
 * subprocesses would fail with "Executable not found in $PATH".
 *
 * The enrichment is additive (preserves the original PATH at the front) and
 * never removes dirs. If the caller passes `enrichPath: false`, it is disabled.
 */
export function cleanEnv(
  env: NodeJS.ProcessEnv,
  deleteKeys: string[] = [],
  opts: { enrichPath?: boolean } = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  const toDelete = new Set(deleteKeys);
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (toDelete.has(k)) continue;
    out[k] = v;
  }
  if (opts.enrichPath !== false) {
    out.PATH = enrichPath(out.PATH ?? "", env.HOME);
  }
  return out;
}

/**
 * Returns a PATH enriched with the directories where the CLI tools Janus
 * invokes typically live. Preserves the original PATH at the front; only
 * appends dirs that aren't already present.
 *
 * Dirs appended (in order):
 *   - /opt/homebrew/bin    (Homebrew on Apple Silicon)
 *   - /usr/local/bin       (Homebrew on Intel + common installers)
 *   - $HOME/.local/bin     (official Claude Code installer)
 *   - $HOME/.bun/bin       (official Bun installer)
 *   - $HOME/.cargo/bin     (Rust tools — preventive)
 */
export function enrichPath(currentPath: string, home?: string): string {
  const segments = currentPath.split(":").filter(Boolean);
  const seen = new Set(segments);

  const candidates = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    home ? `${home}/.local/bin` : null,
    home ? `${home}/.bun/bin` : null,
    home ? `${home}/.cargo/bin` : null,
  ].filter((p): p is string => p !== null);

  for (const c of candidates) {
    if (!seen.has(c)) {
      segments.push(c);
      seen.add(c);
    }
  }
  return segments.join(":");
}
