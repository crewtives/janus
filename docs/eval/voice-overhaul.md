# Eval — voice overhaul de prompts (Phase 1A)

Cómo evaluar el cambio de voz narrativa de los prompts sin romper la bóveda productiva.

## Contexto

Phase 1A bumpeó todos los prompts a versión nueva:

| Prompt | v anterior | v nueva | Constante |
|---|---|---|---|
| daily-pulse | v4 | **v5** | `PROMPT_VERSION` en `src/core/template.ts` |
| daily-rollup | v2 | **v3** | `ROLLUP_PROMPT_VERSION` en `src/core/daily.ts` |
| weekly-rollup | v2 | **v3** | `WEEKLY_PROMPT_VERSION` en `src/core/weekly.ts` |
| monthly-digest | v1 | **v2** | `MONTHLY_PROMPT_VERSION` en `src/core/monthly.ts` |
| quarterly-retro | v1 | **v2** | `QUARTERLY_PROMPT_VERSION` en `src/core/aggregations.ts` |
| yearly-retro | v1 | **v2** | `YEARLY_PROMPT_VERSION` en `src/core/aggregations.ts` |
| project-spine | v1 | **v2** | `SPINE_PROMPT_VERSION` en `src/core/spine.ts` |

Todos los prompts ahora inyectan **`src/prompts/_voice.md`** al inicio — la spec única de la voz de Janus. El frontmatter de cada pulse incluye `prompt_version` así podés ver en disco qué versión generó cada nota.

## Flujo recomendado de evaluación

### 1. Smoke test sin LLM (rápido, gratis)

```bash
bun test tests/template.test.ts
bun janus pulse --dry-run                  # renderea prompts del último día sin invocar Claude
```

Esto solo verifica que el prompt rendereado contiene el voice spec y la estructura nueva. No prueba la calidad del output del LLM.

### 2. Eval side-by-side (con LLM)

```bash
# Regenera los últimos 3 pulses de TODOS los proyectos active con prompt v5
# Output va a <vault>/_eval/ — no toca pulse/ original
bun run scripts/eval-prompt-voice.ts --last 3

# O scopear a un proyecto
bun run scripts/eval-prompt-voice.ts --project crewtives-janus --last 5

# Dry-run primero (solo renderea el prompt, no llama al LLM)
bun run scripts/eval-prompt-voice.ts --project crewtives-janus --dry-run
```

Output:
- `<vault>/_eval/<date>--<project>.new.md` por cada pulse regenerado.
- `<vault>/_eval/README.md` con índice + paths para comparar lado a lado.

### 3. Comparar en Obsidian

Abrir `<vault>/_eval/README.md`. Por cada bullet, abrir el original y el `.new` en vista dividida (`Ctrl+Shift+O` por defecto en macOS para split).

Lo que mirar:
- **TL;DR**: ¿pasó de bullets a párrafo?
- **Vs Roadmap**: ¿pasó de checklist a párrafo narrativo?
- **Decisions**: ¿están más densas (contexto incluido) en lugar de fragmentos sueltos?
- **Length**: ¿el output total es similar o más corto que antes? (la prosa densa cabe en menos palabras que listas fragmentadas).
- **Honestidad**: si el día fue lento, ¿lo dice claramente?
- **Adjetivos vacíos**: ¿desaparecieron "sólido", "increíble", "productivo"?

### 4. Limpieza

```bash
rm -rf <vault>/_eval/
```

El directorio `_eval/` no se autoarchiva — es para inspección manual.

## Si querés revertir

```bash
# Volver a v4 (daily-pulse) — cambiar la constante en src/core/template.ts
# de "v5" → "v4". Y eliminar `voice` del context.
# Los .v5.md siguen en disco; los .v4.md también — ningún prompt se borró.
```

Cada `.v*.md` vive en `src/prompts/` con sufijo de versión. La rama vieja sigue disponible.

## Si encontrás un patrón roto en muchos pulses

Editar `src/prompts/_voice.md` con la nueva regla, hacer commit, y re-correr el eval. La spec de voz es **fuente única** — los 7 prompts la consumen automáticamente.

Si el cambio es estructural (no solo de voz) y rompe el frontmatter o las callouts, bumpeás de v5 → v6 (y constante correspondiente) en lugar de editar v5 en-place.
