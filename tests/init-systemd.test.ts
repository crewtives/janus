import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_HOUR,
  DEFAULT_LABEL,
  DEFAULT_MINUTE,
  getServicePath,
  getTimerPath,
  installUnits,
  renderUnits,
} from "../src/core/init/systemd.ts";

describe("renderUnits (systemd-user)", () => {
  test("generates valid timer + service with defaults", () => {
    const { timer, service } = renderUnits({
      binPath: "/home/test/janus/bin/janus.ts",
      repoPath: "/home/test/janus",
      bunPath: "/home/test/.bun/bin/bun",
    });

    // Service básico
    expect(service).toContain("[Unit]");
    expect(service).toContain("[Service]");
    expect(service).toContain("Type=oneshot");
    expect(service).toContain("ExecStart=/home/test/.bun/bin/bun run /home/test/janus/bin/janus.ts pulse");
    expect(service).toContain("WorkingDirectory=/home/test/janus");
    expect(service).toContain("StandardOutput=append:");
    expect(service).toContain("StandardError=append:");

    // Timer básico
    expect(timer).toContain("[Timer]");
    expect(timer).toContain(`OnCalendar=*-*-* ${String(DEFAULT_HOUR).padStart(2, "0")}:${String(DEFAULT_MINUTE).padStart(2, "0")}:00`);
    expect(timer).toContain("Persistent=true"); // crítico — recupera runs perdidos
    expect(timer).toContain(`Unit=${DEFAULT_LABEL}.service`);
    expect(timer).toContain("[Install]");
    expect(timer).toContain("WantedBy=timers.target");
  });

  test("accepts hour/minute override", () => {
    const { timer } = renderUnits({
      binPath: "/x/bin",
      repoPath: "/x",
      hour: 3,
      minute: 30,
      bunPath: "/x/bun",
    });
    expect(timer).toContain("OnCalendar=*-*-* 03:30:00");
  });

  test("correct zero-padding for single-digit hour/minute", () => {
    const { timer } = renderUnits({
      binPath: "/x/bin",
      repoPath: "/x",
      hour: 5,
      minute: 7,
      bunPath: "/x/bun",
    });
    expect(timer).toContain("OnCalendar=*-*-* 05:07:00");
  });

  test("falls back to /usr/bin/env when bunPath is empty", () => {
    const { service } = renderUnits({
      binPath: "/x/bin",
      repoPath: "/x",
      bunPath: "",
    });
    expect(service).toContain("ExecStart=/usr/bin/env bun run /x/bin pulse");
  });

  test("auto-detects bunPath via process.execPath", () => {
    const { service } = renderUnits({
      binPath: "/x/bin",
      repoPath: "/x",
    });
    expect(service).toContain(`ExecStart=${process.execPath} run /x/bin pulse`);
  });
});

describe("getTimerPath / getServicePath", () => {
  test("paths follow XDG convention", () => {
    const timer = getTimerPath();
    const service = getServicePath();
    expect(timer).toMatch(/\.config\/systemd\/user\/janus\.timer$/);
    expect(service).toMatch(/\.config\/systemd\/user\/janus\.service$/);
  });

  test("respects custom label", () => {
    expect(getTimerPath("foo")).toMatch(/foo\.timer$/);
    expect(getServicePath("foo")).toMatch(/foo\.service$/);
  });
});

describe("installUnits — idempotency (no real systemctl, reload:false)", () => {
  test("first run installs both files", async () => {
    if (process.platform !== "linux") return; // assertLinux throws

    const dir = await mkdtemp(join(tmpdir(), "janus-systemd-"));
    try {
      const units = renderUnits({ binPath: "/x", repoPath: "/x", bunPath: "/bun" });
      const r = await installUnits(units, { dryRun: false, reload: false, targetDir: dir });
      expect(r.action).toBe("installed");
      expect(await readFile(r.timerPath, "utf-8")).toBe(units.timer);
      expect(await readFile(r.servicePath, "utf-8")).toBe(units.service);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("re-running byte-equal returns 'unchanged' (does not write)", async () => {
    if (process.platform !== "linux") return;

    const dir = await mkdtemp(join(tmpdir(), "janus-systemd-"));
    try {
      const units = renderUnits({ binPath: "/x", repoPath: "/x", bunPath: "/bun" });
      await installUnits(units, { dryRun: false, reload: false, targetDir: dir });
      const r2 = await installUnits(units, { dryRun: false, reload: false, targetDir: dir });
      expect(r2.action).toBe("unchanged");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("dry-run writes nothing", async () => {
    if (process.platform !== "linux") return;

    const dir = await mkdtemp(join(tmpdir(), "janus-systemd-"));
    try {
      const units = renderUnits({ binPath: "/x", repoPath: "/x", bunPath: "/bun" });
      const r = await installUnits(units, { dryRun: true, reload: false, targetDir: dir });
      expect(r.action).toBe("installed");
      // Archivos NO deben existir
      const { existsSync } = await import("node:fs");
      expect(existsSync(r.timerPath)).toBe(false);
      expect(existsSync(r.servicePath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("non-Linux throws assertLinux", async () => {
    if (process.platform === "linux") return;

    const units = renderUnits({ binPath: "/x", repoPath: "/x", bunPath: "/bun" });
    await expect(installUnits(units, { dryRun: false, reload: false })).rejects.toThrow(/Linux-only/);
  });
});
