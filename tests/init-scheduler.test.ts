import { describe, expect, test } from "bun:test";
import { describeScheduler, detectScheduler, installScheduler } from "../src/core/init/scheduler.ts";

describe("detectScheduler", () => {
  test("returns the correct kind for the current platform", () => {
    const kind = detectScheduler();
    if (process.platform === "darwin") {
      expect(kind).toBe("launchd");
    } else if (process.platform === "linux") {
      expect(kind).toBe("systemd");
    } else {
      expect(kind).toBe("unsupported");
    }
  });
});

describe("describeScheduler", () => {
  test("human-readable text includes the scheduler name", () => {
    const text = describeScheduler();
    if (process.platform === "darwin") {
      expect(text).toContain("launchd");
      expect(text).toContain("NO recupera"); // explica el tradeoff
    } else if (process.platform === "linux") {
      expect(text).toContain("systemd");
      expect(text).toContain("Persistent=true"); // explica el feature key
    } else {
      expect(text).toContain("no soportado");
    }
  });
});

describe("installScheduler — dry-run cross-platform", () => {
  test("dry-run writes nothing and reports the correct kind", async () => {
    const r = await installScheduler({
      binPath: "/x/bin/janus.ts",
      repoPath: "/x",
      dryRun: true,
      reload: false,
    });

    if (process.platform === "darwin") {
      expect(r.kind).toBe("launchd");
      expect(r.paths).toHaveLength(1);
      expect(r.paths[0]).toMatch(/com\.crewtives\.janus\.plist$/);
    } else if (process.platform === "linux") {
      expect(r.kind).toBe("systemd");
      expect(r.paths).toHaveLength(2);
      expect(r.paths.some((p) => p.endsWith(".timer"))).toBe(true);
      expect(r.paths.some((p) => p.endsWith(".service"))).toBe(true);
    } else {
      expect(r.kind).toBe("unsupported");
      expect(r.action).toBe("skipped-unsupported");
      expect(r.paths).toHaveLength(0);
    }
  });
});
