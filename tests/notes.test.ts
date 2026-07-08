import { describe, expect, test } from "bun:test";
import { appendHubBacklink, humanDate, renderNotePrompt, slugify, withNoteFrontmatter } from "../src/core/notes.ts";
import { splitFrontmatter, getTags } from "../src/core/frontmatter.ts";

const RAW_NOTE = `# Provider-portable runtimes

**Topic:** Architecture
**Date:** May 21, 2026

The orchestration layer is the product.

## A detail

Some prose with an embedded HR:

---

More prose.
`;

describe("withNoteFrontmatter (R12/R13 forward-emit)", () => {
  test("prepends type/note frontmatter to a frontmatter-less draft, body intact, no orphan-wiring", () => {
    const out = withNoteFrontmatter(RAW_NOTE);
    const s = splitFrontmatter(out);
    expect(s.hadFrontmatter).toBe(true);
    expect(getTags(s.frontmatter)).toEqual(["type/note"]);
    // the LLM prose (including its embedded --- HR) is preserved verbatim as body
    expect(out).toContain("# Provider-portable runtimes");
    expect(out).toContain("More prose.");
    // no project → no hub backlink (stays an orphan by design)
    expect(out).not.toContain("## Related");
  });

  test("adds project/<id>, a project scalar, and a hub backlink when the project is known (R13)", () => {
    const out = withNoteFrontmatter(RAW_NOTE, "crewtives-janus");
    const s = splitFrontmatter(out);
    expect(getTags(s.frontmatter)).toEqual(["type/note", "project/crewtives-janus"]);
    expect(s.frontmatter).toContain("project: crewtives-janus");
    // graph edge appended below the prose, prose itself untouched
    expect(out).toContain("## Related");
    expect(out).toContain("- Hub: [[crewtives-janus]]");
    expect(out).toContain("More prose.");
  });

  test("idempotent: re-wrapping an already-wired note is a byte-for-byte no-op", () => {
    const once = withNoteFrontmatter(RAW_NOTE, "crewtives-janus");
    const twice = withNoteFrontmatter(once, "crewtives-janus");
    expect(twice).toBe(once);
    // exactly one backlink, not one per wrap
    expect(once.match(/- Hub: \[\[crewtives-janus\]\]/g)).toHaveLength(1);
  });
});

describe("appendHubBacklink (R13 graph edge)", () => {
  test("appends a ## Related hub backlink to a body without one", () => {
    const out = appendHubBacklink("Some prose.\n", "crewtives-whet-app");
    expect(out).toBe("Some prose.\n\n## Related\n\n- Hub: [[crewtives-whet-app]]\n");
  });

  test("idempotent when the backlink is already present", () => {
    const once = appendHubBacklink("Some prose.\n", "crewtives-whet-app");
    expect(appendHubBacklink(once, "crewtives-whet-app")).toBe(once);
  });
});

describe("slugify", () => {
  test("converts spaces and uppercase", () => {
    expect(slugify("Provider-portable Runners")).toBe("provider-portable-runners");
    expect(slugify("Agent-native everything")).toBe("agent-native-everything");
  });

  test("normalizes diacritics", () => {
    expect(slugify("Día de prueba")).toBe("dia-de-prueba");
  });

  test("dedupes separators and trims", () => {
    expect(slugify("--Foo--Bar---")).toBe("foo-bar");
    expect(slugify("foo  bar baz")).toBe("foo-bar-baz");
  });

  test("truncates to 80 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });
});

describe("humanDate", () => {
  test("US-readable format", () => {
    expect(humanDate("2026-05-21")).toBe("May 21, 2026");
    expect(humanDate("2026-01-01")).toBe("January 1, 2026");
    expect(humanDate("2026-12-31")).toBe("December 31, 2026");
  });
});

describe("renderNotePrompt", () => {
  test("renders with empty context", async () => {
    const out = await renderNotePrompt({
      topic: "agent-native",
      slug: "agent-native-everything",
      date: "2026-05-21",
      contextDocs: [],
    });
    expect(out).toBeString();
    expect(out).toContain("agent-native"); // topic en el prompt
    expect(out).toContain("agent-native-everything"); // slug
    expect(out).toContain("May 21, 2026"); // human date
    expect(out).toContain("Voice of Janus"); // voice spec injected
    expect(out).toContain("PORTFOLIO EXAMPLES"); // few-shot inline
    expect(out).toContain("180-380 words"); // length guidance
  });

  test("injects context docs correctly", async () => {
    const out = await renderNotePrompt({
      topic: "decision graph",
      slug: "decision-graph",
      date: "2026-05-21",
      contextDocs: [
        {
          kind: "pulse",
          docId: "Projects/foo/pulse/2026-05-20--foo.md",
          date: "2026-05-20",
          project: "foo",
          body: "## TL;DR\nCambiamos la estructura.",
        },
        {
          kind: "adr",
          docId: "Decisions/ADR-007-decision-graph.md",
          date: "2026-05-19",
          project: null,
          body: "ADR body real con decisión",
        },
      ],
    });
    expect(out).toContain("Cambiamos la estructura");
    expect(out).toContain("ADR body real con decisión");
    expect(out).toContain("ADR-007");
    expect(out).toContain("2026-05-20");
  });

  test("suggested title appears in the context", async () => {
    const out = await renderNotePrompt({
      topic: "x",
      title: "I built X for myself",
      slug: "x",
      date: "2026-05-21",
      contextDocs: [],
    });
    expect(out).toContain("I built X for myself");
  });

  test("includes the 4 example notes (few-shot inline)", async () => {
    const out = await renderNotePrompt({
      topic: "x",
      slug: "x",
      date: "2026-05-21",
      contextDocs: [],
    });
    // Verifico que los 4 ejemplos están presentes
    expect(out).toContain("I built a night agent for myself");
    expect(out).toContain("Provider-portable agent runtimes");
    expect(out).toContain("Coding agents leave a paper trail");
    expect(out).toContain("Building Acme: lessons from an agent-native product");
  });

  test("critical output instructions are present", async () => {
    const out = await renderNotePrompt({
      topic: "x",
      slug: "x",
      date: "2026-05-21",
      contextDocs: [],
    });
    expect(out).toContain("Topic:");
    expect(out).toContain("Date:");
    expect(out).toContain("First-person observational");
    expect(out).toContain("Do not wrap in a code fence");
    expect(out).toContain("No marketing");
    // v3: project-anonymity is a hard output requirement
    expect(out).toContain("Anonymization & privacy");
    expect(out).toContain("No proper names of the work");
  });
});
