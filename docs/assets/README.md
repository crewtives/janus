# Assets

Visual assets embedded in the project README and docs. Keep file names stable — they're referenced by relative path from README.md.

## Inventory

| File | Purpose | Status |
| --- | --- | --- |
| `janus-demo.png` | Terminal mockup of `janus demo` output. First-contact reassurance. | ✓ shipped |
| `wrapped-desktop.png` | 1920×1080 desktop poster screenshot of `docs/examples/wrapped-2026-sample.html`. The flagship visual. | ✓ shipped |
| `wrapped-mobile.png` | 390-wide portrait reflow of the same Wrapped sample. Shows the responsive single-column stack. | ✓ shipped |
| `janus-init.gif` | ~15s recording of the real `janus init` wizard (asciinema → agg). Adds motion to the first-contact panel. | TODO (optional upgrade over `janus-demo.png`) |
| `pulse-in-obsidian.png` | Screenshot of a daily pulse opened in Obsidian. | TODO (optional) |

## Capture recipes

### `janus-demo.png` (current)

Generated from a static HTML mockup so the image stays reproducible and doesn't leak personal paths. To regenerate after a `janus demo` UX change:

1. Run `janus demo --no-open` and copy the stdout.
2. Paste it into the existing terminal mockup HTML (titlebar + JetBrains Mono + the same color palette).
3. Screenshot with headless Chrome:
   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --headless=new --disable-gpu --hide-scrollbars \
     --window-size=1100,720 \
     --screenshot=docs/assets/janus-demo.png \
     file:///tmp/demo-mockup.html
   ```

### `janus-init.gif` (optional future upgrade)

A real recording of the wizard would beat the mockup once captured. Recommended toolchain: `asciinema` → `agg` (or `terminalizer`).

```bash
asciinema rec janus-init.cast -c "bun janus init"
agg janus-init.cast --speed 1.5 --theme monokai janus-init.gif
```

Trim to ≤15s. Highlight: language pick → Claude Max detection → project scan → vault detection → "all set" exit. Skip the scheduler install step (it's noisy).

### `wrapped-desktop.png` + `wrapped-mobile.png` (current)

Two headless-Chrome captures of the same synthetic Wrapped sample — the desktop poster (1920×1080) and the portrait reflow that the same HTML produces on mobile widths. Chrome is given a local HTTP origin because `file://` is rejected by some headless modes when scripts load fonts.

```bash
# Serve the repo so chrome can load it over http (sidesteps file:// font loading quirks)
bun -e "Bun.serve({port: 8765, fetch: (req) => new Response(Bun.file('.' + new URL(req.url).pathname))})" &

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Desktop: native canvas (the fit-script keeps scale=1 at 1920×1080)
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1920,1080 --force-device-scale-factor=2 \
  --screenshot=docs/assets/wrapped-desktop.png \
  http://localhost:8765/docs/examples/wrapped-2026-sample.html

# Mobile: 390 wide, tall enough to capture the whole vertical stack
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=390,3100 --force-device-scale-factor=2 \
  --screenshot=docs/assets/wrapped-mobile.png \
  http://localhost:8765/docs/examples/wrapped-2026-sample.html
```

Re-run after any template/CSS change to keep the README hero in sync.

### `pulse-in-obsidian.png`

Open any pulse from a vault in Obsidian, side-by-side with the file tree. Crop to show the prose + at least one wikilink + the frontmatter. If you don't have a real vault to show, run `janus demo` (when shipped) to materialize a synthetic one.

## Not committed

Don't commit the original `.cast` files or pre-trim recordings — only the final GIF/PNG. Keep total asset size under ~5 MB for the whole directory.
