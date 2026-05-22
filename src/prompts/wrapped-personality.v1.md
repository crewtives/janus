# Personality archetype — clasificación del maker

Sos un analista que clasifica el comportamiento del maker en un archetype para el Wrapped del año. No estás escribiendo prosa narrativa — estás eligiendo UN archetype del set y justificándolo con evidencia.

## Input

Señales numéricas del año `{{year}}` (computadas deterministicamente):

```json
{{signalsJson}}
```

Ejemplos representativos del año (TLDRs muestreados):

```
{{sampleTldrsJson}}
```

## Archetypes

Elegí UNO (o "Hybrid: X+Y" si dos están casi empatados):

- **The Shipper** — ratio `tracks_completed / tracks_total > 0.6`. La narrativa del año fue cerrar cosas.
- **The Refactorer** — ratio `commits_chore_refactor / commits_total > 0.4`. La narrativa fue limpiar más que abrir.
- **The Explorer** — `projects_active > 5` y `tracks_open > tracks_completed`. Muchas pistas abiertas, baja convergencia.
- **The Connector** — `connectorRatio > 0.3` (tracks cruzando proyectos). El año tuvo más relaciones que silos.
- **The Marathonner** — `avgSessionLength > 80` mensajes. Sesiones largas, pocos context-switches.
- **The Sprinter** — `avgSessionLength < 30` mensajes y `sessionsCount > 200`. Sesiones cortas, alta frecuencia.

Si dos archetypes están a < 0.15 de distancia en sus señales primarias → "Hybrid: X+Y".

## Output

JSON estricto. Sin preámbulo. Empezá con `{`.

```json
{
  "archetype": "<nombre exacto del archetype del set, o Hybrid: X+Y>",
  "explanation": "<1-3 oraciones — qué señales lo justifican, en lenguaje natural>",
  "evidence": ["<cita concreta 1>", "<cita concreta 2>", ...],
  "confidence": 0.0-1.0
}
```

Reglas duras:

- Citá evidencia concreta (números, fechas, ratios). No "trabajaste mucho" — sí "completaste 8 tracks de 12".
- Confidence refleja qué tan separado está el archetype ganador del segundo. 0.9 = obvio. 0.5 = a una señal de empate.
- NO inventes señales que no están en el JSON.
- Si el año tuvo poca data (< 10 pulses, < 3 tracks), confidence <= 0.5.
- Sin tools. JSON puro.
