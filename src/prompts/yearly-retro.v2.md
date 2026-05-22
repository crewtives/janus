<%= it.voice %>

---

# Tu tarea como narrador

Sos el editor que produce el **Yearly Retrospective** de **<%= it.year %>** consolidando los 4 quarterly retrospectives del año.

El output es la memoria institucional del año — material crudo del futuro **Janus Wrapped**. Usado para reviews anuales, planning del año siguiente, y consumido por agentes externos que necesitan contexto histórico de largo plazo. **El arco del año se cuenta en prosa**; los outcomes y decisiones se enumeran.

# CONTEXTO

Año: **<%= it.year %>** (<%= it.startDate %> → <%= it.endDate %>)
Proyectos trackeados al cierre: <%= it.projects.join(", ") %>

# QUARTERLY RETROS DEL AÑO

<% it.quarterlies.forEach(function(q) { %>
## <%= q.quarter %>

```
<%= q.content %>
```

<% }) %>

# INSTRUCCIONES DE OUTPUT

La **voz** (arriba) manda.

Frontmatter:

```yaml
---
type: yearly-retro
year: <%= it.year %>
period_start: <%= it.startDate %>
period_end: <%= it.endDate %>
tags: [yearly, yearly/<%= it.year %>]
aliases: ["Yearly <%= it.year %>"]
prompt_version: <%= it.promptVersion %>
quarters_covered: <%= it.quarterlies.length %>
---
```

- Máximo 1500 palabras.
- Empezá con `---`. Sin code fence envolvente. Sin tools.

## Secciones

### 1. TL;DR del año

**Forma**: párrafo de 5-8 oraciones que captura el año entero. NO bullets. Es el primer párrafo de la película.

```
> [!summary]+ <%= it.year %>
> <Párrafo narrativo: qué se construyó, qué cambió de Q1 a Q4, qué tracks dominaron, qué quedó abierto al cierre del año>.
```

### 2. Arco narrativo por trimestre

Pensar el año como 4 actos de una película. Cada Q es un párrafo que conecta con los otros — los 4 forman una historia continua.

```
## Arco del año

### Q1: <fase / nombre del acto>
<Párrafo de 2-3 oraciones resumiendo el Q1 como acto de la historia. Conectá con el cierre del año anterior si aplica>.

### Q2: <fase>
<Párrafo: cómo el Q2 retomó/pivoteó/escaló lo de Q1>.

### Q3: <fase>
<...>

### Q4: <fase>
<...>
```

### 3. Tracks del año

Los tracks que sobrevivieron varios trimestres o que definieron el año. **Vida del track** = párrafo narrativo, no bullets.

```
## Tracks dominantes del año

### 🔵 <Track>
- **Proyectos**: ...
- **Vida del track**: <Párrafo: nació en QN motivado por X, evolucionó en QM cuando…, estado al cierre del año>.
- **Trimestres de actividad**: [[2026-Q1]], [[2026-Q2]], ...
```

### 4. Top outcomes del año (10-15)

Los que un humano que vuelve después de 1 año necesita saber. Bullets densos:

```
> [!success] Top outcomes
> 1. **<área>** [<proyecto>] — <outcome + impacto en una línea densa> · [[<source>]]
```

### 5. Decisiones definitorias

Las que cambiaron el rumbo de la organización (no del proyecto). Bullets densos:

```
> [!quote] Decisiones definitorias
> - **<decisión>** [<proyecto>] — <contexto histórico en una línea>
```

### 6. Lessons learned

**Forma**: prosa, no bullets. 1-2 párrafos que destilan patrones observados durante el año (qué funcionó, qué no, qué se repitió).

```
> [!info] Lessons learned
> <Párrafo: patrones observados / aprendizajes destilados a lo largo del año. Conectalos con evidencia concreta>.
```

### 7. Métricas del año

```
| Métrica | Valor |
|---|---|
| Commits totales | X |
| Proyectos activos al cierre | X |
| Tracks completados | X |
| Tracks abandonados | X |
| Riesgos persistentes resueltos | X |
```

### 8. Foco del año siguiente

```
> [!todo]+ <%= parseInt(it.year) + 1 %>
> - [ ] <gran apuesta>
> - [ ] ...
```

### 9. Navegación

```
## Navegación

- ← [[<%= parseInt(it.year) - 1 %>-yearly|Año anterior]] · → [[<%= parseInt(it.year) + 1 %>-yearly|Año siguiente]]
- Quarterlies: [[<%= it.year %>-Q1]], [[<%= it.year %>-Q2]], [[<%= it.year %>-Q3]], [[<%= it.year %>-Q4]]
- MOCs: [[Tracks MOC]] · [[Projects MOC]]
```

## Reglas duras

1. **La voz manda**.
2. Pensar el año como arco narrativo, no como lista.
3. Citar evidencia con precisión (links a quarterlies/monthlies).
4. Output consumible por agentes para "qué hicimos este año en X" sin necesidad de releer todo.
5. NO uses tools. NO envuelvas en code fence.

## Output

Empezá con `---`.
