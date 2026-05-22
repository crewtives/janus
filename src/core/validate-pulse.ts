export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_STATUSES = new Set(["idle", "inferring", "stuck", "some-drift", "on-track", "idle-streak", "quiet-streak"]);

const REQUIRED_FRONTMATTER_FIELDS = ["date", "project", "status", "commits", "prompt_version"];

/**
 * Validates the content of an LLM-generated daily pulse.
 * - Complete YAML frontmatter, with required fields and a valid status.
 * - "## TL;DR" heading present.
 * - No prompt leftovers (instructions, unresolved eta markers).
 * - No text before the frontmatter.
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

  // 1. Frontmatter at the top, no preamble.
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    errors.push("does not start with frontmatter '---'");
  }
  if (/^```(?:markdown|md)?\r?\n/.test(content)) {
    errors.push("output wrapped in a code fence (```markdown) — must be plain markdown");
  }

  // 2. Frontmatter closes.
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
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
  if (!/^##\s+TL;DR\b/m.test(content)) {
    errors.push('missing heading "## TL;DR"');
  }

  // 6. dataview block at the end (warning, not an error).
  if (!content.includes("```dataview")) {
    warnings.push("no dataview block");
  }

  // 7. Prompt instructions must not appear in the output.
  if (content.includes("# INSTRUCCIONES DE OUTPUT") || content.includes("# OUTPUT INSTRUCTIONS")) {
    errors.push("output contains prompt instructions — the agent did not return only the report");
  }

  // 8. No unresolved Eta tags should remain.
  if (/<%[=\-]?\s/.test(content)) {
    errors.push("output contains unresolved Eta tags (<% %>)");
  }

  // 9. `pulse` tag in frontmatter.
  if (fmMatch && !/^tags:\s*\[.*\bpulse\b.*\]/m.test(fmMatch[1] ?? "")) {
    warnings.push("frontmatter has no 'pulse' tag");
  }

  return { valid: errors.length === 0, errors, warnings };
}
