export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Only set when a preamble was stripped: the content the caller must persist instead of its own. */
  sanitized?: string;
}

const VALID_STATUSES = new Set(["idle", "inferring", "stuck", "some-drift", "on-track", "idle-streak", "quiet-streak"]);

const REQUIRED_FRONTMATTER_FIELDS = ["date", "project", "status", "commits", "prompt_version"];

const CODE_FENCE_START = /^```(?:markdown|md)?\r?\n/;

/** A frontmatter block that really opens on a `key: value` line and closes with another `---`. */
const FRONTMATTER_BLOCK = /^---\r?\n[A-Za-z_][\w-]*:[^\n]*\r?\n(?:[^\n]*\r?\n)*?---\r?\n/;

/**
 * Returns the content from the frontmatter onward when the model prepended prose to the report,
 * or null when there is nothing safe to strip.
 *
 * On 2026-07-13 a complete, well-formed pulse was thrown away because the model prefixed it with a
 * 50-word aside; the retry resent the same prompt and lost the day again. Dropping a day of signal
 * costs more than keeping a stray paragraph out of the vault.
 *
 * Deliberately conservative: it strips only when what remains opens AND closes a frontmatter block,
 * so a truly malformed answer still fails validation instead of being half-salvaged. A fence opened
 * before the frontmatter also aborts the strip: its closing fence would outlive the cut and turn an
 * error validatePulse already reports into silent corruption in the vault.
 */
function stripPulsePreamble(content: string): string | null {
  if (content.startsWith("---\n") || content.startsWith("---\r\n")) return null;

  let offset = 0;
  for (const line of content.split("\n")) {
    if (line.startsWith("```")) return null;
    if (line.trimEnd() === "---") {
      const candidate = content.slice(offset);
      if (FRONTMATTER_BLOCK.test(candidate)) return candidate;
    }
    offset += line.length + 1;
  }
  return null;
}

/**
 * Validates the content of an LLM-generated daily pulse.
 * - Complete YAML frontmatter, with required fields and a valid status.
 * - "## TL;DR" heading present.
 * - No prompt leftovers (instructions, unresolved eta markers).
 * - No text before the frontmatter — a salvageable preamble is stripped into `sanitized` and
 *   downgraded to a warning; everything else stays a hard error.
 *
 * Returns hard errors (break the pulse) and warnings (suspicious but non-blocking).
 */
export function validatePulse(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!content || content.trim().length === 0) {
    errors.push("empty content");
    return { valid: false, errors, warnings };
  }

  const stripped = stripPulsePreamble(content);
  const body = stripped ?? content;
  if (stripped !== null) {
    warnings.push(`stripped ${content.length - stripped.length} chars of preamble before the frontmatter`);
  }

  // 1. Frontmatter at the top, no preamble.
  if (!body.startsWith("---\n") && !body.startsWith("---\r\n")) {
    errors.push("does not start with frontmatter '---'");
  }
  if (CODE_FENCE_START.test(body)) {
    errors.push("output wrapped in a code fence (```markdown) — must be plain markdown");
  }

  // 2. Frontmatter closes.
  const fmMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!fmMatch) {
    errors.push("frontmatter does not close (missing second '---')");
  } else {
    const fm = fmMatch[1] ?? "";
    // 3. Required fields.
    for (const field of REQUIRED_FRONTMATTER_FIELDS) {
      if (!new RegExp(`^${field}:`, "m").test(fm)) {
        errors.push(`missing frontmatter field: ${field}`);
      }
    }
    // 4. valid status.
    const statusMatch = fm.match(/^status:\s*(.+)$/m);
    if (statusMatch && statusMatch[1]) {
      const status = statusMatch[1].trim().replace(/^["']|["']$/g, "");
      if (!VALID_STATUSES.has(status)) {
        errors.push(`invalid status: "${status}" (expected one of ${[...VALID_STATUSES].join(", ")})`);
      }
    }
  }

  // 5. Required TL;DR section.
  if (!/^##\s+TL;DR\b/m.test(body)) {
    errors.push('missing heading "## TL;DR"');
  }

  // 6. dataview block at the end (warning, not an error).
  if (!body.includes("```dataview")) {
    warnings.push("no dataview block");
  }

  // 7. Prompt instructions must not appear in the output.
  if (body.includes("# INSTRUCCIONES DE OUTPUT") || body.includes("# OUTPUT INSTRUCTIONS")) {
    errors.push("output contains prompt instructions — the agent did not return only the report");
  }

  // 8. No unresolved Eta tags should remain.
  if (/<%[=\-]?\s/.test(body)) {
    errors.push("output contains unresolved Eta tags (<% %>)");
  }

  // 9. `pulse` tag in frontmatter.
  if (fmMatch && !/^tags:\s*\[.*\bpulse\b.*\]/m.test(fmMatch[1] ?? "")) {
    warnings.push("frontmatter has no 'pulse' tag");
  }

  return { valid: errors.length === 0, errors, warnings, ...(stripped !== null ? { sanitized: stripped } : {}) };
}
