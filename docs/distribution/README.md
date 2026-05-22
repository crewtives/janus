# Distribution

Files and templates supporting how Janus reaches users.

- **[LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md)** — the ordered list of remaining manual steps to flip the repo public and launch.

## `homebrew/janus.rb`

Template for the [Homebrew formula](https://docs.brew.sh/Formula-Cookbook) that powers `brew install crewtives/tap/janus`. The formula itself lives in a separate tap repo (`crewtives/homebrew-tap`), not here. This is the canonical copy of the template — the auto-bump GitHub Action in `.github/workflows/release.yml` keeps the tap's `Formula/janus.rb` in sync with new releases.

One-time bootstrap:

```bash
gh repo create crewtives/homebrew-tap --public
cd $(mktemp -d) && git clone https://github.com/crewtives/homebrew-tap.git
cd homebrew-tap
mkdir -p Formula
cp /path/to/janus/docs/distribution/homebrew/janus.rb Formula/janus.rb
# Edit Formula/janus.rb: replace the four SHA256 placeholders with actual hashes
# (find them in the SHA256SUMS artifact of the latest GitHub Release).
git add Formula/janus.rb && git commit -m "init: janus v0.2.0"
git push
```

Then:

```bash
brew install crewtives/tap/janus
```

After bootstrap, every Janus release auto-opens a bump PR against the tap repo if the `homebrew-bump` job in `release.yml` is activated (see comments in the workflow).
