<%= it.voice %>

---

# Tu tarea como narrador hoy

Generar el **Daily Pulse** del proyecto **<%= it.project %>** correspondiente al día **<%= it.date %>**. Sos el narrador continuo de este proyecto — el pulse de hoy es un capítulo más de una historia que el lector viene siguiendo.

El output queda en `<vault>/Projects/<%= it.project %>/pulse/<%= it.date %>--<%= it.project %>.md`. El usuario lo lee en Obsidian Desktop — aprovechá lo que Obsidian hace bien (callouts, wiki-links, properties tipadas, dataview), pero **la voz** que está arriba manda sobre cualquier formato.

# CONTEXTO DEL PROYECTO

## STRATEGY.md (norte estratégico)

<%= it.strategyMd || "(no hay STRATEGY.md)" %>

## _roadmap.md (hitos activos)

<%= it.roadmap || "(no hay _roadmap.md)" %>

## README.md (objetivo y stack)

<%= it.readmeMd || "(no hay README.md)" %>

## CLAUDE.md (convenciones)

<%= it.claudeMd || "(no hay CLAUDE.md)" %>

# ACTIVIDAD DEL DÍA

## Branch y working tree

- Branch: `<%= it.branch %>`
- Working tree: <%= it.isClean ? "limpio" : "sucio (cambios sin commitear)" %>

## Commits (<%= it.commits.length %>)

<% if (it.commits.length === 0) { %>
(sin commits)
<% } else { %>
<% it.commits.forEach(function(c) { %>
- `<%= c.shortSha %>` <%= c.subject %><% if (c.body) { %> — <%= c.body.split("\n").join(" ") %><% } %>
<% }) %>
<% } %>

## Métricas del día

- Commits por tipo: <% Object.keys(it.commitTypes).forEach(function(t) { %><%= t %>=<%= it.commitTypes[t] %> <% }) %>
- Líneas: **+<%= it.insertions %> / -<%= it.deletions %>**
- Top carpetas tocadas:
<% it.topFolders.forEach(function(f) { %>  - `<%= f.folder %>`: <%= f.count %> archivos
<% }) %>

## Diff stat (resumido)

```
<%= it.diffStat || "(sin cambios)" %>
```

## Archivos tocados (<%= it.filesChanged.length %>)

<% if (it.filesChanged.length === 0) { %>
(ninguno)
<% } else { %>
<% it.filesChanged.forEach(function(f) { %>
- <%= f %>
<% }) %>
<% } %>

## Sesiones de Claude Code (<%= it.sessions.length %>)

<% if (it.sessions.length === 0) { %>
(sin sesiones registradas hoy)
<% } else { %>
<% it.sessions.forEach(function(s) { %>
### <%= s.firstTimestamp || "?" %> — sesión `<%= (s.sessionId || "????????").slice(0,8) %>`

- Modelo: <%= s.model || "?" %>
- Mensajes: <%= s.messageCount %> (user: <%= s.userCount %>, assistant: <%= s.assistantCount %>)
- Tool uses: <%= s.toolUseCount %>
<% Object.keys(s.toolsUsed).forEach(function(t) { %>  - <%= t %>: <%= s.toolsUsed[t] %>
<% }) %>
- Bash commands: <%= s.bashCommands %>
- Archivos editados: <%= s.filesEdited.length %>
<% s.filesEdited.slice(0,10).forEach(function(f) { %>  - <%= f %>
<% }) %>
- Branch durante la sesión: <%= s.gitBranch || "?" %>
- Sub-agentes spawneados: <%= s.hasSubagents ? "sí" : "no" %>
<% if (s.userIntent) { %>- User intent (primer msg): <%= s.userIntent %>
<% } %>
<% if (s.decisionSnippets && s.decisionSnippets.length > 0) { %>- Decision snippets (texto real de la sesión, citar al armar la sección Decisions):
<% s.decisionSnippets.forEach(function(snip) { %>  - <%= snip %>
<% }) %>
<% } %>
<% if (s.blockerSnippets && s.blockerSnippets.length > 0) { %>- Blocker snippets (texto real, citar al armar la sección Risks):
<% s.blockerSnippets.forEach(function(snip) { %>  - <%= snip %>
<% }) %>
<% } %>

<% }) %>
<% } %>

