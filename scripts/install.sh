#!/usr/bin/env bash
#
# Janus — installer one-liner
#
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/crewtives/janus/main/scripts/install.sh | bash
#
# Variables de entorno opcionales:
#   JANUS_PATH=~/path/custom     Directorio destino (default: ~/janus)
#   JANUS_REF=main               Branch/tag/sha a checkout (default: main)
#   JANUS_REPO=crewtives/janus   Override del repo (para forks)
#   JANUS_SKIP_BUN_INSTALL=1     No instalar Bun aunque falte (solo verificar)
#
# Plataformas soportadas:
#   - macOS (Darwin)              → scheduler: launchd
#   - Linux                       → scheduler: systemd-user timer
#   - Windows via WSL             → mismo que Linux (funciona automático)
#   - Windows nativo              → NO soportado todavía
#
# Lo que hace:
#   1. Verifica plataforma (macOS / Linux / WSL).
#   2. Verifica git.
#   3. Verifica Bun (lo ofrece instalar si falta — installer oficial).
#   4. Verifica Claude Code CLI (sin auto-instalación; da link si falta).
#   5. Clona el repo en JANUS_PATH (o git pull si ya existe).
#   6. Corre `bun install`.
#   7. Imprime el comando para arrancar el wizard interactivo.
#
# NO corre el wizard automáticamente porque curl|bash no tiene stdin
# interactivo — el wizard necesita una terminal real. Cuando termine este
# script, el último mensaje te dice qué comando correr.

set -euo pipefail

# ────────────────────────────────────────────────────────────────────────
# Config
# ────────────────────────────────────────────────────────────────────────

JANUS_PATH="${JANUS_PATH:-$HOME/janus}"
JANUS_REF="${JANUS_REF:-main}"
JANUS_REPO="${JANUS_REPO:-crewtives/janus}"
JANUS_SKIP_BUN_INSTALL="${JANUS_SKIP_BUN_INSTALL:-0}"

# Colores (solo si stdout es TTY)
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  CYAN="$(printf '\033[36m')"
  RESET="$(printf '\033[0m')"
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi

say() { printf "%s\n" "$*"; }
ok() { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn() { printf "${YELLOW}!${RESET} %s\n" "$*"; }
err() { printf "${RED}✗${RESET} %s\n" "$*" >&2; }
step() { printf "\n${BOLD}${CYAN}==> %s${RESET}\n" "$*"; }

abort() {
  err "$@"
  exit 1
}

# ────────────────────────────────────────────────────────────────────────
# Banner
# ────────────────────────────────────────────────────────────────────────

say ""
say "${BOLD}Janus${RESET} — el historiador personal del maker"
say "${DIM}https://github.com/${JANUS_REPO}${RESET}"
say ""

# ────────────────────────────────────────────────────────────────────────
# 1. Verificar plataforma (macOS + Linux + WSL)
# ────────────────────────────────────────────────────────────────────────

step "Verificando plataforma"

OS="$(uname -s)"
case "$OS" in
  Darwin)
    PLATFORM_LABEL="macOS"
    SCHEDULER_NAME="launchd"
    ;;
  Linux)
    PLATFORM_LABEL="Linux"
    SCHEDULER_NAME="systemd-user timer"
    # Detectar WSL (Linux corriendo sobre Windows) — sigue siendo Linux funcional
    if grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
      PLATFORM_LABEL="WSL (Linux on Windows)"
    fi
    ;;
  *)
    err "Janus no soporta esta plataforma: $OS"
    err "Soportadas: macOS (Darwin), Linux (incluyendo WSL en Windows)."
    err "Windows nativo no soportado todavía — usá WSL: https://learn.microsoft.com/windows/wsl/install"
    exit 1
    ;;
esac
ok "$PLATFORM_LABEL detectado · scheduler: $SCHEDULER_NAME"

# ────────────────────────────────────────────────────────────────────────
# 2. Verificar git
# ────────────────────────────────────────────────────────────────────────

step "Verificando git"

if ! command -v git >/dev/null 2>&1; then
  abort "git no está instalado. Instalalo con: xcode-select --install"
fi
ok "git $(git --version | awk '{print $3}')"

# ────────────────────────────────────────────────────────────────────────
# 3. Verificar Bun (auto-instalar si falta)
# ────────────────────────────────────────────────────────────────────────

step "Verificando Bun"

