import { describe, expect, test } from "bun:test";
import {
  splitFrontmatter,
  joinFrontmatter,
  prependFrontmatter,
  getTags,
  addTags,
  setKey,
  readFreezeFlags,
  isFrozen,
} from "../src/core/frontmatter.ts";

// Real frontmatter shapes sampled from the vault (byte-for-byte).
const PULSE = `---
date: 2026-05-25
project: myorg-core
status: idle
commits: 0
tracks: []
tags: [pulse, pulse/myorg-core]
aliases: ["myorg-core Pulse 2026-05-25"]
---

## TL;DR

body here.
`;

const ROADMAP = `---
type: roadmap
project: myorg-core
generated_at: 2026-06-02T08:07:33.045Z
source: pulse-inference
needs_review: true
---

# Roadmap
`;

const NOTE = `# Vanilla beats SDK for a 4-tool MCP server

**Topic:** Architecture

Some prose with an embedded HR below:

---

More prose.
`;

describe("frontmatter — split/join round-trip (byte-for-byte)", () => {
  for (const [name, content] of [["pulse", PULSE], ["roadmap", ROADMAP]] as const) {
    test(`join(split(${name})) === ${name}`, () => {
      const { frontmatter, body, hadFrontmatter } = splitFrontmatter(content);
      expect(hadFrontmatter).toBe(true);
      expect(joinFrontmatter(frontmatter, body)).toBe(content);
    });
  }

  test("closing fence with no trailing newline round-trips", () => {
    const c = `---\ntype: x\n---`;
    const s = splitFrontmatter(c);
    expect(s.hadFrontmatter).toBe(true);
    expect(joinFrontmatter(s.frontmatter, s.body)).toBe(c);
  });

  test("a Notes draft (no leading fence) is all body, not fooled by an embedded --- HR", () => {
    const s = splitFrontmatter(NOTE);
    expect(s.hadFrontmatter).toBe(false);
    expect(s.body).toBe(NOTE);
    expect(s.frontmatter).toBe("");
  });
});

describe("frontmatter — getTags / addTags", () => {
  test("getTags parses the inline flow array", () => {
    const { frontmatter } = splitFrontmatter(PULSE);
    expect(getTags(frontmatter)).toEqual(["pulse", "pulse/myorg-core"]);
  });

  test("getTags returns [] when no tags line (roadmap)", () => {
    const { frontmatter } = splitFrontmatter(ROADMAP);
    expect(getTags(frontmatter)).toEqual([]);
  });

  test("addTags appends canonical tags, keeps the bare `pulse` (KD1)", () => {
    const { frontmatter } = splitFrontmatter(PULSE);
    const out = addTags(frontmatter, ["type/pulse", "project/myorg-core"]);
    expect(out).toContain("tags: [pulse, pulse/myorg-core, type/pulse, project/myorg-core]");
    expect(getTags(out)).toContain("pulse"); // dashboards key on contains(tags,"pulse")
  });

  test("addTags is idempotent — re-adding present tags is a byte-for-byte no-op", () => {
    const { frontmatter } = splitFrontmatter(PULSE);
    const once = addTags(frontmatter, ["type/pulse", "project/myorg-core"]);
    const twice = addTags(once, ["type/pulse", "project/myorg-core"]);
    expect(twice).toBe(once);
  });

  test("addTags creates a tags: line when absent (roadmap)", () => {
    const { frontmatter } = splitFrontmatter(ROADMAP);
    const out = addTags(frontmatter, ["type/roadmap", "project/myorg-core"]);
    expect(out).toContain("tags: [type/roadmap, project/myorg-core]");
    // idempotent second time
    expect(addTags(out, ["type/roadmap", "project/myorg-core"])).toBe(out);
  });

  test("full-content round-trip: split → addTags → join preserves every other line", () => {
    const { frontmatter, body } = splitFrontmatter(PULSE);
    const merged = joinFrontmatter(addTags(frontmatter, ["type/pulse"]), body);
    // Only the tags line changed; body + other frontmatter untouched.
    expect(merged).toContain("date: 2026-05-25");
    expect(merged).toContain(`aliases: ["myorg-core Pulse 2026-05-25"]`);
    expect(merged.endsWith("body here.\n")).toBe(true);
  });
});

describe("frontmatter — setKey (prev/next)", () => {
  test("setKey appends a new scalar and is idempotent", () => {
    const { frontmatter } = splitFrontmatter(PULSE);
    const withPrev = setKey(frontmatter, "prev", "2026-05-24-myorg-core");
    expect(withPrev).toContain("prev: 2026-05-24-myorg-core");
    expect(setKey(withPrev, "prev", "2026-05-24-myorg-core")).toBe(withPrev);
  });

  test("setKey replaces an existing scalar in place", () => {
    const { frontmatter } = splitFrontmatter(PULSE);
    const out = setKey(frontmatter, "status", "active");
    expect(out).toContain("status: active");
    expect(out).not.toContain("status: idle");
  });
});

describe("frontmatter — freeze flags (R19, block only)", () => {
  test("reads managed_by_janus / needs_review from the block", () => {
    const frozen = `---\ntype: x\nmanaged_by_janus: false\n---\nbody`;
    expect(readFreezeFlags(frozen)).toEqual({ managed: false, needsReview: null });
    expect(isFrozen(frozen)).toBe(true);
  });

  test("needs_review: true is NOT a freeze trigger", () => {
    expect(isFrozen(ROADMAP)).toBe(false); // roadmap has needs_review: true
    expect(readFreezeFlags(ROADMAP)).toEqual({ managed: null, needsReview: true });
  });

  test("a flag only in body prose does NOT freeze the note", () => {
    const bodyProse = `---\ntype: pulse\ntags: [pulse]\n---\n\nRisk: this needs_review: false eventually.`;
    expect(isFrozen(bodyProse)).toBe(false);
    expect(readFreezeFlags(bodyProse)).toEqual({ managed: null, needsReview: null });
  });

  test("a note with no frontmatter is never frozen", () => {
    expect(isFrozen(NOTE)).toBe(false);
  });
});

describe("frontmatter — prependFrontmatter (R13 notes)", () => {
  test("prepends a block without corrupting an embedded --- HR in the body", () => {
    const out = prependFrontmatter(["tags: [type/note]"], NOTE);
    const s = splitFrontmatter(out);
    expect(s.hadFrontmatter).toBe(true);
    expect(getTags(s.frontmatter)).toEqual(["type/note"]);
    // The original note (with its embedded HR) is preserved intact as the body.
    expect(s.body).toBe(`\n\n${NOTE}`);
    expect(out).toContain("More prose.");
  });
});
