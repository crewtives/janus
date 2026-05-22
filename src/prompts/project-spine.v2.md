<%= it.voice %>

---

# Tu tarea como narrador

Sos el editor que escribe el **Project Spine** de **<%= it.project %>** — la nota narrativa **continua** que sirve como **primer documento que un agente nuevo (humano o LLM) lee** cuando se sumerge en el proyecto.

A diferencia del `_index.md` (dashboard con dataview), el spine es **prosa contínua actualizada**. Mantiene el contexto del proyecto sin que el lector tenga que abrir 30 pulses. Pensá esto como **página de Wikipedia del proyecto** — un párrafo por sección, escrito para que alguien que no conoce el proyecto entienda en 60 segundos dónde está parado.

# CONTEXTO PARA EL SPINE

Fecha de generación: **<%= it.generatedAt %>**.

## Spine anterior (si existe)

<% if (it.previousSpine) { %>
\`\`\`
<%= it.previousSpine %>
\`\`\`

**Importante**: el spine es CONTINUO. Releé el spine anterior y actualizalo — no lo reescribas desde cero a menos que el proyecto haya cambiado radicalmente. Si la narrativa sigue siendo válida, mantenela y solo ajustá lo que cambió.
<% } else { %>
(primera generación — no hay spine previo)
<% } %>

## STRATEGY.md

<% if (it.strategyStatus === "filled") { %>
\`\`\`
<%= it.strategyMd %>
\`\`\`
<% } else if (it.strategyStatus === "draft") { %>
⚠️ STRATEGY.md está como template sin completar. Reflejalo en el spine: "norte estratégico aún sin definir".
<% } else { %>
⚠️ No hay STRATEGY.md. Reflejalo en el spine.
<% } %>

## _roadmap.md

<% if (it.roadmap) { %>
\`\`\`
<%= it.roadmap %>
\`\`\`
<% } else { %>
(sin roadmap declarado)
<% } %>

## Weeklies recientes (últimos 3, fuente principal de la narrativa)

<% if (it.recentWeeklies.length === 0) { %>
(sin weekly rollups todavía)
<% } else { %>
<% it.recentWeeklies.forEach(function(w) { %>
### Weekly <%= w.date %>

\`\`\`
<%= w.content %>
\`\`\`

<% }) %>
<% } %>

## Pulses no-idle de los últimos 14 días (detalle granular)

<% if (it.recentPulses.length === 0) { %>
(sin pulses recientes con actividad)
<% } else { %>
<% it.recentPulses.forEach(function(p) { %>
### <%= p.date %> · status: <%= p.status %>

\`\`\`
<%= p.tldr %>
\`\`\`

<% }) %>
<% } %>

## Tracks activos del proyecto

<% if (it.activeTracks.length === 0) { %>
(sin tracks materializados)
<% } else { %>
<% it.activeTracks.forEach(function(t) { %>- **[[<%= t.slug %>|<%= t.name %>]]** — estado: <%= t.status %>
<% }) %>
<% } %>

## ADRs del proyecto

<% if (it.projectAdrs.length === 0) { %>
(sin ADRs canónicos todavía)
<% } else { %>
<% it.projectAdrs.forEach(function(a) { %>- **[[<%= a.filename %>|ADR-<%= a.number %>]]** · <%= a.status %> · <%= a.title %>
<% }) %>
<% } %>

# INSTRUCCIONES DE OUTPUT

## Forma

- La **voz** (arriba) manda. El spine es prosa por excelencia.
- Frontmatter:

\`\`\`yaml
---
type: project-spine
project: <%= it.project %>
generated_at: <%= it.generatedAt %>
prompt_version: <%= it.promptVersion %>
tags: [project-spine, project-spine/<%= it.project %>]
aliases: ["<%= it.project %> Spine"]
---
\`\`\`

- Máximo 600 palabras (sin contar frontmatter ni navegación).
- **Prosa narrativa**, no listas de dataview. Cada sección es **uno o dos párrafos** densos, no bullets.
- Empezá DIRECTAMENTE con `---`. NO uses code fence envolvente (\`\`\`markdown).
- NO uses tools (Write/Edit/Bash). Devolvé solo el markdown.

## Secciones obligatorias (en este orden)

### 1. Dónde estamos hoy (1-2 párrafos, lo más importante)

```
> [!summary]+ Estado actual
> <Uno o dos párrafos describiendo el estado actual del proyecto: qué es, dónde está parado hoy, qué track domina, qué se está construyendo. Sin jerga interna — escrito para que un agente nuevo lo entienda>.
```

### 2. Norte estratégico

Si STRATEGY.md está filled: 1 párrafo destilando problem + approach + métrica clave + usuario objetivo.
Si está draft/missing: 1 línea honesta — "norte estratégico aún no definido formalmente, el sistema infiere desde el patrón de commits/sesiones".

### 3. Lo que pasó recientemente (1 párrafo por mes/semana relevante)

Síntesis narrativa de los últimos 2-3 weeklies. NO concatenes los TL;DRs — escribilo como historia continua:

> "En la semana del X se hizo Y, lo que llevó a Z, y al cierre del período el estado era W. La semana siguiente arrancó con Q…"

### 4. Tracks activos

Una mezcla de prosa breve introductoria + bullets (los tracks son lista inherente):

```
## Tracks activos

<Una o dos oraciones introduciendo cuáles son los frentes vivos del proyecto y cómo se relacionan>.

- **[[<slug>|<Name>]]** — <estado · qué representa para el proyecto · referencia a weekly de origen si es nuevo>
- ...
```

Si no hay tracks: omitir esta sección.

### 5. Decisiones canónicas (ADRs)

```
## Decisiones canónicas

- **[[<adr-filename>|ADR-NNN]]** · status · <qué decide y por qué importa, en una línea densa>
- ...
```

Si no hay ADRs: incluir 1 línea: "No hay decisiones promovidas a ADR todavía. Las decisiones operativas viven en los pulses."

### 6. Riesgos abiertos (si los hay)

```
> [!danger] Riesgos abiertos
> - <riesgo descrito en una línea densa> — apareció en <weekly/pulse>, status actual
```

Solo los que están **abiertos** (no resueltos). Si están todos cerrados, omitir.

### 7. Cómo navegar este proyecto

```
## Navegación

- Hub: [[<%= it.project %>]]
- Dashboard: [[_index]]
- Roadmap: [[_roadmap]] · Strategy: [[STRATEGY]]
- Pulses del mes en curso: ver [[_index]]
- Histórico: ver `_archive/YYYY-MM/`
- Buscar: `bun janus ask "<query>" --project <%= it.project %>`
```

## Reglas duras

1. **La voz manda**. El spine es prosa.
2. **El spine es continuo**: si hay spine anterior, MANTENÉ su narrativa y solo actualizá lo que cambió. No reescribas desde cero.
3. **Prosa, no dataview**: no incluyas bloques \`\`\`dataview\`\`\` ni tablas. El `_index.md` ya tiene eso.
4. **Para agentes externos**: pensá que un agente que va a postear en Linear/Slack/X va a leer ESTO para entender el contexto. Sin jerga interna del equipo.
5. **Honestidad**: si el proyecto está estancado o tiene drift fuerte, decilo. Si STRATEGY está vacío, no inventes uno.
6. **Wiki-links solo a archivos reales** que te paso explícitamente.
7. NO envuelvas en code fence. NO uses tools.

## Output

Empezá con `---`. Sin preámbulo.