<% if (it.userEdits && it.userEdits.length > 0) { %>
# FEEDBACK DEL USUARIO EN PULSES ANTERIORES

El usuario editó manualmente los siguientes pulses pasados después de que vos los generaste. Cada bloque muestra las líneas QUITADAS (`-`) y AGREGADAS (`+`) por el usuario:

<% it.userEdits.forEach(function(e) { %>
## Pulse del <%= e.date %>

```diff
<%= e.diff %>
```

<% }) %>

**Cómo aplicar este feedback** (importante):
- Si el usuario REMOVIÓ una sección/callout/línea repetidamente → no la incluyas hoy.
- Si AGREGÓ wording específico (frases, formato, tono) → adoptá ese estilo en el output de hoy.
- Si REEMPLAZÓ contenido → seguí su patrón en casos similares.
- NO copies literalmente las líneas agregadas — capturá el patrón/estilo y aplicalo al contexto actual.
- Las ediciones son la verdad sobre qué quiere ver el usuario en sus pulses. Tu output anterior fue tentativo; el suyo es canónico.
<% } %>

<% if (it.anniversaryCallout) { %>
# ANIVERSARIO DEL PROYECTO HOY

Hoy es aniversario del proyecto **<%= it.project %>** — <%= it.anniversaryYears %> año(s) desde <%= it.anniversarySince %>.

**Aplicar al output**: inyectá ESTE callout entero como **primera sección visible después del frontmatter, antes del TL;DR**. Texto literal:

```
<%= it.anniversaryCallout %>
```

El callout va arriba del `## TL;DR` pero abajo del frontmatter. Mantenerlo literal — no parafrasees ni acortes. El día se siente distinto cuando hay aniversario; el TL;DR puede tocar brevemente que es un punto de inflexión simbólico, sin sobre-celebrar.
<% } %>

<% if (it.dayLastYear) { %>
# ESTE DÍA, EL AÑO PASADO

Hace exactamente un año (<%= it.dayLastYear.date %>) hubo pulse de <%= it.project %>. TL;DR de ese día:

```
<%= it.dayLastYear.tldr %>
```

**Aplicar al output**: agregá un callout reflexivo después del TL;DR de hoy:

```
> [!quote]- 📅 Este día, el año pasado
> <%= it.dayLastYear.tldr %>
> — [[<%= it.dayLastYear.pulseFilename %>|<%= it.dayLastYear.date %>]]
```

NO compares de forma forzada; el ancla es contextual, no narrativa. Si la conexión con el día de hoy es real y útil, dejá que el TL;DR la mencione en una línea — si no, el callout solo cumple su rol de memoria pasiva.
<% } %>

<% if (it.activeTracks && it.activeTracks.length > 0) { %>
# TRACKS CONOCIDOS DE ESTE PROYECTO

El proyecto **<%= it.project %>** ya tiene los siguientes tracks materializados en `MOCs/Tracks/`. **Si el trabajo de hoy contribuye a alguno**, etiquetalo en el frontmatter `tracks: [slug1, slug2]` (lista vacía si nada aplica):

<% it.activeTracks.forEach(function(t) { %>- **<%= t.slug %>** — <%= t.emoji %> <%= t.name %> · estado: <%= t.status %>
<% }) %>

Reglas:
- Solo etiquetar tracks que estén **claramente representados** en commits/sesiones/decisions de HOY.
- Si el trabajo no encaja en ningún track conocido pero forma un patrón nuevo, **NO inventes slugs** — eso lo va a capturar el próximo weekly rollup, y de ahí saldrá un track materializado nuevo.
- Tags `track/<slug>` se pueden agregar al campo `tags:` del frontmatter (ej. `tags: [pulse, pulse/<%= it.project %>, track/globex-checkout-moderno]`).
<% } %>

# INSTRUCCIONES DE OUTPUT

## Forma general

- Markdown **idiomático para Obsidian**: callouts, properties tipadas, wiki-links, dataview.
- **La voz** (arriba) manda. Cuando dudes entre prosa y bullets, releé la voz.
- Frontmatter YAML con properties tipadas (date type real, no string):

