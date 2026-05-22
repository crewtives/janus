# Assets

Visual assets embedded in the project README and docs. Keep file names stable — they're referenced by relative path from README.md.

## Inventory

| File | Purpose | Status |
| --- | --- | --- |
| `janus-demo.png` | Terminal mockup of `janus demo` output. First-contact reassurance. | ✓ shipped |
| `wrapped-hero.png` | Screenshot of `docs/examples/wrapped-2025-sample.html` rendered via headless Chrome. | ✓ shipped |
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

### `wrapped-hero.png` (current)

Generated with headless Chrome against the synthetic Wrapped sample. Reproducible:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1280,1800 \
  --screenshot=docs/assets/wrapped-hero.png \
  --default-background-color=00000000 \
  "file://$(pwd)/docs/examples/wrapped-2025-sample.html"
```

The hero shows the title, the maker personality archetype, the at-a-glance numbers, and the top tracks list.

### `pulse-in-obsidian.png`

Open any pulse from a vault in Obsidian, side-by-side with the file tree. Crop to show the prose + at least one wikilink + the frontmatter. If you don't have a real vault to show, run `janus demo` (when shipped) to materialize a synthetic one.

## Not committed

Don't commit the original `.cast` files or pre-trim recordings — only the final GIF/PNG. Keep total asset size under ~5 MB for the whole directory.
