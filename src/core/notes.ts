/**
 * Notes for portfolio — Phase 1 deliverable.
 *
 * Generates Note drafts in the style of crewtives.com/notes/ from material
 * Janus already has (pulses, weeklies, spines, ADRs). The user passes a
 * topic (slug or short phrase) + optionally a title; the system:
 *
 *  1. Finds relevant material in the vault (FTS5 + project filter + ADR refs).
 *  2. Builds the prompt context.
 *  3. Calls the LLM with `note-draft.v1.md` + a portfolio-adapted voice spec.
 *  4. Writes the draft to `<vault>/Notes/<YYYY-MM-DD>-<slug>.md`.
 *
 * The output is a draft — the user edits it, tweaks tone, and moves it into
 * the Crewtives CMS manually. NOT auto-pushed to the portfolio.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Eta } from "eta";
import type { JanusConfig, ProjectConfig } from "../config/types.ts";
import { resolveRunner } from "../runners/registry.ts";
import { stripCodeFenceWrap } from "./daily.ts";
import { addTags, joinFrontmatter, prependFrontmatter, setKey, splitFrontmatter } from "./frontmatter.ts";
import { loadVoiceSpec } from "./template.ts";
import { SearchIndex } from "./search-index.ts";
import noteDraftTemplate from "../prompts/note-draft.v2.md" with { type: "text" };

export const NOTE_PROMPT_VERSION = "v2" as const;

const eta = new Eta({ autoEscape: false, rmWhitespace: false });

export interface NoteDraftOptions {
  /** Topic in natural language ("provider-portable runners") or slug ("provider-portable-runners"). */
  topic: string;
  /** Suggested title. Optional — the LLM may improve it or invent one. */
  title?: string;
  /** Filename slug. Default: derived from the topic. */
  slug?: string;
  /** File date (YYYY-MM-DD). Default: today. */
  date?: string;
  /** Max docs to include as context. Default: 8. */
  contextLimit?: number;
  /** Filter context to this project. Optional. */
  project?: string;
  /** Don't call the LLM, just render the prompt and show what it would include. */
  dryRun?: boolean;
}

export interface NoteDraftResult {
  path: string;
  slug: string;
  date: string;
  contextDocs: number;
  promptChars: number;
  outputChars: number;
}

/**
 * Converts "Provider-portable Runners" → "provider-portable-runners".
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Date in a human-readable format for the note frontmatter ("May 21, 2026").
 */
export function humanDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

interface ContextDoc {
  kind: "pulse" | "weekly" | "spine" | "adr";
  docId: string;
  date: string;
  project: string | null;
  body: string;
}

/**
 * Searches for documents relevant to the topic via FTS5. Returns hits with
 * their full body (not just snippet) so the LLM has enough context.
 */
async function gatherContext(
  config: JanusConfig,
  topic: string,
  contextLimit: number,
  project?: string,
): Promise<ContextDoc[]> {
  const idx = SearchIndex.open(config.stateDir!);
  try {
    const hits = idx.search({
      query: topic,
      project,
      limit: contextLimit * 2, // ask for more, we filter later
    });

    const docs: ContextDoc[] = [];
    for (const hit of hits) {
      if (docs.length >= contextLimit) break;
      const absPath = join(config.obsidianVault, hit.docId);
      if (!existsSync(absPath)) continue;
      const body = await readFile(absPath, "utf-8");
      // Truncate the body to avoid bloating the prompt — pulses can be
      // long. The first 1500 chars usually cover TL;DR + key sections.
      const truncated = body.length > 1500 ? body.slice(0, 1500) + "\n[...truncated]" : body;
      docs.push({
        kind: hit.kind === "pulse" ? "pulse" : hit.kind === "weekly" ? "weekly" : hit.kind === "spine" ? "spine" : "adr",
        docId: hit.docId,
        date: hit.date,
        project: hit.project,
        body: truncated,
      });
    }
    return docs;
  } finally {
    idx.close();
  }
}

/**
 * Renders the prompt and returns the string. Useful for dry-run or testing.
 */
