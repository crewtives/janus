import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isFirstOfMonth,
  previousMonth,
  monthlyDigestExists,
  latestMonthlyDigest,
  pendingMonthlyDigests,
} from "../src/core/monthly.ts";

const tmps: string[] = [];
afterEach(async () => {
  for (const d of tmps.splice(0)) await rm(d, { recursive: true, force: true });
});

async function makeVault(monthlies: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "janus-monthly-"));
  tmps.push(dir);
  if (monthlies.length) {
    await mkdir(join(dir, "Timeline", "Monthly"), { recursive: true });
    for (const m of monthlies) {
      await writeFile(join(dir, "Timeline", "Monthly", `${m}-monthly.md`), `# ${m}\n`);
    }
  }
  return dir;
}

describe("monthly self-heal — regression (execution note: calendar path unchanged)", () => {
  test("the calendar trigger set is untouched — a -01 date still yields the prior month", () => {
    // The orchestrator unions this calendar set with the self-heal set; the
    // calendar half must keep firing exactly as before.
    const dates = ["2026-07-01"];
    const calendar = dates.filter(isFirstOfMonth).map(previousMonth);
    expect(calendar).toEqual(["2026-06"]);
  });

  test("self-heal does not double-fire when nothing elapsed is missing", async () => {
    // Real-vault shape: 2026-05 and 2026-06 present, a mid-July run.
    const vault = await makeVault(["2026-05", "2026-06"]);
    const selfHeal = await pendingMonthlyDigests({ vaultPath: vault, upToDate: "2026-07-07" });
    expect(selfHeal).toEqual([]);
  });
});

describe("monthly self-heal — pendingMonthlyDigests", () => {
  test("AE2: prior month lacks a digest and a mid-month run occurs → it is generated", async () => {
    const vault = await makeVault(["2026-05"]); // 2026-06 missing
    const pending = await pendingMonthlyDigests({ vaultPath: vault, upToDate: "2026-07-15" });
    expect(pending).toEqual(["2026-06"]);
  });

  test("idempotent: prior month digest exists → nothing pending", async () => {
    const vault = await makeVault(["2026-05", "2026-06"]);
    const pending = await pendingMonthlyDigests({ vaultPath: vault, upToDate: "2026-07-15" });
    expect(pending).toEqual([]);
  });

  test("no monthly at all → only the single most recent elapsed month", async () => {
    const vault = await makeVault([]);
    const pending = await pendingMonthlyDigests({ vaultPath: vault, upToDate: "2026-07-15" });
    expect(pending).toEqual(["2026-06"]);
  });

  test("floor bounds the self-heal — an older gap below the last monthly is not backfilled", async () => {
    // Latest monthly is 2026-06; 2026-04/2026-05 are missing but below the floor.
    const vault = await makeVault(["2026-06"]);
    const pending = await pendingMonthlyDigests({ vaultPath: vault, upToDate: "2026-08-10" });
    expect(pending).toEqual(["2026-07"]); // only forward of the floor
  });

  test("multi-month gap: every missing elapsed month back to the floor", async () => {
    const vault = await makeVault(["2026-04"]); // 2026-05, 2026-06 missing
    const pending = await pendingMonthlyDigests({ vaultPath: vault, upToDate: "2026-07-15" });
    expect(pending).toEqual(["2026-05", "2026-06"]);
  });

  test("year boundary: December self-heals from a November floor", async () => {
    const vault = await makeVault(["2025-11"]); // 2025-12 missing
    const pending = await pendingMonthlyDigests({ vaultPath: vault, upToDate: "2026-01-10" });
    expect(pending).toEqual(["2025-12"]);
  });
});

describe("monthly self-heal — monthlyDigestExists / latestMonthlyDigest", () => {
  test("monthlyDigestExists reflects present/absent files", async () => {
    const vault = await makeVault(["2026-06"]);
    expect(await monthlyDigestExists(vault, "2026-06")).toBe(true);
    expect(await monthlyDigestExists(vault, "2026-05")).toBe(false);
  });

  test("latestMonthlyDigest returns the max, null when absent", async () => {
    expect(await latestMonthlyDigest(await makeVault([]))).toBeNull();
    expect(await latestMonthlyDigest(await makeVault(["2026-05", "2026-06"]))).toBe("2026-06");
  });
});
