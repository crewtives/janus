import { describe, expect, test, beforeAll } from "bun:test";
import { buildPromptContext, loadVoiceSpec, PROMPT_VERSION, renderDailyPulsePrompt } from "../src/core/template.ts";
import type { GitActivity } from "../src/core/git.ts";

function makeActivity(overrides: Partial<GitActivity> = {}): GitActivity {
  return {
    commits: [],
    filesChanged: [],
    diffStat: "",
    currentBranch: "main",
    isClean: true,
    commitTypes: {},
    insertions: 0,
    deletions: 0,
    topFolders: [],
    ...overrides,
  };
}

let voice: string;

beforeAll(async () => {
  voice = await loadVoiceSpec();
});

describe("template", () => {
  test("PROMPT_VERSION is v8", () => {
    expect(PROMPT_VERSION).toBe("v8");
  });

  test("loadVoiceSpec returns a non-empty string with the 8 hard rules", async () => {
    const spec = await loadVoiceSpec();
    expect(spec).toBeString();
    expect(spec.length).toBeGreaterThan(500);
    // Sanity check of the core voice
    expect(spec).toContain("Voice of Janus");
    expect(spec).toContain("personal historian");
    expect(spec).toContain("Prose > bullets");
    expect(spec).toContain("Honesty");
  });

  test("renderDailyPulsePrompt produces a non-empty string with full context + voice spec", async () => {
    const ctx = buildPromptContext({
      project: "test-project",
      date: "2026-05-20",
      voice,
      strategyMd: "# Strategy\n## Key metrics\n- Activation rate",
      roadmap: "## Milestones\n- Implement X\n- Refactor Y",
      readmeMd: "# Test project\nProject description.",
      claudeMd: "# Test project conventions\n- Use bun",
      activity: makeActivity({
        commits: [
          { sha: "abc1234567890", shortSha: "abc1234", author: "migue", date: "2026-05-20T10:00:00Z", subject: "feat: new", body: "" },
        ],
        filesChanged: ["src/foo.ts", "src/bar.ts"],
        diffStat: " src/foo.ts | 10 ++++++----",
        commitTypes: { feat: 1 },
        insertions: 30,
        deletions: 5,
        topFolders: [{ folder: "src", count: 2 }],
      }),
      sessions: [
        {
          sessionId: "11111111-2222-3333-4444-555566667777",
          path: "/tmp/x.jsonl",
          firstTimestamp: "2026-05-20T10:00:00Z",
          lastTimestamp: "2026-05-20T10:30:00Z",
          messageCount: 8,
          assistantCount: 4,
          userCount: 4,
          toolUseCount: 5,
          toolsUsed: { Bash: 2, Edit: 3 },
          filesEdited: ["/tmp/foo.ts"],
          bashCommands: 2,
          model: "claude-sonnet-4-6",
          cwd: "/tmp",
          gitBranch: "main",
          hasSubagents: false,
          userIntent: "Implement JSONL session parser for daily pulse",
          decisionSnippets: ["Decided to use Bun.file instead of fs.readFile for performance"],
          blockerSnippets: ["Smoke test failing on timeout when calling Claude headless"],
        },
      ],
    });

    const out = await renderDailyPulsePrompt(ctx);
    expect(out).toBeString();
    expect(out.length).toBeGreaterThan(100);

    // Voice spec injected at the top
    expect(out).toContain("Voice of Janus");
    expect(out).toContain("Prose > bullets");

    expect(out).toContain("test-project");
    expect(out).toContain("2026-05-20");
    expect(out).toContain("Activation rate");
    expect(out).toContain("Implement X");
    expect(out).toContain("Project description");
    expect(out).toContain("Use bun");
    expect(out).toContain("abc1234");
    expect(out).toContain("feat: new");
    expect(out).toContain("11111111");
    expect(out).toContain("claude-sonnet-4-6");
    expect(out).toContain("v8");
    // session mining: userIntent + decision/blocker snippets rendered in the prompt
    expect(out).toContain("Implement JSONL session parser");
    expect(out).toContain("Bun.file");
    expect(out).toContain("Smoke test failing");
    // cross-references: even without previous pulses, the prompt should mention the placeholders
    expect(out).toContain("Cross-references");
    // new metrics
    expect(out).toContain("+30");
    expect(out).toContain("feat=1");
    expect(out).toContain("src");

    expect(out).toContain("[!summary]");
    expect(out).toContain("[!danger]");
    expect(out).toContain("[!success]");
    expect(out).toContain("[!todo]");
    expect(out).toContain("dataview");

    expect(out).toContain("inferring");
    expect(out).toContain("idle");
    expect(out).toContain("on-track");
  });

  test("context without docs → prompt instructs inferring mode", async () => {
    const ctx = buildPromptContext({
      project: "empty",
      date: "2026-05-20",
      voice,
      strategyMd: null,
      roadmap: null,
      readmeMd: null,
      claudeMd: null,
      activity: makeActivity(),
      sessions: [],
    });

    const out = await renderDailyPulsePrompt(ctx);
    expect(out).toContain("(no STRATEGY.md)");
    expect(out).toContain("(no _roadmap.md)");
    expect(out).toContain("(no README.md)");
    expect(out).toContain("(no CLAUDE.md)");
    expect(out).toContain("(no commits)");
    expect(out).toContain("(no sessions");
    expect(out).toContain("Inferred roadmap");
    expect(out).toContain("DRAFT");
  });

  test("suppressRoadmapDraft=true omits the full draft", async () => {
    const ctx = buildPromptContext({
      project: "drafted",
      date: "2026-05-20",
      voice,
      strategyMd: null,
      roadmap: null,
      readmeMd: null,
      claudeMd: null,
      activity: makeActivity(),
      sessions: [],
      suppressRoadmapDraft: true,
    });
    const out = await renderDailyPulsePrompt(ctx);
    expect(out).toContain("suppressRoadmapDraft=true");
    expect(out).toContain("No active roadmap");
  });

  test("previousRisks and previousDecisions get injected for cross-references", async () => {
    const ctx = buildPromptContext({
      project: "xref-proj",
      date: "2026-05-20",
      voice,
      strategyMd: null,
      roadmap: null,
      readmeMd: null,
      claudeMd: null,
      activity: makeActivity(),
      sessions: [],
      previousRisks: [
        { date: "2026-05-18", pulsePath: "2026-05-18--xref-proj", text: "- Dirty working tree on feature/x" },
      ],
      previousDecisions: [
        { date: "2026-05-17", pulsePath: "2026-05-17--xref-proj", text: "- Adopt SQLite for idempotency" },
      ],
      hasPreviousPulse: true,
      previousPulseFilename: "2026-05-18--xref-proj",
    });
    const out = await renderDailyPulsePrompt(ctx);
    expect(out).toContain("2026-05-18--xref-proj");
    expect(out).toContain("Dirty working tree on feature/x");
    expect(out).toContain("2026-05-17--xref-proj");
    expect(out).toContain("Adopt SQLite");
    expect(out).toContain("Previous pulse: [[2026-05-18--xref-proj]]");
  });

  test("without previous pulse, the prompt instructs to omit the previous-day wiki-link", async () => {
    const ctx = buildPromptContext({
      project: "fresh-proj",
      date: "2026-05-20",
      voice,
      strategyMd: null,
      roadmap: null,
      readmeMd: null,
      claudeMd: null,
      activity: makeActivity(),
      sessions: [],
      hasPreviousPulse: false,
    });
    const out = await renderDailyPulsePrompt(ctx);
    expect(out).toContain("no previous pulse in the vault");
    expect(out).not.toMatch(/Previous pulse: \[\[20\d\d-\d\d-\d\d/);
  });

  test("STRATEGY nag escalates with strategyDaysAsDraft", async () => {
    const base = {
      project: "nag-proj",
      date: "2026-05-20",
      voice,
      strategyMd: "# Strategy (template)",
      roadmap: "- [ ] foo",
      readmeMd: null,
      claudeMd: null,
      activity: makeActivity(),
      sessions: [],
    };

    const day1 = await renderDailyPulsePrompt(buildPromptContext({
      ...base,
      strategyStatus: "draft", strategyDaysAsDraft: 1,
    }));
    expect(day1).not.toMatch(/MAX NAG|MEDIUM NAG/);
    expect(day1).toContain("recent template");

    const day3 = await renderDailyPulsePrompt(buildPromptContext({
      ...base,
      strategyStatus: "draft", strategyDaysAsDraft: 3,
    }));
    expect(day3).toContain("MEDIUM NAG");
    expect(day3).toContain("[!warning]+");

    const day7 = await renderDailyPulsePrompt(buildPromptContext({
      ...base,
      strategyStatus: "draft", strategyDaysAsDraft: 7,
    }));
    expect(day7).toContain("MAX NAG");
    expect(day7).toContain("[!danger]");

    const filled = await renderDailyPulsePrompt(buildPromptContext({
      ...base,
      strategyStatus: "filled", strategyDaysAsDraft: 0,
    }));
    expect(filled).toContain("Vs Strategic North Star");
    expect(filled).not.toMatch(/MAX NAG|MEDIUM NAG/);

    const missing = await renderDailyPulsePrompt(buildPromptContext({
      ...base,
      strategyMd: null,
      strategyStatus: "missing", strategyDaysAsDraft: 0,
    }));
    expect(missing).toContain("No STRATEGY.md");
  });

  test("userEdits render as 'USER FEEDBACK' section", async () => {
    const ctx = buildPromptContext({
      project: "edit-proj",
      date: "2026-05-20",
      voice,
      strategyMd: null,
      roadmap: null,
      readmeMd: null,
      claudeMd: null,
      activity: makeActivity(),
      sessions: [],
      userEdits: [
        { date: "2026-05-19", diff: "- > A generic day.\n+ > A day with concrete bullets." },
      ],
    });
    const out = await renderDailyPulsePrompt(ctx);
    expect(out).toContain("USER FEEDBACK");
    expect(out).toContain("Pulse of 2026-05-19");
    expect(out).toContain("A day with concrete bullets");
    expect(out).toContain("- > A generic day");
  });

  test("without userEdits the FEEDBACK block does not appear", async () => {
    const ctx = buildPromptContext({
      project: "no-edits",
      date: "2026-05-20",
      voice,
      strategyMd: null,
      roadmap: null,
      readmeMd: null,
      claudeMd: null,
      activity: makeActivity(),
      sessions: [],
    });
    const out = await renderDailyPulsePrompt(ctx);
    expect(out).not.toContain("USER FEEDBACK");
  });

  test("context with only strategy renders the Strategic North Star section", async () => {
    const ctx = buildPromptContext({
      project: "stratproj",
      date: "2026-05-20",
      voice,
      strategyMd: "# Strategy\n## Key metrics\n- Weekly active devs",
      roadmap: null,
      readmeMd: null,
      claudeMd: null,
      activity: makeActivity(),
      sessions: [],
    });

    const out = await renderDailyPulsePrompt(ctx);
    expect(out).toContain("Weekly active devs");
    expect(out).toContain("Strategic North Star");
  });
});
