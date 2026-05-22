/**
 * Wrapped PNG export — Phase 3 U6.
 *
 * Renderiza el HTML de Wrapped a PNG 1080x1080 via Puppeteer headless.
 * Puppeteer es **opt-in**: NO está en `dependencies` del package.json para no
 * inflar el install (~280MB). Si el usuario quiere PNG export, hace:
 *
 *   bun add -d puppeteer
 *   bun janus wrapped --year YYYY --format png
 *
 * Si no está instalado, error útil que explica cómo instalarlo.
 */
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { renderWrappedHtmlString } from "./html.ts";
import type { WrappedData } from "./types.ts";
import type { JanusConfig } from "../../config/types.ts";

export interface RenderPngOptions {
  data: WrappedData;
  config: JanusConfig;
  /** Canvas dimensions. Default 1920x1080 (matches the design system's fixed canvas). */
  width?: number;
  height?: number;
}

export async function renderWrappedPng(opts: RenderPngOptions): Promise<{ path: string; bytes: number }> {
  const html = await renderWrappedHtmlString(opts.data);

  let puppeteer: any;
  try {
    // Dynamic require — puppeteer es optional dependency (no en package.json
    // para no inflar el install). El @ts-ignore evita el error de typecheck.
    // @ts-ignore — puppeteer es runtime-optional
    puppeteer = await import("puppeteer");
  } catch {
    throw new Error(
      `PNG export requiere puppeteer (no está instalado).\n` +
      `Instalalo con: bun add -d puppeteer\n` +
      `Después correr: bun janus wrapped --year ${opts.data.year} --format png`,
    );
  }

  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;

  const browser = await puppeteer.default.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  let pngBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const result = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
    pngBuffer = Buffer.isBuffer(result) ? result : Buffer.from(result);
  } finally {
    await browser.close();
  }

  let outputPath: string;
  if (opts.data.scope === "project") {
    const project = opts.config.projects.find((p) => p.name === opts.data.target);
    if (!project) throw new Error(`Wrapped PNG per-project requiere ${opts.data.target} en config`);
    outputPath = join(project.obsidianPath, `${opts.data.target}-wrapped-${opts.data.year}.png`);
  } else {
    outputPath = join(opts.config.obsidianVault, "Wrapped", `Wrapped-${opts.data.year}.png`);
  }
  await mkdir(join(outputPath, "..").replace(/\/$/, ""), { recursive: true });
  await Bun.write(outputPath, pngBuffer);
  return { path: outputPath, bytes: pngBuffer.byteLength };
}
