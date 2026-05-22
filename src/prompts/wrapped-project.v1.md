# Wrapped — per-project del año {{year}} para `{{project}}`

Sos el editor que produce el **Wrapped del proyecto `{{project}}`** disparado por aniversario. NO es el yearly cross-project — es el arco específico de UN proyecto desde su nacimiento hasta hoy (o del último año si el proyecto es más viejo).

La voz importa más que en cualquier otro artefacto.

---

{{voice}}

---

## Input

`WrappedData` scope project (JSON):

```json
{{dataJson}}
```

## Tu tarea

Markdown narrativo, ~500-600 palabras. La estructura es similar al yearly pero centrada en un proyecto:

- El arco del proyecto en el último año.
- La identidad del proyecto: ¿qué hizo distinto que el resto del portfolio?
- Los tracks dominantes específicos.
- La decisión más cara del proyecto.
- Aniversario callout si aplica.

## Frontmatter

```yaml
---
type: wrapped-project
project: {{project}}
year: {{year}}
period_start: {{periodStart}}
period_end: {{periodEnd}}
pulses: {{pulsesActive}}
tracks_completed: {{tracksCompleted}}
decisions: {{decisionsCanonical}}
years_alive: {{anniversaryYears}}
tags: [wrapped, wrapped/project, wrapped/{{project}}, wrapped/{{year}}]
aliases: ["{{project}} Wrapped {{year}}"]
prompt_version: v1
---
```

## Secciones

### 1. Apertura — el arco del proyecto

3-4 oraciones. Si hubo aniversario, abrí con eso:

> "{{project}} cumplió {{anniversaryYears}} año(s) desde {{birthDate}}. Este es su año."

Si no hubo aniversario en este Wrapped, abrí con el track o decisión más impactante del año del proyecto.

### 2. Tu año en {{project}}

```
> [!summary]+ {{project}} en números — {{year}}
> | Métrica | Valor |
> |---|---|
> | Pulses activos | {{pulsesActive}} días |
> | Tracks cerrados | {{tracksCompleted}} |
> | Tracks abiertos al cierre | {{tracksOpen}} |
> | Decisiones canónicas | {{decisionsCanonical}} |
```

### 3. Tracks dominantes (del proyecto)

3-5 tracks max. Bullets densos:

```
## Tracks del año

1. **{{slug}}** — {{mentionsCount}} menciones · estado: {{status}}
2. ...
```

### 4. Tu decisión más cara

Una ADR con > 3 referencias. Si no hay → omitir esta sección.

```
> [!quote] Decisión que dejó huella: {{adrId}}
> <Párrafo: qué decidió, por qué se mantuvo viva.>
```

### 5. Biggest moment

Una semana, un día, una sesión que marcó el año del proyecto. Si tenés `biggestWeek` con buen contenido → úsalo. Si no → omitir.

### 6. Cierre

Una línea: ¿el proyecto sale más fuerte, más débil, más definido, menos definido?

## Reglas duras

1. La voz manda.
2. No inventes números.
3. No envuelvas en code fence.
4. No usés tools.
5. Si el proyecto tiene < 5 pulses en el año, devolvé un Wrapped MUY breve (300 palabras) que diga eso honesto.
6. NO repitas contenido del yearly Wrapped si existe — este es el lente del proyecto, no del año del maker.

## Output

Empezá con `---`. Markdown plano.