export async function renderNotePrompt(opts: {
  topic: string;
  title?: string;
  slug: string;
  date: string;
  contextDocs: ContextDoc[];
}): Promise<string> {
  const voice = await loadVoiceSpec();
  const template = noteDraftTemplate;

  const relevantPulses = opts.contextDocs
    .filter((d) => d.kind === "pulse")
    .map((d) => ({ filename: d.docId.replace(/\.md$/, "").split("/").pop() ?? d.docId, date: d.date, project: d.project ?? "?", body: d.body }));
  const relevantWeeklies = opts.contextDocs
    .filter((d) => d.kind === "weekly")
    .map((d) => ({ date: d.date, content: d.body }));
  const relevantSpines = opts.contextDocs
    .filter((d) => d.kind === "spine")
    .map((d) => ({ project: d.project ?? "?", content: d.body }));
  const relevantAdrs = opts.contextDocs
    .filter((d) => d.kind === "adr")
    .map((d) => {
      const m = d.docId.match(/ADR-(\d+)-(.+)\.md$/);
      return {
        filename: d.docId.replace(/\.md$/, "").split("/").pop() ?? d.docId,
        number: m?.[1] ?? "?",
        title: m?.[2]?.replace(/-/g, " ") ?? "?",
        body: d.body,
      };
    });

  const ctx = {
    voice,
    topic: opts.topic,
    title: opts.title ?? null,
    slug: opts.slug,
    date: humanDate(opts.date),
    isoDate: opts.date,
    relevantPulses,
    relevantWeeklies,
    relevantSpines,
    relevantAdrs,
    promptVersion: NOTE_PROMPT_VERSION,
  };

  const rendered = eta.renderString(template, ctx);
  if (typeof rendered !== "string") throw new Error("note-draft template render fail");
  return rendered;
}

/**
 * Generates the full draft: gathers context, renders the prompt, calls the LLM,
 * writes to `<vault>/Notes/<date>-<slug>.md`.
 */
export async function generateNoteDraft(
  config: JanusConfig,
  opts: NoteDraftOptions,
): Promise<NoteDraftResult> {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const slug = opts.slug ?? slugify(opts.topic);
  const contextLimit = opts.contextLimit ?? 8;

  const contextDocs = await gatherContext(config, opts.topic, contextLimit, opts.project);
  const prompt = await renderNotePrompt({
    topic: opts.topic,
    title: opts.title,
    slug,
    date,
    contextDocs,
  });

  const targetPath = join(config.obsidianVault, "Notes", `${date}-${slug}.md`);

  if (opts.dryRun) {
    return {
      path: targetPath,
      slug,
      date,
      contextDocs: contextDocs.length,
      promptChars: prompt.length,
      outputChars: 0,
    };
  }

  const runner = resolveRunner(config);
  const result = await runner.run({
    prompt,
    cwd: config.obsidianVault,
    model: config.model!,
    effort: config.effort!,
    fallbackModel: config.fallbackModel,
    sessionId: randomUUID(),
    maxTurns: 5,
    timeoutMs: 15 * 60_000,
    logTag: `note/${slug}`,
  });

  const content = stripCodeFenceWrap(result.resultText.trim());
  if (!content) throw new Error("LLM returned empty content");

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, withNoteFrontmatter(content, opts.project));

  return {
    path: targetPath,
    slug,
    date,
    contextDocs: contextDocs.length,
    promptChars: prompt.length,
    outputChars: content.length,
  };
}

/**
 * Prepend the canonical note frontmatter (R12/R13) to an LLM-generated note.
 *
 * The note-draft prompt deliberately emits NO frontmatter (Topic/Date are bold
 * markdown after the H1), so a Notes draft is all body — the classifier can't
 * derive its project from path/filename either. This wrapper attaches the
 * `type/note` tag now, plus `project/<id>` when the caller knows it (KD5); the
 * hub backlink stays deferred so we never mutate the LLM prose. Idempotent, and
 * defensive if a note ever arrives with its own frontmatter.
 */
export function withNoteFrontmatter(content: string, project?: string): string {
  const tags = project ? ["type/note", `project/${project}`] : ["type/note"];
  const split = splitFrontmatter(content);
  if (split.hadFrontmatter) {
    let fm = addTags(split.frontmatter, tags);
    if (project) fm = setKey(fm, "project", project);
    return joinFrontmatter(fm, split.body);
  }
  const lines = ["type: note"];
  if (project) lines.push(`project: ${project}`);
  lines.push(`tags: [${tags.join(", ")}]`);
  return prependFrontmatter(lines, content);
}

/**
 * Lists every existing note in `<vault>/Notes/`. Useful for checking
 * idempotency in future runs.
 */
export async function listNotes(config: JanusConfig): Promise<Array<{ path: string; date: string; slug: string }>> {
  const dir = join(config.obsidianVault, "Notes");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: Array<{ path: string; date: string; slug: string }> = [];
  for (const name of entries) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
    if (!m) continue;
    out.push({ path: join(dir, name), date: m[1]!, slug: m[2]! });
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}