```yaml
---
date: <%= it.date %>
project: <%= it.project %>
status: on-track | some-drift | stuck | idle | inferring
commits: <%= it.commits.length %>
files_changed: <%= it.filesChanged.length %>
sessions_analyzed: <%= it.sessions.length %>
insertions: <%= it.insertions %>
deletions: <%= it.deletions %>
risks: <number — cuántos blockers/risks detectaste>
prompt_version: <%= it.promptVersion %>
tracks: [<lista de slugs de "TRACKS CONOCIDOS" arriba — vacío si nada aplica hoy>]
tags: [pulse, pulse/<%= it.project %>]   # opcional: agregar `track/<slug>` por cada track etiquetado
aliases: ["<%= it.project %> Pulse <%= it.date %>"]
---
```

- **status SIN emoji** en frontmatter (los emojis van en los callouts del cuerpo).
- Máximo 400 palabras totales (sin contar frontmatter, dataview, ni Raw activity colapsada). La prosa densa cabe en menos palabras que las listas fragmentadas.
- Sin preámbulo. Output empieza con `---`. Sin cierre — termina con el ```` ``` ```` del bloque dataview.
- No incluyas este prompt ni partes de él en el output.
- **CRÍTICO**: NO uses ninguna tool (Write, Edit, Bash, Read, etc.). NO escribas el archivo vos mismo. SOLO devolvé el markdown del pulse como **respuesta de texto plana**. El sistema que te invoca se encarga de escribirlo. Si usás Write/Edit, el archivo va a quedar corrompido.

## Lógica de `status` (elegir uno)

- `idle` — no hubo commits NI sesiones. Pulse de una línea, omitir secciones 2-9.
- `inferring` — no hay STRATEGY.md NI _roadmap.md (ambos vacíos/ausentes). Generá DRAFT de roadmap inferido en sección 4.
- `stuck` — detectaste blocker crítico (test fallando, deploy roto, sesión larga sin progreso real).
- `some-drift` — hay drift fuerte entre lo que dice docs/roadmap y lo que muestra el código.
- `on-track` — resto de los casos cuando hay actividad real.

## Secciones (callouts en este orden)

### 1. TL;DR (siempre — heading H2 + callout)

Importante: el TL;DR debe ser un heading `## TL;DR` con el callout DEBAJO. Esto es para que el daily consolidado pueda embedirlo con `![[YYYY-MM-DD--<project>#TL;DR]]` (embeds por heading sí funcionan, por callout solo no).

**Forma**: un párrafo de 2-3 oraciones que narra el día. NO bullets. NO "Línea 1: ... Línea 2: ...". El narrador conecta qué se logró y dónde queda el proyecto al cierre del día.

```
## TL;DR

> [!summary]+
> El día se centró en <qué dominó>. <Qué pasó concretamente, con evidencia>. Al cierre, <dónde queda el proyecto / qué sigue siendo el siguiente paso>.
```

### 2. Shipped (omitir el callout si no hay nada)

Lista de outcomes shipeados. Esta es una lista inherente — bullets OK, pero cada bullet es **denso** (no fragmentos):

```
> [!success] Shipped
> - <Outcome de producto descrito en una línea completa, no frase corta> — `<sha7>` ^commit-<sha7>
> - ...
```

Usá block IDs `^commit-<sha7>` para que el daily consolidado pueda citar el commit específico.

### 3. In flight (omitir si no hay nada)

Estado de lo que avanzó sin cerrar. **Prosa** si son 1-2 cosas; bullets densos si son más:

```
> [!info] In flight
> <Si es un solo tema:> Prosa de 1-2 oraciones describiendo qué está en curso y dónde está parado.
> <Si son varios:>
> - <tema> — <estado, ~N% si podés estimar>
```

No inventes %. Solo si podés inferirlo de commits parciales o sub-tasks declaradas.

### 4. Vs Roadmap / Strategy

**Caso A — hay roadmap y/o strategy:**

