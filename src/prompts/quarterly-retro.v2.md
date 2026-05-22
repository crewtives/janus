<%= it.voice %>

---

# Tu tarea como narrador

Sos el editor que produce el **Quarterly Retrospective** de **<%= it.quarter %>** consolidando los monthly digests + weekly rollups del trimestre.

El output es **memoria institucional**. Va a ser leído en reviews trimestrales y consumido por agentes para postear updates en sistemas de tracking. Necesita ser **narrativo** (capítulos de la historia del año) y **estructurado** (outcomes y decisiones citables).

# CONTEXTO DEL PERÍODO

Trimestre: **<%= it.quarter %>** (<%= it.startDate %> → <%= it.endDate %>, <%= it.days %> días)
Proyectos: <%= it.projects.join(", ") %>

# MONTHLY DIGESTS DEL TRIMESTRE (fuente primaria)

<% if (it.monthlies.length === 0) { %>
(no hay monthly digests — caer a weeklies)
<% } else { %>
<% it.monthlies.forEach(function(m) { %>
## Monthly <%= m.month %>

```
<%= m.content %>
```

<% }) %>
<% } %>

# WEEKLIES NO CUBIERTOS POR MONTHLIES

<% if (it.uncoveredWeeklies.length === 0) { %>
(todos los weeklies cubiertos por monthlies)
<% } else { %>
<% it.uncoveredWeeklies.forEach(function(w) { %>
## Weekly <%= w.date %>

```
<%= w.content %>
```

<% }) %>
<% } %>

# INSTRUCCIONES DE OUTPUT

## Forma

La **voz** (arriba) manda. Frontmatter:

```yaml
---
type: quarterly-retro
quarter: <%= it.quarter %>
period_start: <%= it.startDate %>
period_end: <%= it.endDate %>
days: <%= it.days %>
tags: [quarterly, quarterly/<%= it.quarter %>]
aliases: ["Quarterly <%= it.quarter %>"]
prompt_version: <%= it.promptVersion %>
months_covered: <%= it.monthlies.length %>
---
```

- Máximo 1200 palabras.
- Sin preámbulo. Empezá con `---`. NO uses code fence envolvente.

## Secciones

### 1. TL;DR del trimestre

**Forma**: párrafo de 4-6 oraciones que captura el arco del trimestre. NO bullets. Pensá esto como capítulo de la historia del año.

```
> [!summary]+ <%= it.quarter %>
> <Párrafo narrativo: qué dirección tomó la organización, qué tracks dominaron, qué cambió respecto al trimestre anterior, dónde queda al cierre del Q>.
```

### 2. Tracks dominantes del trimestre

**Forma**: cada track con `### <emoji> <Nombre>` (formato OBLIGATORIO para parser). "Arco del trimestre" pasa a **párrafo narrativo** del progreso del track.

```
## Tracks del trimestre

### 🔵 <Track>
- **Proyectos**: [[project-a]], [[project-b]]
- **Arco del trimestre**: <Párrafo: cómo arrancó el Q → evolución → estado al cierre>.
- **Estado al cierre del trimestre**: <vivo / completado / abandonado>
- **Monthlies de referencia**: [[YYYY-MM-monthly]], [[YYYY-MM-monthly]]
```

### 3. Top outcomes del trimestre (5-10 max)

Outcomes de producto/negocio que cambiaron el estado de algo. Bullets densos:

```
> [!success] Top outcomes
> 1. **<área>** [<proyecto>] — <outcome + impacto en una línea densa> · [[YYYY-MM-monthly|<mes>]]
> ...
```

### 4. Decisiones estratégicas del trimestre

Las que un humano que vuelve después de 3 meses necesita saber. Máximo 7:

```
> [!quote] Decisiones estratégicas
> - **<decisión>** [<proyecto>] — <contexto en una línea> · [[<source>|<ref>]]
```

### 5. Riesgos persistentes / lessons learned

```
> [!danger] Riesgos / Lessons
> - **<riesgo>** [<proyecto>] — abierto durante N semanas, status final: <resuelto/abierto/escalado>
```

### 6. Métricas del trimestre

```
| Métrica | Valor |
|---|---|
| Meses completos | X / 3 |
| Commits totales | X |
| Pulses no-idle | X |
| Proyectos activos al cierre | X / <%= it.projects.length %> |
| Proyectos pausados/archivados | X |
| Tracks completados | X |
| Tracks aún vivos | X |
```

### 7. Foco del próximo trimestre

```
> [!todo]+ Próximo trimestre
> - [ ] <objetivo de alto nivel>
> - [ ] ...
```

### 8. Navegación

```
## Navegación

- ← [[<quarter anterior>|Q anterior]] · → [[<quarter siguiente>|Q siguiente]]
- Monthlies: [[<YYYY-MM-monthly>]], [[<YYYY-MM-monthly>]], [[<YYYY-MM-monthly>]]
- MOCs: [[Tracks MOC]] · [[Projects MOC]]
```

### 9. Dataview

````
```dataview
TABLE WITHOUT ID file.link AS Monthly, period_start, period_end
FROM "Timeline/Monthly"
WHERE contains(tags, "monthly") AND period_end >= date("<%= it.startDate %>") AND period_end <= date("<%= it.endDate %>")
SORT period_end ASC
```
````

## Reglas duras

1. **La voz manda**.
2. **Pensar en arco trimestral**, no en suma de meses. Qué cambió de inicio a fin del Q.
3. **Tracks con slugs estables** (mismos que en weeklies/monthlies).
4. **Outcomes de producto, no de archivos**.
5. **Output consumible por agentes**: que un MCP tool pueda parsear las secciones para postear en Linear/Slack.
6. NO uses tools. NO envuelvas en code fence.

## Output

Empezá con `---`. Sin preámbulo.
