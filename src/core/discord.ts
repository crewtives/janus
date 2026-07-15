import type { DiscordConfig } from "../config/types.ts";

export interface ProjectResult {
  project: string;
  date: string;
  status: "ok" | "failed" | "dry-run";
  obsidianPath?: string;
  contentPreview?: string;
  error?: string;
}

/**
 * Sends a consolidated Discord webhook message with one embed per project.
 * Discord limits 10 embeds per message, 6000 chars total — we split into batches.
 */
export async function notifyDiscord(
  config: DiscordConfig,
  results: ProjectResult[],
  dates: string[],
): Promise<void> {
  if (!config.webhookUrl) return;
  if (results.length === 0) return;

  const byProject = consolidateByProject(results);
  const embeds = byProject.map(toEmbed);
  const username = config.username ?? "Janus";

  // Header content
  const dateRange =
    dates.length === 1 ? dates[0] : `${dates[0]}…${dates[dates.length - 1]} (${dates.length} days)`;
  const headerContent = `🌙 **Daily Pulse — ${dateRange}**\n${renderTally(byProject)}`;

  const batches: typeof embeds[] = [];
  for (let i = 0; i < embeds.length; i += 10) {
    batches.push(embeds.slice(i, i + 10));
  }

  for (let i = 0; i < batches.length; i++) {
    const body = {
      username,
      content: i === 0 ? headerContent : undefined,
      embeds: batches[i],
    };
    try {
      const res = await fetch(config.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`[discord] webhook responded ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      // fetch rejects instead of returning a response when the request never
      // completes (DNS, connection refused, TLS). The notification is the last
      // step of a pulse run that already wrote its output — an unreachable
      // webhook must not turn a successful run into a failed one.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[discord] webhook request failed: ${message}`);
    }
  }
}

/**
 * Header tally. Counts only what actually succeeded: reporting every project as
 * "analyzed" made a failed run look identical to a clean one, and the failure
 * that lost a pulse went unnoticed for a day. Failures are named here because
 * the header is the part that is read at a glance.
 */
function renderTally(byProject: ProjectResult[]): string {
  const ok = byProject.filter((r) => r.status === "ok").length;
  const dryRun = byProject.filter((r) => r.status === "dry-run").length;
  const failed = byProject.filter((r) => r.status === "failed");

  const parts = [`${ok} projects analyzed`];
  if (dryRun > 0) parts.push(`${dryRun} dry-run`);
  if (failed.length > 0) {
    parts.push(`${failed.length} failed: ${truncate(failed.map((r) => r.project).join(", "), 200)}`);
  }
  return parts.join(" · ");
}

function consolidateByProject(results: ProjectResult[]): ProjectResult[] {
  // For multiple dates, keep the most recent one per project.
  const map = new Map<string, ProjectResult>();
  for (const r of results) {
    const prev = map.get(r.project);
    if (!prev || r.date > prev.date) map.set(r.project, r);
  }
  return [...map.values()].sort((a, b) => a.project.localeCompare(b.project));
}

function toEmbed(r: ProjectResult): Record<string, unknown> {
  const colors = { ok: 0x2ecc71, failed: 0xe74c3c, "dry-run": 0x95a5a6 } as const;
  const titleEmoji = { ok: "🟢", failed: "🔴", "dry-run": "⚫" }[r.status];

  const description =
    r.status === "failed"
      ? `**Error:** ${truncate(r.error ?? "?", 500)}`
      : truncate(extractTLDR(r.contentPreview ?? ""), 400);

  return {
    title: `${titleEmoji} ${r.project}`,
    description,
    color: colors[r.status],
    footer: { text: `${r.date} · ${r.status}` },
  };
}

function extractTLDR(content: string): string {
  // The report has frontmatter --- then ### 1. TL;DR
  const m = content.match(/TL;DR\s*\n+([^\n#][^#]*?)(?=\n#|$)/i);
  if (m && m[1]) return m[1].trim();
  // fallback: first 240 chars without frontmatter
  const noFrontmatter = content.replace(/^---[\s\S]*?---\n+/, "");
  return noFrontmatter.slice(0, 240);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
