---
name: daily-pulse
description: Genera el daily pulse de uno o varios proyectos configurados — un reporte markdown con avance, decisiones y blockers extraídos de git + sesiones de Claude Code, y los deja en la bóveda Obsidian del usuario. También expone el weekly rollup cross-proyecto (`rollup --week`) y el daily consolidado por fecha. Usar cuando el usuario pida "daily pulse", "reporte del día", "pulse de X", "qué se hizo hoy", "backfill", "weekly rollup", "consolidado semanal" o quiera ejecutar Janus on-demand. Acepta args opcionales para fechas, proyecto específico, o dry-run.
---

# Daily Pulse (Janus)

## Qué hace

Esta skill invoca el CLI de [Janus](file://~/janus), que orquesta una corrida de `claude -p` headless por cada proyecto configurado y genera un reporte estructurado:

- TL;DR
- Shipped / In flight / Vs Roadmap
- Decisions (extraídas del texto real de las sesiones; cross-ref a pulses previos cuando aplica)
- Risks / Blockers (marca **Recurrente** con wiki-link al pulse original)
- Next 24h
- Raw activity colapsable

Los reportes quedan en:
- La bóveda Obsidian del usuario (`<vault>/<project>/pulse/YYYY-MM-DD--<project>.md`).
- El repo de cada proyecto (`docs/pulse/YYYY-MM-DD--<project>.md`).

Al cerrar la cola de cada fecha, además:
- Genera un **daily consolidado** cross-proyecto vía LLM en `<vault>/Daily/YYYY-MM-DD.md`.
- Si hay webhook de Discord configurada, notifica con embeds por proyecto.
- Enriquece la bóveda (`_index.md`, `_roadmap.md` draft, `STRATEGY.md` template) de forma idempotente.

Adicionalmente, el comando `rollup --week` genera un **weekly rollup** cross-proyecto en `<vault>/Daily/Weekly/YYYY-MM-DD-week.md`.

## Cuándo usar

Activá esta skill cuando el usuario:
- Diga "corré el daily pulse" / "generá el pulse de hoy" / "/daily-pulse".
- Pida un backfill ("pulse de los últimos 7 días", "rellená la semana").
- Pida el pulse de un proyecto específico ("solo crewtives-janus").
- Quiera un dry-run para inspeccionar el prompt sin gastar requests.
- Pida un **weekly rollup** ("consolidado semanal", "rollup de la semana", "tracks de la última semana").
- Pida regenerar el daily consolidado ("consolidado del 2026-05-15").
- Pida agregaciones temporales superiores: monthly / quarterly / yearly digest.
- Pida regenerar el **spine** (narrativa continua) de uno o todos los proyectos.
- Pida **descubrir proyectos git nuevos** (`janus discover`) — dry-run o `--apply`.
- Pida **onboarding** ("setup janus en esta máquina", "wizard de instalación") → `janus init`.

No la uses para:
- Editar el código de Janus (eso es trabajo normal de Claude Code).

## Cómo invocarla

Mapeo entre intención del usuario y comando concreto:

| Pedido del usuario | Comando |
|---|---|
| "Pulse de ayer" / sin args | `cd ~/janus && bun run bin/janus.ts pulse` |
| "Backfill últimos N días" | `cd ~/janus && bun run bin/janus.ts pulse --backfill <N>d` |
| "Solo el proyecto X" | `cd ~/janus && bun run bin/janus.ts pulse --project <X>` |
| "Desde fecha Y" | `cd ~/janus && bun run bin/janus.ts pulse --since <YYYY-MM-DD>` |
| "Correr de nuevo / reprocesar un día puntual" | `cd ~/janus && bun run bin/janus.ts pulse --date <YYYY-MM-DD> --force` |
| "Dry-run / preview" | `cd ~/janus && bun run bin/janus.ts pulse --dry-run` |
| "Reintentar fallos" | `cd ~/janus && bun run bin/janus.ts retry` |
| "Verificá que esté todo OK" | `cd ~/janus && bun run bin/janus.ts doctor` |
| "Onboarding / setup wizard" | `cd ~/janus && bun run bin/janus.ts init` |
| "Weekly rollup" / "consolidado semanal" | `cd ~/janus && bun run bin/janus.ts rollup --week` |
| "Rollup de N días" | `cd ~/janus && bun run bin/janus.ts rollup --days <N>` |
| "Monthly digest" | `cd ~/janus && bun run bin/janus.ts monthly` |
| "Quarterly retro" | `cd ~/janus && bun run bin/janus.ts quarterly` |
| "Yearly retro" | `cd ~/janus && bun run bin/janus.ts yearly` |
| "Project spine" (todos o uno) | `cd ~/janus && bun run bin/janus.ts spine [--project <name>]` |
| "Descubrir proyectos git nuevos" | `cd ~/janus && bun run bin/janus.ts discover [--apply]` |
| "Búsqueda full-text en el vault" | `cd ~/janus && bun run bin/janus.ts ask "<query>"` |
| "Arrancar MCP server" / "exponer Janus a otra sesión" | `cd ~/janus && bun run bin/janus.ts mcp` |
| "Draft de Note para el portfolio" / "armame una nota sobre X" | `cd ~/janus && bun run bin/janus.ts note "<topic>" [--title "..."] [--project <name>]` |
| "Scaffold completo del vault" (hubs + MOCs + dashboards + fix wiki-links) | `cd ~/janus && bun run scripts/scaffold-vault.ts` |
| "Eval del voice overhaul side-by-side" | `cd ~/janus && bun run scripts/eval-prompt-voice.ts --last 3` |
| "Smoke validation de Phase 1" | `cd ~/janus && bun run scripts/smoke-validate-phase1.ts` |
| "Regenerar daily consolidado" | `cd ~/janus && bun run scripts/regenerate-dailys.ts [YYYY-MM-DD]` |
| "Enriquecer vault (idx/roadmap/strategy)" | `cd ~/janus && bun run scripts/enrich-vault.ts [project-name]` |
| "Fix wiki-link 'Pulse anterior' alucinado por LLM" | `cd ~/janus && bun run scripts/fix-pulse-anterior-links.ts [--dry-run]` |

Los flags se pueden combinar (ej. `--backfill 7d --project crewtives-janus`).

## Flujo recomendado

1. **Onboarding (primera vez en una máquina)**: `bun janus init`. El wizard detecta auth, vault, proyectos, instala launchd y corre `doctor` + `pulse --dry-run` para validar.
2. **Antes de la primera corrida productiva**: el wizard ya corrió `doctor`. Si saltaste el wizard, corré `doctor` manualmente.
3. **Primera semana de datos**: `pulse --backfill 7d` para tener una semana de contexto.
4. **Día a día**: el cron de launchd lo dispara solo; usar esta skill solo si querés:
   - Adelantar el reporte de hoy ("dame el pulse ahora").
   - Reprocesar un día que falló o que se editó después.
   - Ver el prompt rendereado antes de mandarlo al LLM.
5. **Agregar proyectos nuevos**: `bun janus discover` para detectar repos git que no están en config, después `--apply` para agregarlos.
6. **Cierre de período** (semana/mes/trimestre/año): los rollups respectivos. El monthly auto-archiva los pulses del mes a `_archive/`.

## Notas

- El proceso puede tardar varios minutos según número de proyectos y volumen de actividad.
- Es idempotente: si un (proyecto, fecha) ya está `done`, se saltea. Para reprocesar usá `--force` (ignora el checkpoint y regenera aunque esté `done`); combinalo con `--date <YYYY-MM-DD>` para apuntar a un día puntual sin arrastrar el resto del rango (p. ej. tras editar config o el output). `--date` tiene prioridad sobre `--since`/`--backfill`. `retry` queda para reprocesar el dead-letter de fallos. (Antes había que borrar el row a mano en `.janus/state.db`; ya no.)
- Janus hereda la auth del provider configurado (`claude-code` → Claude Max OAuth, `gemini-cli` → GOOGLE_API_KEY o `~/.gemini/credentials.json`). No gasta API tokens con Claude Max.
- `provider` y `fallbackProvider` se eligen en `config.local.json`. `doctor` chequea solo los CLIs de los providers configurados.
- Si no hay actividad en un proyecto, igual genera un pulse con `status: idle` para que el dashboard Obsidian quede completo.
- El daily consolidado se genera automáticamente al cerrar la cola de cada fecha. El weekly rollup hay que dispararlo a mano con `rollup --week`.
- El orchestrator enriquece la bóveda (`_index.md`, `_roadmap.md` draft, `STRATEGY.md` template) al final de cada corrida — es idempotente y respeta los archivos editados por el usuario (`needs_review: false`).
- Al final de cada `pulse` el orchestrator también dispara el **scaffold completo** del vault (hubs + MOCs + dashboards + fix-prev). Idempotente — no toca archivos existentes salvo `--force`.
- Voz narrativa unificada en `src/prompts/_voice.md` — todos los prompts (daily-pulse v5, daily-rollup v3, weekly v3, monthly v2, quarterly v2, yearly v2, spine v2) la inyectan.
- **MCP server** (`bun janus mcp`) expone 4 tools tipados consumibles desde Claude Code/Cursor/Codex. Ver `docs/mcp.md` para wire format y el contraste Janus vs companion-agent.
- **Bookkeeping persistido en SQLite** (Phase 1C): `project_metadata` (birth dates), `track_lineage` (mentions cross-proyecto), `decision_graph` (referencias ADR). Habilita Phase 2 (reflection) y Phase 3 (Wrapped).
- **Ver `docs/ARCHITECTURE.md`** del repo para diagramas mermaid del flow end-to-end y decisiones técnicas.

## Output esperado

Después de correr, mostrar al usuario:
- Cantidad de proyectos × fechas procesados (ok / failed / skipped).
- Paths donde quedaron los archivos (Obsidian + repo).
- Si hubo fallos, qué proyectos/fechas y el error.
- Si se mandó a Discord, confirmar el envío.
