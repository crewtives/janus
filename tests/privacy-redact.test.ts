/**
 * Tests for `src/core/privacy/redact.ts`.
 *
 * Fixtures use *shape-only* fake tokens — never real credentials. Patterns
 * are deliberately permissive enough to match the synthetic shapes here so
 * the redactor can be exercised without leaking real keys into the repo.
 */
import { describe, expect, test } from "bun:test";
import {
  CORE_PATTERNS,
  compileAllowList,
  compileUserPattern,
  redact,
} from "../src/core/privacy/redact.ts";

describe("CORE_PATTERNS", () => {
  test("each built-in pattern redacts a shape-valid token mid-sentence", () => {
    const cases: Array<{ name: string; input: string; mustContain: string }> = [
      { name: "anthropic-key", input: "Found sk-ant-FAKE000000000000000000 in env.", mustContain: "<anthropic-key>" },
      { name: "openai-key", input: "Token sk-proj-FAKE0000000000000000000 leaked.", mustContain: "<openai-key>" },
      { name: "github-pat", input: "Used ghp_FAKE00000000000000000000000000000000 for the API.", mustContain: "<github-pat>" },
      { name: "aws-access-key", input: "Saw AKIAIOSFODNN7EXAMPLE in the logs.", mustContain: "<aws-access-key>" },
      { name: "jwt", input: "Header had eyJfake.eyJfake.signature attached.", mustContain: "<jwt>" },
      { name: "discord-webhook", input: "Sent to https://discord.com/api/webhooks/123/abcDEF_xyz today.", mustContain: "<discord-webhook>" },
      { name: "slack-webhook", input: "Posted to https://hooks.slack.com/services/T01ABC/B02DEF/xYz123 fine.", mustContain: "<slack-webhook>" },
      { name: "bearer-token", input: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456 worked.", mustContain: "Bearer <token>" },
      { name: "email", input: "Reach out to alice@example.com when ready.", mustContain: "<email>" },
    ];
    for (const c of cases) {
      const out = redact(c.input);
      expect(out, `${c.name} did not redact`).toContain(c.mustContain);
      // The original sensitive substring must not survive (except for the
      // bearer prefix, which we keep so the model still sees "Bearer <token>").
      if (c.name !== "bearer-token") {
        const sample = c.input.match(/(sk-ant-\S+|sk-proj-\S+|ghp_\S+|AKIA\S+|eyJ\S+|hooks\.slack\.com\S+|discord\.com\S+|alice@example\.com)/)?.[0];
        if (sample) expect(out).not.toContain(sample);
      }
    }
  });

  test("private-key block is collapsed even when multi-line", () => {
    const block = [
      "Some prose first.",
      "-----BEGIN RSA PRIVATE KEY-----",
      "AAAABBBBCCCCDDDDEEEE",
      "FFFFGGGGHHHHIIIIJJJJ",
      "-----END RSA PRIVATE KEY-----",
      "Trailing prose.",
    ].join("\n");
    const out = redact(block);
    expect(out).toContain("<private-key>");
    expect(out).not.toContain("AAAABBBB");
    expect(out).toContain("Some prose first.");
    expect(out).toContain("Trailing prose.");
  });

  test("token at start, end, and middle of line", () => {
    const at = redact("sk-ant-FAKE000000000000000000 at start");
    expect(at).toMatch(/^<anthropic-key>/);

    const end = redact("ending with sk-ant-FAKE000000000000000000");
    expect(end).toMatch(/<anthropic-key>$/);

    const mid = redact("text sk-ant-FAKE000000000000000000 more text");
    expect(mid).toBe("text <anthropic-key> more text");
  });
});

describe("path collapse", () => {
  test("repoRoot prefix becomes <repo>; intra-repo paths preserved", () => {
    const out = redact("Edited /home/alice/code/janus/src/core/template.ts today.", {
      repoRoot: "/home/alice/code/janus",
    });
    expect(out).toContain("<repo>/src/core/template.ts");
    expect(out).not.toContain("/home/alice/");
  });

  test("home paths outside the repo collapse to ~", () => {
    const out = redact("Logs at /Users/bob/Library/Logs/janus.log and /home/carol/.config/janus.");
    expect(out).toContain("~/Library/Logs/janus.log");
    expect(out).toContain("~/.config/janus");
    expect(out).not.toContain("/Users/bob");
    expect(out).not.toContain("/home/carol");
  });

  test("collapseHome: false leaves home paths alone", () => {
    const out = redact("path /Users/alice/notes.md", { collapseHome: false });
    expect(out).toContain("/Users/alice/notes.md");
  });
});

describe("allowList", () => {
  test("default allowList preserves noreply@anthropic.com (Co-Authored-By trailers)", () => {
    const out = redact("Co-Authored-By: Claude <noreply@anthropic.com>");
    expect(out).toContain("noreply@anthropic.com");
  });

  test("custom allowList preserves a specific domain", () => {
    const out = redact("Ping ops@example.com about it.", {
      allowList: [/ops@example\.com/],
    });
    expect(out).toContain("ops@example.com");
  });

  test("non-allowlisted emails still redact in the same text", () => {
    const out = redact("Co-Authored-By: Claude <noreply@anthropic.com>\nAlso copy alice@example.com");
    expect(out).toContain("noreply@anthropic.com");
    expect(out).toContain("<email>");
    expect(out).not.toContain("alice@example.com");
  });
});

describe("false positives", () => {
  test("a tag-shaped token without a TLD is not eaten as email", () => {
    const out = redact("Tagged 2025@v3 in the changelog");
    expect(out).toBe("Tagged 2025@v3 in the changelog");
  });

  test("the literal word 'bearer' inside prose is left alone", () => {
    const out = redact("This module is a bearer of bad news.");
    expect(out).toBe("This module is a bearer of bad news.");
  });
});

describe("config-driven extension", () => {
  test("disablePatterns skips a built-in", () => {
    const out = redact("alice@example.com", { disablePatterns: ["email"] });
    expect(out).toContain("alice@example.com");
  });

  test("extraPatterns applies user-defined regex after built-ins", () => {
    const out = redact("Internal ticket INT-12345 referenced.", {
      extraPatterns: [{ name: "internal-id", pattern: /INT-\d+/g, replacement: "<internal-id>" }],
    });
    expect(out).toContain("<internal-id>");
    expect(out).not.toContain("INT-12345");
  });

  test("compileUserPattern returns null for malformed regex", () => {
    const bad = compileUserPattern({ name: "broken", pattern: "[unclosed", replacement: "x" });
    expect(bad).toBeNull();
  });

  test("compileAllowList silently drops malformed entries", () => {
    const list = compileAllowList(["valid@", "[unclosed", "@anthropic\\.com$"]);
    expect(list.length).toBe(2);
  });
});

describe("disabled", () => {
  test("disabled: true returns input unchanged", () => {
    const sensitive = "Token sk-ant-FAKE000000000000000000 and email alice@example.com";
    expect(redact(sensitive, { disabled: true })).toBe(sensitive);
  });
});

describe("performance smoke", () => {
  test("a realistic prompt blob redacts in well under 50 ms", () => {
    const block = Array.from({ length: 50 }, (_, i) => {
      return [
        `Pulse for session ${i}:`,
        `User intent: investigate /Users/alice/projects/janus/src/core/template.ts line ${i}`,
        `Token leak attempt: ghp_FAKE${"0".repeat(36)}`,
        `Email: dev${i}@example.com asked for help.`,
        `Bearer ABC${"x".repeat(40)} was rejected.`,
        "",
      ].join("\n");
    }).join("\n");
    const start = performance.now();
    redact(block, { repoRoot: "/Users/alice/projects/janus" });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  test("unterminated PRIVATE KEY block does not hang the regex engine", () => {
    const malformed = "-----BEGIN RSA PRIVATE KEY-----\n" + "A".repeat(5000);
    const start = performance.now();
    const out = redact(malformed);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
    // Either redacted (if engine matched lazily up to EOF) or left alone — both
    // are acceptable; the catastrophic case would be a hang, which the timing
    // assertion above guards against.
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("CORE_PATTERNS metadata", () => {
  test("all built-in patterns use the /g flag", () => {
    for (const p of CORE_PATTERNS) {
      expect(p.pattern.flags, p.name).toContain("g");
    }
  });
});
