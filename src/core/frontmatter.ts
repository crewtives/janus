/**
 * Line-oriented YAML frontmatter editor (Fase 2 / U1).
 *
 * The Fase 2 rewrite and the forward writers only need to: add canonical tags,
 * stamp prev/next scalars, read freeze flags, and prepend a block to notes that
 * have none. A full parse→serialize round-trip is a byte-for-byte footgun (it
 * would have to reproduce every quoting/alias/spacing choice); instead this
 * module edits the frontmatter as text and leaves every untouched line verbatim.
 * Idempotency then falls out for free: an edit that changes nothing returns the
 * input unchanged, and untouched lines are byte-identical by construction.
 *
 * Vault reality this is calibrated to: inline-flow arrays only
 * (`tags: [a, b]`, `aliases: ["x"]`), no block-style tags, no CRLF. The fence
 * must be the first line — a `Notes/` draft or an embedded `---` HR in prose is
 * never mistaken for frontmatter.
 */

export interface FrontmatterSplit {
  /** Inner frontmatter text (no fences). Empty string when hadFrontmatter is false. */
  frontmatter: string;
  /** Everything after the closing fence (or the whole content when no frontmatter). */
  body: string;
  hadFrontmatter: boolean;
}

const OPEN = "---\n";

/**
 * Split content into its frontmatter and body. The opening fence must be the
 * very first line; the closing fence is the first `\n---` after it. Reassemble
 * losslessly with `joinFrontmatter`.
 */
export function splitFrontmatter(content: string): FrontmatterSplit {
  if (!content.startsWith(OPEN)) {
    return { frontmatter: "", body: content, hadFrontmatter: false };
  }
  const after = content.slice(OPEN.length);
  // Lazy up to the first closing fence; `suffix` keeps everything after `---`
  // (its leading newline included) so join is byte-for-byte.
  const m = after.match(/^([\s\S]*?)\n---(\n[\s\S]*|)$/);
  if (!m) {
    return { frontmatter: "", body: content, hadFrontmatter: false };
  }
  return { frontmatter: m[1]!, body: m[2]!, hadFrontmatter: true };
}

/** Inverse of `splitFrontmatter` for a frontmatter'd file: byte-for-byte. */
export function joinFrontmatter(frontmatter: string, body: string): string {
  return `${OPEN}${frontmatter}\n---${body}`;
}

/** Build a fresh frontmatter block in front of a body that had none (R13 notes). */
export function prependFrontmatter(lines: string[], body: string): string {
  return `${OPEN}${lines.join("\n")}\n---\n\n${body}`;
}

const TAGS_RE = /^tags:\s*\[(.*)\]\s*$/m;

/** Parse the inline `tags: [...]` array from a frontmatter text ([] if absent). */
export function getTags(frontmatter: string): string[] {
  const m = frontmatter.match(TAGS_RE);
  if (!m) return [];
  return m[1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Merge `newTags` into the `tags:` line, preserving existing order and creating
 * the line (at the end of the block) when absent. Idempotent: adding only
 * already-present tags returns the input unchanged.
 */
export function addTags(frontmatter: string, newTags: string[]): string {
  const m = frontmatter.match(TAGS_RE);
  if (m) {
    const existing = m[1]!.split(",").map((s) => s.trim()).filter(Boolean);
    const missing = newTags.filter((t) => !existing.includes(t));
    if (missing.length === 0) return frontmatter;
    const line = `tags: [${[...existing, ...missing].join(", ")}]`;
    return frontmatter.replace(m[0], () => line);
  }
  const line = `tags: [${newTags.join(", ")}]`;
  return frontmatter.length === 0 ? line : `${frontmatter}\n${line}`;
}

/**
 * Insert or replace a scalar `key: value` line, appending when absent.
 * Idempotent when the value is unchanged. `key` must be a plain identifier.
 */
export function setKey(frontmatter: string, key: string, value: string): string {
  const re = new RegExp(`^${key}:.*$`, "m");
  const line = `${key}: ${value}`;
  const cur = frontmatter.match(re);
  if (cur) {
    if (cur[0] === line) return frontmatter;
    return frontmatter.replace(re, () => line);
  }
  return frontmatter.length === 0 ? line : `${frontmatter}\n${line}`;
}

/**
 * Remove a scalar `key: value` line if present. Idempotent: absent key → input
 * unchanged. Used for prev/next at a chronology boundary (first pulse has no
 * `prev:`, last has no `next:`) so a stale key left by an earlier state — e.g.
 * a compacted streak deleting the successor — is cleared, not kept.
 */
export function removeKey(frontmatter: string, key: string): string {
  const re = new RegExp(`^${key}:.*$`, "m");
  if (!re.test(frontmatter)) return frontmatter;
  return frontmatter
    .split("\n")
    .filter((line) => !new RegExp(`^${key}:`).test(line))
    .join("\n");
}

/**
 * Read the freeze flags from the frontmatter BLOCK only (R19). Body prose that
 * happens to contain `needs_review: false` must never freeze a note — 274 notes
 * mention it in prose, zero carry it in frontmatter. Returns null when absent.
 */
export function readFreezeFlags(content: string): { managed: boolean | null; needsReview: boolean | null } {
  const { frontmatter, hadFrontmatter } = splitFrontmatter(content);
  if (!hadFrontmatter) return { managed: null, needsReview: null };
  const readBool = (key: string): boolean | null => {
    const m = frontmatter.match(new RegExp(`^${key}:\\s*(\\S+)\\s*$`, "m"));
    if (!m) return null;
    const v = m[1]!.toLowerCase();
    return v === "true" ? true : v === "false" ? false : null;
  };
  return { managed: readBool("managed_by_janus"), needsReview: readBool("needs_review") };
}

/** True when a note is user-canonical and must be skipped by the rewrite (R19). */
export function isFrozen(content: string): boolean {
  const f = readFreezeFlags(content);
  return f.managed === false || f.needsReview === false;
}