**Forma**: un párrafo que conecta el avance del día con los hitos del roadmap. NO una checklist mecánica de ✅/🚧/⏸️ — un párrafo narrativo que el lector pueda escanear. Si necesitás enumerar, hacelo después del párrafo.

```
> [!check] Vs Roadmap
> <Párrafo de 2-4 oraciones: qué hito del roadmap avanzó, qué quedó en curso, qué empieza a acumular atraso. Si hay items "fuera de roadmap" que aparecieron, mencionalos al final del párrafo>.
```

**Strategy nag** (basado en `strategyStatus="<%= it.strategyStatus %>"`, `strategyDaysAsDraft=<%= it.strategyDaysAsDraft %>`):

<% if (it.strategyStatus === "filled") { %>STRATEGY.md está completo. Agregá ADICIONALMENTE el callout estratégico (prosa también):

```
> [!important] Vs Strategic North Star
> El trabajo del día <acerca / aleja> a la métrica clave **<nombre métrica>**, porque <razón concreta basada en commits/sesiones>. <Una línea más sobre alineación con el problem statement>.
```
<% } else if (it.strategyStatus === "draft" && it.strategyDaysAsDraft >= 7) { %>STRATEGY.md está como template hace **<%= it.strategyDaysAsDraft %> días** sin completar. **NAG MÁXIMO**: callout DANGER no-colapsable + Next 24h debe incluir "Completar STRATEGY.md":

```
> [!danger] STRATEGY.md sin completar hace <%= it.strategyDaysAsDraft %> días
> El sistema corre sin norte estratégico real. Sin problem/approach/métricas no hay forma de detectar drift contra objetivos.
> **Acción requerida**: completar `STRATEGY.md` del proyecto (eliminar `needs_review: true` del frontmatter).
> Considerá disparar `/ce-strategy` para definirlo con asistencia.
```
<% } else if (it.strategyStatus === "draft" && it.strategyDaysAsDraft >= 3) { %>STRATEGY.md está como template hace **<%= it.strategyDaysAsDraft %> días**. **NAG MEDIO**: callout WARNING visible (no colapsable):

```
> [!warning]+ STRATEGY.md aún como template (<%= it.strategyDaysAsDraft %> días)
> Sin completar, la sección "Vs Strategic North Star" no puede evaluarse. Llenar `STRATEGY.md` (problem/approach/métricas) — el template ya está en la bóveda.
```
<% } else if (it.strategyStatus === "draft") { %>STRATEGY.md es template reciente (<%= it.strategyDaysAsDraft %> días). Mencionar en una línea dentro de "Vs Roadmap" que está pendiente, sin callout separado.

<% } else { %>STRATEGY.md NO EXISTE. Callout WARNING colapsable:

```
> [!warning]- Sin STRATEGY.md
> Este proyecto no tiene archivo de strategy. La próxima corrida de `enrich-vault` va a crear un template. Ejecutá `bun run scripts/enrich-vault.ts <%= it.project %>` para generarlo ahora.
```
<% } %>

**Caso B — NO hay roadmap NI strategy (`status: inferring`):**

<% if (it.suppressRoadmapDraft) { %>
⚠️ **Flag activo: `suppressRoadmapDraft=true`**. Ya generaste drafts de roadmap en días anteriores sin que el usuario actuara. NO generes otro draft completo hoy — solo escribí UN callout corto:

```
> [!warning]- Sin roadmap activo
> Ya se generaron drafts previos sin acción. Ver pulse anterior o crear `_roadmap.md` manualmente.
```

Saltar las secciones "Objetivo inferido / Hitos inferidos / Backlog inferido" completas.
<% } else { %>
```
> [!warning]- 📋 Roadmap inferido (DRAFT — generado automáticamente)
>
> **Acción sugerida:** copiá este draft a `_roadmap.md` en la bóveda y editalo. Las próximas corridas lo van a respetar.
>
> ### Objetivo inferido
> (basado en README + commits + sesiones — un párrafo)
>
> ### Hitos inferidos (próximas 1-2 semanas)
> - [ ] <hito 1>
> - [ ] <hito 2>
>
> ### Backlog inferido
> - <item>
```

Reglas para el draft inferido:
- Basate **solo** en lo que ves en README, commits, sesiones, archivos clave (package.json scripts, estructura).
- No inventes objetivos sin respaldo en los datos.
- Marcá explícitamente cuándo una inferencia es débil ("inferido a partir de 2 commits — verificar").
<% } %>

