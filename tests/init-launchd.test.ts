import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_HOUR,
  DEFAULT_LABEL,
  DEFAULT_MINUTE,
  getPlistPath,
  installPlist,
  renderPlist,
} from "../src/core/init/launchd.ts";

describe("renderPlist", () => {
  test("generates a valid plist with defaults (explicit bunPath)", () => {
    const plist = renderPlist({
      binPath: "/Users/test/projects/janus/bin/janus.ts",
      repoPath: "/Users/test/projects/janus",
      bunPath: "/opt/homebrew/bin/bun",
    });
    expect(plist).toContain("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
    expect(plist).toContain(`<string>${DEFAULT_LABEL}</string>`);
    expect(plist).toContain(`<integer>${DEFAULT_HOUR}</integer>`);
    expect(plist).toContain(`<integer>${DEFAULT_MINUTE}</integer>`);
    // bunPath absoluto se usa directo (sin /usr/bin/env wrapper) para que
    // launchd encuentre el binary sin depender del PATH heredado.
    expect(plist).toContain("<string>/opt/homebrew/bin/bun</string>");
    expect(plist).not.toContain("<string>/usr/bin/env</string>");
    expect(plist).toContain("<string>pulse</string>");
    expect(plist).toContain("<string>/Users/test/projects/janus/bin/janus.ts</string>");
  });

  test("auto-detects bunPath via process.execPath when not specified", () => {
    const plist = renderPlist({
      binPath: "/Users/test/projects/janus/bin/janus.ts",
      repoPath: "/Users/test/projects/janus",
    });
    // process.execPath siempre arranca con `/` cuando corremos bajo bun
    expect(plist).toContain(`<string>${process.execPath}</string>`);
    expect(plist).not.toContain("<string>/usr/bin/env</string>");
  });

  test("falls back to /usr/bin/env when bunPath is empty or relative", () => {
    const plist = renderPlist({
      binPath: "/Users/test/projects/janus/bin/janus.ts",
      repoPath: "/Users/test/projects/janus",
      bunPath: "",
    });
    expect(plist).toContain("<string>/usr/bin/env</string>");
    expect(plist).toContain("<string>bun</string>");
  });

  test("accepts hour/minute override", () => {
    const plist = renderPlist({
      binPath: "/x/bin",
      repoPath: "/x",
      hour: 3,
      minute: 30,
    });
    expect(plist).toContain("<integer>3</integer>");
    expect(plist).toContain("<integer>30</integer>");
  });

  test("escapes XML metacharacters in paths (fix S2)", () => {
    const plist = renderPlist({
      binPath: "/Users/foo/repo&special<dir>/bin",
      repoPath: "/Users/foo/repo&special<dir>",
    });
    // El & y < deben estar escapados
    expect(plist).toContain("&amp;");
    expect(plist).toContain("&lt;");
    expect(plist).toContain("&gt;");
    // No deben aparecer raw (el path en repo y bin tendría &)
    expect(plist).not.toMatch(/<string>[^<]*&special<dir>/);
  });

  test("escapes quotes and apostrophes", () => {
    const plist = renderPlist({
      binPath: "/Users/foo'bar/bin",
      repoPath: '/Users/foo"bar',
    });
    expect(plist).toContain("&apos;");
    expect(plist).toContain("&quot;");
  });

  test("paths with spaces do not break the plist (not escaped, they are valid in plist)", () => {
    const plist = renderPlist({
      binPath: "/Users/foo bar/bin",
      repoPath: "/Users/foo bar",
    });
    expect(plist).toContain("<string>/Users/foo bar/bin</string>");
    expect(plist).toContain("<string>/Users/foo bar</string>");
  });
});

describe("getPlistPath", () => {
  test("uses ~/Library/LaunchAgents/ + label.plist", () => {
    const path = getPlistPath("com.test.foo");
    expect(path).toContain("Library/LaunchAgents/com.test.foo.plist");
  });

  test("default label", () => {
    const path = getPlistPath();
    expect(path).toContain(`${DEFAULT_LABEL}.plist`);
  });
});

describe("installPlist", () => {
  test("dryRun with non-existent target → action: installed", async () => {
    if (process.platform !== "darwin") return; // assertMacOS throws

    const dir = await mkdtemp(join(tmpdir(), "janus-plist-"));
    try {
      const target = join(dir, "test.plist");
      const result = await installPlist("content", { dryRun: true, targetPath: target });
      expect(result.action).toBe("installed");
      // No escribió nada
      const { existsSync } = await import("node:fs");
      expect(existsSync(target)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("dryRun with byte-equal target → action: unchanged", async () => {
    if (process.platform !== "darwin") return;

    const dir = await mkdtemp(join(tmpdir(), "janus-plist-"));
    try {
      const target = join(dir, "test.plist");
      const content = "same content";
      const { writeFile } = await import("node:fs/promises");
      await writeFile(target, content);
      const result = await installPlist(content, { dryRun: true, targetPath: target });
      expect(result.action).toBe("unchanged");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("dryRun with different target → action: updated", async () => {
    if (process.platform !== "darwin") return;

    const dir = await mkdtemp(join(tmpdir(), "janus-plist-"));
    try {
      const target = join(dir, "test.plist");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(target, "old content");
      const result = await installPlist("new content", { dryRun: true, targetPath: target });
      expect(result.action).toBe("updated");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("real install without reload → writes the file, does not call launchctl", async () => {
    if (process.platform !== "darwin") return;

    const dir = await mkdtemp(join(tmpdir(), "janus-plist-"));
    try {
      const target = join(dir, "test.plist");
      const content = renderPlist({
        binPath: "/x/bin",
        repoPath: "/x",
      });
      const result = await installPlist(content, {
        dryRun: false,
        targetPath: target,
        reload: false,
      });
      expect(result.action).toBe("installed");
      const written = await readFile(target, "utf-8");
      expect(written).toBe(content);
      // No verificó load porque reload:false
      expect(result.loaded).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("update over a different file creates backup .bak.<ts>", async () => {
    if (process.platform !== "darwin") return;

    const dir = await mkdtemp(join(tmpdir(), "janus-plist-"));
    try {
      const target = join(dir, "test.plist");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(target, "old plist content");
      const result = await installPlist("new plist content", {
        dryRun: false,
        targetPath: target,
        reload: false,
      });
      expect(result.action).toBe("updated");
      expect(result.backupPath).toBeDefined();
      expect(result.backupPath).toMatch(/\.bak\.\d+$/);
      const backup = await readFile(result.backupPath!, "utf-8");
      expect(backup).toBe("old plist content");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("non-darwin throws assertMacOS", async () => {
    if (process.platform === "darwin") return;

    await expect(
      installPlist("content", { dryRun: true, targetPath: "/tmp/x.plist" }),
    ).rejects.toThrow(/macOS-only/);
  });
});
