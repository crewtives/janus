# Examples

Synthetic samples of Janus output. Generated from fabricated data — none of these reflect a real user's projects, dates, or activity.

## Janus Wrapped — synthetic 2026

- [`wrapped-2026-sample.md`](wrapped-2026-sample.md) — yearly Wrapped in Markdown, rendered by `renderDeterministic()` against three fake projects (`helios`, `kepler`, `atlas`).
- [`wrapped-2026-sample.html`](wrapped-2026-sample.html) — same data, HTML rendering on a fixed 1920×1080 canvas (Utilitarian Precision design system, Inter Tight, semantic red). Open it in a browser; the inline fit script scales the poster down to the viewport. Obsidian's reading view shows it at native size with horizontal scroll.

The Markdown sample is generated with the deterministic fallback renderer, not via the LLM. That preserves a runnable, reviewable artifact in the repo (no API calls, no PII, no model variance). A real `bun janus wrapped` run produces longer narrative prose; the structure is identical.

## Regenerating

```bash
bun run scripts/gen-wrapped-sample.ts          # md + html
bun add -d puppeteer
bun run scripts/gen-wrapped-sample.ts --png    # adds wrapped-2026-sample.png
```

PNG export is opt-in because `puppeteer` ships Chromium (~280 MB) and would inflate the install for every contributor.
