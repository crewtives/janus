#!/usr/bin/env bash
#
# Janus — binary installer (no Bun required)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/crewtives/janus/main/scripts/install-binary.sh | bash
#
# Environment variables:
#   JANUS_VERSION=v0.3.0         Release tag to install (default: latest)
#   JANUS_INSTALL_DIR=~/.local/bin    Install destination (default: ~/.local/bin)
#   JANUS_REPO=crewtives/janus   Override the repo (for forks)
#   JANUS_SKIP_CHECKSUM=1        Skip SHA256 verification (NOT recommended)
#
# Supported platforms:
#   - macOS (Darwin) arm64 / x86_64
#   - Linux         x86_64 / aarch64
#   - Windows native — not supported; use WSL.
#
# What this does:
#   1. Detects OS and architecture via `uname`.
#   2. Resolves the requested release tag (or "latest") from the GitHub API.
#   3. Downloads the matching binary asset and the SHA256SUMS file.
#   4. Verifies the checksum unless JANUS_SKIP_CHECKSUM=1.
#   5. Installs to $JANUS_INSTALL_DIR/janus with `chmod +x`.
#   6. Prints PATH guidance if the install dir is not already on PATH.
#
# For developers building from source, use scripts/install.sh instead — it
# clones the repo and runs `bun install`.

set -euo pipefail

REPO="${JANUS_REPO:-crewtives/janus}"
VERSION="${JANUS_VERSION:-latest}"
INSTALL_DIR="${JANUS_INSTALL_DIR:-$HOME/.local/bin}"
SKIP_CHECKSUM="${JANUS_SKIP_CHECKSUM:-0}"

c_red() { printf "\033[31m%s\033[0m" "$*"; }
c_green() { printf "\033[32m%s\033[0m" "$*"; }
c_yellow() { printf "\033[33m%s\033[0m" "$*"; }
c_dim() { printf "\033[2m%s\033[0m" "$*"; }
err() { printf "%s %s\n" "$(c_red "✗")" "$*" >&2; exit 1; }
info() { printf "%s %s\n" "$(c_green "→")" "$*"; }
warn() { printf "%s %s\n" "$(c_yellow "!")" "$*"; }

# 1. Detect OS / arch.
os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) os_label="macos" ;;
  Linux)  os_label="linux" ;;
  *)      err "Unsupported OS: $os. Native Windows is not supported; use WSL." ;;
esac

case "$arch" in
  x86_64|amd64)  arch_label="x64" ;;
  arm64|aarch64) arch_label="arm64" ;;
  *)             err "Unsupported architecture: $arch" ;;
esac

asset="janus-${os_label}-${arch_label}"
info "Detected: ${os_label}/${arch_label} → asset \`$asset\`"

# 2. Resolve the release tag.
if [ "$VERSION" = "latest" ]; then
  info "Resolving latest release of $REPO..."
  if command -v gh >/dev/null 2>&1; then
    tag="$(gh release view --repo "$REPO" --json tagName -q .tagName)"
  else
    tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
  fi
  [ -n "$tag" ] || err "Could not resolve the latest release tag from $REPO."
  VERSION="$tag"
fi
info "Installing $REPO @ $(c_green "$VERSION")"

base_url="https://github.com/${REPO}/releases/download/${VERSION}"
binary_url="${base_url}/${asset}"
checksum_url="${base_url}/SHA256SUMS"

# 3. Download to a tmp dir.
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
binary_path="${tmp_dir}/${asset}"

info "Downloading $binary_url"
if ! curl -fsSL -o "$binary_path" "$binary_url"; then
  err "Failed to download $binary_url. Verify the asset exists for $VERSION."
fi

# 4. Checksum verification.
if [ "$SKIP_CHECKSUM" = "1" ]; then
  warn "JANUS_SKIP_CHECKSUM=1 — skipping SHA256 verification."
else
  info "Verifying SHA256 against $checksum_url"
  checksum_path="${tmp_dir}/SHA256SUMS"
  if ! curl -fsSL -o "$checksum_path" "$checksum_url"; then
    warn "Could not download SHA256SUMS (release might predate the checksum job). Set JANUS_SKIP_CHECKSUM=1 to bypass."
    err "Refusing to install without checksum verification."
  fi

  expected="$(grep " $asset\$" "$checksum_path" | awk '{print $1}')"
  [ -n "$expected" ] || err "No checksum entry for $asset in SHA256SUMS."

  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$binary_path" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$binary_path" | awk '{print $1}')"
  else
    err "Neither sha256sum nor shasum is available. Cannot verify the download."
  fi

  if [ "$expected" != "$actual" ]; then
    err "Checksum mismatch: expected $expected, got $actual."
  fi
  info "$(c_green "Checksum OK")"
fi

# 5. Install.
mkdir -p "$INSTALL_DIR"
target="${INSTALL_DIR}/janus"
mv "$binary_path" "$target"
chmod +x "$target"
info "Installed: $(c_green "$target")"

# macOS quarantine note.
if [ "$os_label" = "macos" ]; then
  if xattr -p com.apple.quarantine "$target" >/dev/null 2>&1; then
    printf "\n"
    printf "%s\n" "$(c_yellow "──────────────────────────────────────────────────────────")"
    printf "%s\n" "$(c_yellow "  macOS Gatekeeper quarantined the binary (one-time step) ")"
    printf "%s\n" "$(c_yellow "──────────────────────────────────────────────────────────")"
    printf "\n"
    printf "  This is normal: the release binary is not yet signed with\n"
    printf "  an Apple Developer ID. Strip the quarantine flag once and\n"
    printf "  Gatekeeper will trust this exact binary from then on.\n"
    printf "\n"
    printf "  %s\n" "$(c_green "xattr -d com.apple.quarantine \"$target\"")"
    printf "\n"
    printf "  %s\n" "$(c_dim "(Code-signing + notarization is tracked for v0.3.)")"
    printf "\n"
  fi
fi

# 6. PATH guidance.
case ":$PATH:" in
  *:"$INSTALL_DIR":*)
    info "PATH already includes $INSTALL_DIR — you can run \`janus --help\` now."
    ;;
  *)
    warn "$INSTALL_DIR is not on your PATH."
    printf "  Add this to your shell rc:\n"
    printf "    %s\n" "$(c_dim "export PATH=\"$INSTALL_DIR:\$PATH\"")"
    printf "  …or invoke the binary by its full path: $(c_dim "$target")\n"
    ;;
esac

printf "\nNext: %s\n" "$(c_green "janus init")"
printf "  %s\n" "$(c_dim "(interactive setup; configures projects, vault, and scheduler)")"
