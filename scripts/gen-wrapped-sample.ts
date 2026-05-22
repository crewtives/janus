#!/usr/bin/env bun
/**
 * Generate a synthetic Janus Wrapped sample for `docs/examples/`.
 *
 * Uses fully fabricated data (no real projects, paths, or author signals)
 * so the demo can ship in the repo without privacy concerns. The output
 * powers the README hero and lets first-time visitors see what Janus
 * produces without running it.
 *
 * Outputs (idempotent — overwrites on each run):
 *   docs/examples/wrapped-2025-sample.md
 *   docs/examples/wrapped-2025-sample.html
 *
 * PNG export is intentionally NOT generated here — it requires puppeteer
 * (~280 MB optional dependency). To produce the PNG locally:
 *
 *   bun add -d puppeteer
 *   bun run scripts/gen-wrapped-sample.ts --png
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { renderDeterministic } from "../src/core/wrapped/renderer.ts";
import { renderWrappedHtmlString } from "../src/core/wrapped/html.ts";
import type { WrappedData } from "../src/core/wrapped/types.ts";

const OUT_DIR = join(import.meta.dir, "..", "docs", "examples");
const YEAR = 2025;

const sample: WrappedData = {
  scope: "yearly",
  year: YEAR,
  target: "_global",
  periodStart: `${YEAR}-01-01`,
  periodEnd: `${YEAR}-12-31`,
  metrics: {
    pulses: 312,
    pulsesActive: 247,
    projects: 5,
    projectsActive: 3,
    decisionsCanonical: 18,
    decisionsCandidate: 41,
    tracksOpen: 7,
    tracksCompleted: 22,
    tracksArchived: 9,
    hoursSessions: 412.5,
    commits: 1843,
    pulsesByMonth: {
      "2025-01": 19, "2025-02": 24, "2025-03": 27, "2025-04": 21,
      "2025-05": 18, "2025-06": 14, "2025-07": 9,  "2025-08": 12,
      "2025-09": 22, "2025-10": 28, "2025-11": 25, "2025-12": 28,
    },
  },
  topTracks: [
    { slug: "kepler-launch-prep", project: "kepler", mentionsCount: 38, firstSeen: "2025-02-04", lastMentioned: "2025-09-19", status: "completed" },
    { slug: "helios-billing-rebuild", project: "helios", mentionsCount: 31, firstSeen: "2025-03-11", lastMentioned: "2025-12-02", status: "completed" },
    { slug: "atlas-mobile-port", project: "atlas", mentionsCount: 27, firstSeen: "2025-05-08", lastMentioned: "2025-11-14", status: "open" },
    { slug: "kepler-auth-migration", project: "kepler", mentionsCount: 19, firstSeen: "2025-04-22", lastMentioned: "2025-08-30", status: "completed" },
    { slug: "helios-vendor-cutover", project: "helios", mentionsCount: 15, firstSeen: "2025-06-17", lastMentioned: "2025-10-04", status: "completed" },
  ],
  topDecisions: [
    { adrId: "ADR-014", project: "kepler", references: 24 },
    { adrId: "ADR-009", project: "helios", references: 18 },
    { adrId: "ADR-021", project: "atlas", references: 12 },
  ],
  biggestWeek: {
    startDate: "2025-09-15",
    endDate: "2025-09-21",
    density: 47,
    pulsesCount: 31,
    decisionsCount: 16,
  },
  birthdays: [
    { project: "helios", birthDate: "2022-04-12", years: 3 },
    { project: "kepler", birthDate: "2023-09-04", years: 2 },
  ],
  themes: [
    "Shipping vs sharpening — the year you finally chose distribution over polish",
    "Auth and billing both moved off legacy providers — two infrastructure debts retired",
    "Atlas remained an exploration, not a commitment — and that's OK",
  ],
  sampleTldrs: [
    { date: "2025-09-18", project: "kepler", tldr: "Launch readiness review closed five blockers; final OAuth flow signed off." },
    { date: "2025-10-04", project: "helios", tldr: "Stripe migration finished; legacy provider deprecated end of October." },
    { date: "2025-11-14", project: "atlas", tldr: "Mobile port still feasible but time-boxed — re-evaluate at Q1 boundary." },
  ],
  personality: {
    archetype: "The Shipper",
    explanation: "You closed 22 tracks against 7 still open, and your densest week clustered around a launch. Less time was spent revisiting decisions than committing them: 18 canonical ADRs against 41 candidates that stayed unpromoted.",
    evidence: [
      "Kepler launch landed in the densest week of the year (2025-09-15 → 2025-09-21)",
      "Helios billing rebuild closed end of Q4 — second infrastructure debt retired",
      "Atlas mobile port intentionally kept open as exploration, not commitment",
    ],
    confidence: 0.78,
    signals: {
      shipRatio: 0.76,
      refactorRatio: 0.18,
      exploreSpread: 0.6,
      connectorRatio: 0.22,
      avgSessionLength: 14.2,
      sessionsCount: 287,
    },
  },
};

await mkdir(OUT_DIR, { recursive: true });

const mdPath = join(OUT_DIR, `wrapped-${YEAR}-sample.md`);
const md = renderDeterministic(sample);
await Bun.write(mdPath, md);
console.log(`[wrapped-sample] wrote ${mdPath} (${md.length} chars)`);

const htmlPath = join(OUT_DIR, `wrapped-${YEAR}-sample.html`);
const html = await renderWrappedHtmlString(sample);
await Bun.write(htmlPath, html);
console.log(`[wrapped-sample] wrote ${htmlPath} (${html.length} chars)`);

if (process.argv.includes("--png")) {
  console.log(`[wrapped-sample] --png passed: rendering PNG via puppeteer...`);
  try {
    // @ts-ignore — puppeteer is an optional dependency
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: "networkidle0" });
      const buffer = await page.screenshot({ type: "png", clip: { x: 24, y: 24, width: 1080 - 48, height: 1080 - 48 } });
      const pngPath = join(OUT_DIR, `wrapped-${YEAR}-sample.png`);
      await Bun.write(pngPath, buffer);
      console.log(`[wrapped-sample] wrote ${pngPath} (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error(`[wrapped-sample] PNG export failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`[wrapped-sample] Install puppeteer with: bun add -d puppeteer`);
    process.exit(1);
  }
}