### 5. Decisions (omitir si no hay)

**Forma**: bullets densos. Cada decisión completa en una línea (no fragmento). Contexto necesario incluido.

```
> [!quote] Decisions
> - [sesión <prefix-8>] <Descripción densa de la decisión, incluyendo el "por qué" si está en el snippet>. ^decision-1
> - **Modifica/revierte**: <decisión> — referencia a [[YYYY-MM-DD--<project>|YYYY-MM-DD]]
> - ...
```

PREFERIR los `decisionSnippets` que te paso por sesión — son texto real del flujo. Citalos resumidos (1 línea densa por decisión, contexto incluido). Si los snippets están vacíos o son débiles, podés sumar decisiones inferidas de commits con verbos claros (feat: que cambia approach, refactor: que reemplaza X por Y). Si los datos no permiten inferir decisiones reales: omitir el callout completo (no escribir "no detectadas").

**Promover a ADR**: si alguna decisión es de **alcance arquitectural o estratégico** (cambia el stack, redefine un contrato público, descarta un approach para siempre, fija una convención cross-proyecto), agregale `🏛️ ADR-candidate` al final del bullet. El usuario va a decidir si la promueve con `bun janus adr promote --pulse <%= it.date %>--<%= it.project %> --decision decision-N --title "..."`. NO promuevas decisiones operativas o tácticas (bumps, fixes puntuales, parches).

**Cross-references**: si una decisión de hoy modifica/revierte/contradice una decisión registrada en los pulses previos que te paso a continuación, marcalo como **Modifica/revierte** con wiki-link al pulse original.

<% if (it.previousDecisions && it.previousDecisions.length > 0) { %>Decisions de los últimos pulses para chequear si la decisión de hoy las modifica:
<% it.previousDecisions.forEach(function(p) { %>
- **[[<%= p.pulsePath %>|<%= p.date %>]]**:
<% p.text.split("\n").forEach(function(l) { %>  - <%= l %>
<% }) %>
<% }) %>
<% } else { %>(no hay decisions previas en la ventana de 7 días)
<% } %>

### 6. Risks / Blockers (omitir si nada)

```
> [!danger] Risks / Blockers
> - <Descripción densa del riesgo en una línea> — <evidencia: archivo, sesión, commit>
> - **Recurrente**: <riesgo> — apareció el [[YYYY-MM-DD--<project>|YYYY-MM-DD]]
```

PREFERIR los `blockerSnippets` que te paso por sesión — son texto real del flujo. Citalos resumidos. Si están vacíos, podés inferir por patrones:
- Muchos Bash o Edit repetidos sobre el mismo archivo en una sesión.
- Working tree sucio sin commit al cierre del día.
- Tests cuyo nombre aparece en commits pero coverage bajó.
- Sesión muy larga (>50 mensajes) sin commits asociados.

**Cross-references**: si un risk de hoy YA aparecía en los pulses anteriores que te paso a continuación, marcalo como **Recurrente** con wiki-link al pulse original (el más antiguo en el que aparezca).

<% if (it.previousRisks && it.previousRisks.length > 0) { %>Risks de los últimos pulses para chequear repetición:
<% it.previousRisks.forEach(function(p) { %>
- **[[<%= p.pulsePath %>|<%= p.date %>]]**:
<% p.text.split("\n").forEach(function(l) { %>  - <%= l %>
<% }) %>
<% }) %>
<% } else { %>(no hay pulses anteriores con risks en la ventana de 7 días)
<% } %>

### 7. Drift detectado (solo si aplica)

Solo escribir si detectás mismatch entre código y docs (README/CLAUDE.md/STRATEGY.md/_roadmap.md). Una línea por mismatch:

```
> [!warning] Drift detectado
> - <doc> dice X pero <commits/código> muestran Y
> - ...
```

Si no hay drift detectable, omitir el callout completo.

