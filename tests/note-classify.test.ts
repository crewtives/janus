import { describe, expect, test } from "bun:test";
import type { JanusConfig } from "../src/config/types.ts";
import { classifyNote } from "../src/core/note-classify.ts";

// Synthetic roster mirroring the real nesting (a "suite" product with 3
// subprojects that share the Projects/myorg/suite prefix).
const config: JanusConfig = {
  obsidianVault: "/vault",
  projects: [
    { name: "myorg-core", repoPath: "/r/core", obsidianPath: "/vault/Projects/myorg/core", status: "active" },
    { name: "myorg-suite-web", repoPath: "/r/w", obsidianPath: "/vault/Projects/myorg/suite/web", status: "active" },
    { name: "myorg-suite-api", repoPath: "/r/a", obsidianPath: "/vault/Projects/myorg/suite/api", status: "active" },
    { name: "legacy-old", repoPath: "/r/o", obsidianPath: "/vault/Projects/legacy/old", status: "archived" },
  ],
  model: "sonnet",
  effort: "xhigh",
};

const c = (relPath: string, fm = "") => classifyNote(relPath, fm, config);

describe("note-classify — pulses", () => {
  test("live pulse under pulse/ → pulse + id from filename", () => {
    expect(c("Projects/myorg/core/pulse/2026-05-25-myorg-core.md")).toEqual({ type: "pulse", projectId: "myorg-core" });
  });

  test("archived pulse under _archive/YYYY-MM/ → pulse (no /pulse/ segment)", () => {
    expect(c("Projects/myorg/core/_archive/2026-05/2026-05-14-myorg-core.md")).toEqual({
      type: "pulse",
      projectId: "myorg-core",
    });
  });

  test("legacy double-dash pulse filename still classifies", () => {
    expect(c("Projects/myorg/core/pulse/2026-05-14--myorg-core.md")).toEqual({ type: "pulse", projectId: "myorg-core" });
  });

  test("frontmatter project: wins over path inference", () => {
    expect(c("Projects/myorg/core/pulse/2026-05-25-myorg-core.md", "project: myorg-core\ntags: [pulse]")).toEqual({
      type: "pulse",
      projectId: "myorg-core",
    });
  });
});

describe("note-classify — project-root files", () => {
  test("hub <id>.md vs spine <id>-spine.md are disambiguated", () => {
    expect(c("Projects/myorg/core/myorg-core.md", "project: myorg-core")).toEqual({ type: "hub", projectId: "myorg-core" });
    expect(c("Projects/myorg/core/myorg-core-spine.md", "project: myorg-core")).toEqual({
      type: "spine",
      projectId: "myorg-core",
    });
  });

  test("_roadmap / _index / STRATEGY classify with the project id", () => {
    expect(c("Projects/myorg/core/_roadmap.md", "project: myorg-core")).toEqual({ type: "roadmap", projectId: "myorg-core" });
    expect(c("Projects/myorg/core/_index.md", "project: myorg-core")).toEqual({ type: "index", projectId: "myorg-core" });
    expect(c("Projects/myorg/core/STRATEGY.md")).toEqual({ type: "strategy", projectId: "myorg-core" });
  });

  test("wrapped note classifies as wrapped", () => {
    expect(c("Projects/myorg/core/myorg-core-wrapped-2026.md", "project: myorg-core")).toEqual({
      type: "wrapped",
      projectId: "myorg-core",
    });
  });
});

describe("note-classify — nesting (longest-prefix)", () => {
  test("a suite subproject maps to the deepest match, not a shorter prefix", () => {
    expect(c("Projects/myorg/suite/web/pulse/2026-05-25-myorg-suite-web.md")).toEqual({
      type: "pulse",
      projectId: "myorg-suite-web",
    });
    expect(c("Projects/myorg/suite/api/myorg-suite-api.md", "project: myorg-suite-api")).toEqual({
      type: "hub",
      projectId: "myorg-suite-api",
    });
  });

  test("STRATEGY under a suite subproject gets the right id from path", () => {
    expect(c("Projects/myorg/suite/web/STRATEGY.md")).toEqual({ type: "strategy", projectId: "myorg-suite-web" });
  });
});

describe("note-classify — cross-project / global types (projectId null)", () => {
  test("daily / weekly / monthly", () => {
    expect(c("Timeline/Daily/2026-05-25.md")).toEqual({ type: "daily", projectId: null });
    expect(c("Timeline/Weekly/2026-07-05-week.md")).toEqual({ type: "weekly", projectId: null });
    expect(c("Timeline/Monthly/2026-05-monthly.md")).toEqual({ type: "monthly", projectId: null });
  });

  test("dashboard / moc / track", () => {
    expect(c("Dashboards/Janus Pulse.md")).toEqual({ type: "dashboard", projectId: null });
    expect(c("MOCs/Decisions MOC.md")).toEqual({ type: "moc", projectId: null });
    expect(c("MOCs/Tracks/margin-funding-sprint.md")).toEqual({ type: "track", projectId: null });
  });

  test("Notes get type note; project deferred (KD5)", () => {
    expect(c("Notes/2026-05-22-some-insight.md")).toEqual({ type: "note", projectId: null });
  });
});
