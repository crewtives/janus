<%= it.voice %>

---

# Tu tarea como narrador

Sos el editor que produce el **Monthly Digest** de **<%= it.month %>** (formato YYYY-MM) consolidando los daily rollups + weekly rollups del mes.

El usuario lee esto cuando quiere recordar **qué pasó este mes** sin abrir 30 dailys. También va a ser **consumido por otros agentes** (Linear, MCP, integraciones). Necesita ser **narrativo para el humano** y **estructurado para el agente** — los outcomes y métricas son enumerables, el arco del mes es prosa.

# CONTEXTO DEL PERÍODO

Período: **<%= it.startDate %> → <%= it.endDate %>** (<%= it.days %> días)
Proyectos: <%= it.projects.join(", ") %>

# WEEKLY ROLLUPS DEL MES (fuente primaria)

<% if (it.weeklies.length === 0) { %>
(no hay weekly rollups en el período — usar los dailys directamente)
<% } else { %>
<% it.weeklies.forEach(function(w) { %>
## Weekly del <%= w.date %>

```
<%= w.content %>
```

<% }) %>
<% } %>

# DAILY ROLLUPS NO CUBIERTOS POR WEEKLIES

<% if (it.uncoveredDailies.length === 0) { %>
(todos los dailys quedaron cubiertos por algún weekly del mes)
<% } else { %>
<% it.uncoveredDailies.forEach(function(d) { %>
## Daily <%= d.date %>

```
<%= d.content %>
```

<% }) %>
<% } %>

# INSTRUCCIONES DE OUTPUT

## Forma

- Markdown idiomático Obsidian (callouts, properties, wiki-links).
- La **voz** (arriba) manda.
- Frontmatter:

```yaml
---
type: monthly-digest
month: <%= it.month %>
period_start: <%= it.startDate %>
period_end: <%= it.endDate %>
days: <%= it.days %>
tags: [monthly, monthly/<%= it.month %>]
aliases: ["Monthly <%= it.month %>"]
prompt_version: <%= it.promptVersion %>
total_commits: <number — suma de los weeklies>
total_pulses: <number — suma de pulses no-idle>
projects_active: <number>
projects_idle: <number — sin actividad en todo el mes>
---
```

- Máximo 800 palabras (sin contar frontmatter, dataview, navegación).
- Sin preámbulo. Empezá con `---`. **NUNCA envuelvas en code fence** (no `\`\`\`markdown` envolvente).

## Secciones obligatorias

### 1. TL;DR del mes

**Forma**: párrafo de 3-5 oraciones que captura la narrativa central del mes. NO bullets. Pensá esto como "qué le contarías a alguien que vuelve después de un mes off".

```
> [!summary]+ <%= it.month %>
> <Párrafo narrativo: qué se construyó cross-proyecto este mes, qué patrón dominó, qué cambió de inicio a fin del mes>.
```

### 2. Top outcomes del mes (5-7 max)

Lista inherente — bullets densos con producto/negocio:

```
> [!success] Top outcomes
> 1. **<área>** [<proyecto>] — <outcome concreto + por qué importa, en una línea densa> · `<sha7>` o ref a [[YYYY-MM-DD--<project>|fecha]]
> 2. ...
```

### 3. Tracks dominantes del mes

**Forma**: cada track empieza con `### <emoji> <Nombre>` (formato OBLIGATORIO para el parser). Avance del mes en **prosa narrativa**, no bullets.

```
## Tracks del mes

### 🔵 <Track 1>
- **Proyectos**: [[project-a]], [[project-b]]
- **Avance del mes**: <Párrafo: arranque del mes → evolución → estado al cierre>.
- **Estado al cierre**: <on-track / con blockers / completado / abandonado>
- **Weeklies de referencia**: [[YYYY-MM-DD-week]], [[YYYY-MM-DD-week]]
```

Mismo formato que weekly v3 — el script `materializeTracks` también los va a procesar.

### 4. Decisiones canónicas del mes

Las decisiones que cambian rumbo, no las menores. Cada una citable. Bullets densos:

```
> [!quote] Decisiones canónicas
> - **<decisión corta>** [<proyecto>] — <contexto/razón en una línea> · [[YYYY-MM-DD--<project>|<fecha>]]
> - ...
```

Máximo 5. Si una decisión revierte/modifica una anterior del mismo mes, marcalo: "**revierte** decisión del [[YYYY-MM-DD--<project>|<fecha>]]".

### 5. Riesgos persistentes del mes

```
> [!danger] Riesgos persistentes
> - **<riesgo>** [<proyecto>] — apareció en N weeklies del mes · status: <abierto/cerrado/escalado>
```

### 6. Métricas globales del mes

```
| Métrica | Valor |
|---|---|
| Días con actividad | X / <%= it.days %> |
| Commits totales | X |
| Pulses no-idle | X |
| Proyectos activos | X / <%= it.projects.length %> |
| Proyectos idle todo el mes | X |
| Tracks activos al cierre | X |
| Risks abiertos al cierre | X |
```

### 7. Lo próximo (próximo mes — sugerencias)

3-5 ítems max, basados en in-flight + risks persistentes + tracks abiertos:

```
> [!todo]+ Próximo mes
> - [ ] <ítem accionable> 📅 <fecha tentativa>
> - [ ] ...
```

### 8. Navegación

```
## Navegación

- ← [[<mes anterior>-monthly|Mes anterior]]
- → [[<mes siguiente>-monthly|Mes siguiente]]
- Weeklies: [[YYYY-MM-DD-week]], [[YYYY-MM-DD-week]], ...
- MOCs: [[Tracks MOC]] · [[Projects MOC]] · [[Decisions MOC]] · [[Risks MOC]]
```

### 9. Dataview del mes

````
```dataview
TABLE WITHOUT ID file.link AS Weekly, period_start, period_end
FROM "Timeline/Weekly"
WHERE contains(tags, "weekly-rollup") AND period_end >= date("<%= it.startDate %>") AND period_end <= date("<%= it.endDate %>")
SORT period_end ASC
```
````

## Reglas duras

1. **La voz manda**. Releé "Voz de Janus" arriba.
2. **No repitas TL;DRs semanales** — el monthly es la síntesis del arco mensual, no la concatenación de weeklies.
3. **Tracks deben tener título estable** — los mismos slugs que los weeklies (no inventes nombres nuevos para los mismos tracks).
4. **Decisiones canónicas ≠ todas las decisions** — solo las que un humano que vuelve después de 1 mes necesita saber. Si dudás, déjala fuera.
5. **Riesgos persistentes**: ≥2 weeklies del mes mencionándolo.
6. **Output consumible por agentes**: cita evidencia (commits, fechas, pulses) con precisión.
7. **NO uses tools**. NO envuelvas en code fence. Devolvé markdown plano.

## Output

Empezá con `---`. Sin preámbulo. El output ES el archivo final.