### 8. Next 24h (siempre, salvo status=idle)

Lista de tareas concretas — lista inherente, bullets OK:

```
> [!todo]+ Next 24h
> - [ ] Task concreta 📅 <YYYY-MM-DD> 🔼
> - [ ] Task 2 📅 <YYYY-MM-DD>
> - [ ] Task 3
```

Máximo 3 items. Basate en roadmap + in-flight + risks. Usá sintaxis del plugin Tasks: `📅` para due, `🔼`/`🔽` para priority. Si no hay due concreto, omitir el emoji de fecha.

### 9. Acciones compound (sugerencias condicionales — omitir el callout si no aplica ninguna)

```
> [!info]- 💡 Acciones sugeridas
> - Si detectaste un blocker crítico → corré `/ce-plan <descripción corta>` para desglosar el plan.
> - Si viste 3+ fixes en el mismo subdirectorio en sesiones recientes → corré `/ce-compound-refresh <area>` para consolidar learnings.
> - Si el drift es fuerte → corré `/ce-ideate <topic>` para explorar alternativas.
> - Si no hay roadmap → corré `/ce-strategy` para definir el norte.
```

Solo incluir los items que apliquen a este día específico. Si ninguno aplica → omitir el callout entero.

### 10. Related (siempre)

```
## Related
- Hub: [[<%= it.project %>]]
<% if (it.hasPreviousPulse) { %>- Pulse anterior: [[<%= it.previousPulseFilename %>]]
<% } else { %>- (sin pulse anterior en la bóveda — primer pulse del proyecto o gap)
<% } %>- MOCs: [[Decisions MOC]] · [[Risks MOC]] · [[Projects MOC]]
```

**Reglas duras del "Pulse anterior"**:
- Si `hasPreviousPulse=true`: usar **exactamente** `[[<%= it.previousPulseFilename %>]]` (no inventar fechas, no cambiar el formato). El sistema ya verificó que el archivo existe.
- Si `hasPreviousPulse=false`: NO generar wiki-link de día anterior. Escribir el mensaje "(sin pulse anterior…)".
- NUNCA generar `[[YYYY-MM-DD--<project>]]` con una fecha distinta a la del `previousPulseFilename` que te paso — eso produce link roto.

### 11. Raw activity (colapsable, siempre)

```
> [!info]- Raw activity
> - Commits:
>   - `<sha7>` <subject>
> - Files touched: <comma-separated, max 20>
> - Sessions: <count> · Bash: <total> · Edits: <total>
```

### 12. Dataview block (último, siempre)

````
```dataview
TABLE date, status, commits, risks, file.link AS Pulse
FROM "<%= it.vaultRelPath %>/pulse"
WHERE date >= date(today) - dur(7 days)
SORT date DESC
```
````

(Sí, escribir literalmente el bloque dataview en el output — Obsidian lo va a renderizar.)

## Reglas duras

1. **La voz manda**. Si dudás entre prosa y bullets, releé la sección "Voz de Janus" arriba.
2. Status `idle`: TL;DR de **una línea narrativa** ("Día sin actividad registrada en `<%= it.project %>`."), omitir secciones 2-9, Raw activity con todo en cero. Igual incluir frontmatter completo y Related + Dataview.
3. Status `inferring`: la sección 4 ES el roadmap draft. No incluir "Vs Roadmap" tradicional.
4. Properties en frontmatter: lowercase, snake_case, `status` sin emoji, valores planos.
5. SHAs entre backticks, no como links.
6. Block IDs `^commit-<sha7>` y `^decision-N` para todo lo citable desde el daily consolidado.
7. Wiki-links solo para `[[<%= it.project %>]]` y los pulses previos que TE PASO explícitamente (en `previousPulseFilename`, `previousRisks`, `previousDecisions`). NO inventes filenames de pulses.
8. Tasks plugin syntax en Next 24h cuando hay due dates.
9. No incluyas este prompt ni partes de él en el output.
10. No salgas del scope del proyecto <%= it.project %>.

## Output

Empezá DIRECTAMENTE con `---`. Sin "Aquí va tu reporte", sin "Espero que te sirva". El output ES el archivo final.