if ! command -v bun >/dev/null 2>&1; then
  if [ "$JANUS_SKIP_BUN_INSTALL" = "1" ]; then
    abort "Bun no está instalado y JANUS_SKIP_BUN_INSTALL=1. Instalalo desde https://bun.sh"
  fi
  warn "Bun no está instalado. Instalando ahora con el installer oficial..."
  say "${DIM}curl -fsSL https://bun.sh/install | bash${RESET}"
  curl -fsSL https://bun.sh/install | bash

  # Bun se instala en ~/.bun/bin/bun. Agregamos al PATH para este script.
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! command -v bun >/dev/null 2>&1; then
    err "Bun se instaló pero no aparece en el PATH del script."
    err "Cerrá y reabrí la terminal, después corré este installer de nuevo."
    exit 1
  fi
  ok "Bun instalado en $(command -v bun)"
else
  ok "Bun $(bun --version) en $(command -v bun)"
fi

# ────────────────────────────────────────────────────────────────────────
# 4. Verificar Claude Code CLI (no auto-instalable)
# ────────────────────────────────────────────────────────────────────────

step "Verificando Claude Code CLI"

if ! command -v claude >/dev/null 2>&1; then
  warn "Claude Code CLI no está instalado."
  warn "Es necesario para que Janus genere los pulses (corre 'claude -p' headless)."
  warn ""
  warn "Instalación: https://docs.claude.com/en/docs/agents-and-tools/claude-code/overview"
  warn ""
  warn "Podés continuar la instalación de Janus igual, pero el primer 'pulse'"
  warn "va a fallar hasta que tengas Claude Code instalado y autenticado."
  warn ""
  # No abortamos — el user puede instalar Claude Code después y todavía usar
  # gemini-cli como provider alternativo si lo configura.
else
  ok "Claude Code CLI en $(command -v claude)"
fi

# ────────────────────────────────────────────────────────────────────────
# 5. Clonar el repo (o actualizar si ya existe)
# ────────────────────────────────────────────────────────────────────────

step "Setup en $JANUS_PATH"

if [ -d "$JANUS_PATH/.git" ]; then
  ok "Repo ya existe en $JANUS_PATH — haciendo git pull"
  git -C "$JANUS_PATH" fetch origin
  git -C "$JANUS_PATH" checkout "$JANUS_REF"
  git -C "$JANUS_PATH" pull --ff-only origin "$JANUS_REF" || {
    warn "git pull falló (posiblemente local commits divergentes)."
    warn "Tu copia queda como está. Mergeá manualmente si querés la última versión."
  }
elif [ -e "$JANUS_PATH" ]; then
  abort "$JANUS_PATH existe pero no es un repo git. Removelo o usá JANUS_PATH=otro/path."
else
  say "Clonando https://github.com/${JANUS_REPO}.git → $JANUS_PATH"
  git clone --branch "$JANUS_REF" "https://github.com/${JANUS_REPO}.git" "$JANUS_PATH"
  ok "Clonado"
fi

# ────────────────────────────────────────────────────────────────────────
# 6. bun install
# ────────────────────────────────────────────────────────────────────────

step "Instalando dependencias"

cd "$JANUS_PATH"
bun install
ok "Dependencias listas"

# ────────────────────────────────────────────────────────────────────────
# 7. Print next steps (no corremos el wizard porque stdin no es TTY)
# ────────────────────────────────────────────────────────────────────────

step "Listo"

say ""
say "${GREEN}${BOLD}✓ Janus instalado en $JANUS_PATH${RESET}"
say "${DIM}  plataforma: $PLATFORM_LABEL · scheduler: $SCHEDULER_NAME${RESET}"
say ""
say "Próximo paso — corré el wizard de onboarding en tu terminal:"
say ""
say "    ${BOLD}cd $JANUS_PATH${RESET}"
say "    ${BOLD}bun janus init${RESET}"
say ""
say "El wizard detecta tu auth de Claude Max, escanea proyectos git locales,"
say "configura el vault de Obsidian, e instala el scheduler nightly ($SCHEDULER_NAME)"
say "para correr el pulse automáticamente todos los días a las 10:00 AM."
say ""
say "${DIM}Docs: $JANUS_PATH/README.md${RESET}"
say "${DIM}Status del producto: $JANUS_PATH/docs/STATUS.md${RESET}"
say "${DIM}MCP server: $JANUS_PATH/docs/mcp.md${RESET}"
say ""
