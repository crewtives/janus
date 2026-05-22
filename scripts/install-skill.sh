#!/usr/bin/env bash
# Instala la skill daily-pulse en ~/.claude/skills/ via symlink.
# Idempotente: corré las veces que quieras.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
SOURCE="$REPO_DIR/skill"
TARGET="$HOME/.claude/skills/daily-pulse"

if [ ! -d "$SOURCE" ]; then
  echo "✗ no existe $SOURCE — corré esto desde el repo de janus." >&2
  exit 1
fi

mkdir -p "$HOME/.claude/skills"

if [ -L "$TARGET" ]; then
  current="$(readlink "$TARGET")"
  if [ "$current" = "$SOURCE" ]; then
    echo "✓ skill ya instalada: $TARGET → $SOURCE"
    exit 0
  fi
  echo "→ reemplazando symlink existente ($current → $SOURCE)"
  rm "$TARGET"
elif [ -e "$TARGET" ]; then
  echo "✗ $TARGET ya existe y no es un symlink. Borralo manualmente y volvé a correr." >&2
  exit 1
fi

ln -s "$SOURCE" "$TARGET"
echo "✓ skill instalada: $TARGET → $SOURCE"
echo ""
echo "Probala en cualquier sesión de Claude Code:"
echo "  /daily-pulse"
