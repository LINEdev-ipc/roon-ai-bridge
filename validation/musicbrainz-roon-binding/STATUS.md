# Estado de la validación MusicBrainz ↔ Roon

Fecha: 2026-07-27  
Estado: baseline final de 3000 completada  
Run dirigido: `20260727T191939Z`  
Regresión completa: `20260727T192441Z`

## Resultado final

La regresión completa terminó con:

- **3000/3000 decisiones seguras: 100 %**.
- 2896 asociaciones automáticas con un objeto reproducible de Roon.
- 83 fallbacks manuales investigados y documentados.
- 21 grabaciones de vídeo excluidas del binding de audio.
- 0 casos no resueltos.
- 0 errores de consulta.
- 1371,84 segundos de ejecución.

Las estrategias automáticas fueron:

- 2482 coincidencias mediante la escalera de consultas directas.
- 338 coincidencias reutilizando un release group verificado durante el run.
- 76 coincidencias mediante una lista de pistas de álbum verificada.

Un fallback manual cuenta como decisión segura porque conserva el sistema
manual existente cuando Roon no permite demostrar la grabación exacta. Nunca
se sustituye por una mezcla, edición, directo, cover o intérprete diferente.

## Investigación de los 79 conflictos

La repetición dirigida procesó únicamente los 79 conflictos del primer run:

- **79/79 pasaron**.
- 21 se convirtieron en asociaciones automáticas.
- 58 quedaron como fallback manual con evidencia agrupada y case IDs
  explícitos.
- 0 no resueltos.
- 0 errores de consulta.

Las correcciones automáticas cubren:

- Mezclas de *Syro* nombradas entre paréntesis o corchetes.
- La etiqueta genérica `Album Version`.
- El prefijo `Medley:` en un título compuesto.
- Títulos que identifican explícitamente `MTV Unplugged`.
- Sesiones KCRW de Nouvelle Vague.
- El crédito de Roon `f` para el grupo `f(x)`.
- `The Carioca` frente a `Carioca (The Carioca)`.
- Pistas repetidas `Rap` de Curtis Mayfield, distinguidas mediante el ordinal
  derivado de MusicBrainz.
- Equivalencias localizadas como `Ao vivo` y `Acústico`.
- `Hello! MTV Unplugged` frente al título editorial reducido `Unplugged`,
  únicamente con forma y posición de release verificadas.

La investigación completa y sus consultas representativas están en
`artifacts/probes/20260727-3000-conflict-research.md`.

## Regresión de los primeros 1500

Los casos `MBR-000001`–`MBR-001500` conservaron su contenido y vuelven a
obtener **1500/1500 decisiones seguras**:

- 1468 asociaciones automáticas.
- 25 fallbacks manuales.
- 7 vídeos.
- 0 no resueltos.
- 0 errores.

No hay regresiones respecto al baseline anterior. Una antigua excepción manual
ahora se resuelve automáticamente.

## Diversidad de la ampliación

Los nuevos `MBR-001501`–`MBR-003000` contienen:

- 289 release groups.
- 246 artistas.
- 19 cohortes.
- 12 grupos de idioma.
- Nueve periodos: ocho décadas desde 1950 y un grupo mixto.
- 780 canciones normales.
- 140 directos.
- 150 pistas procedentes de proyectos de remix.
- 170 covers.
- 130 acústicos.
- 130 grabaciones alternativas o de archivo.

El selector limita el corpus total a diez casos por release group y veinte por
artista al crecer a 3000. Las primeras 1500 filas permanecen inmutables aunque
ya superasen alguno de esos límites.

La caché persistente contiene 841 respuestas de MusicBrainz y se reutilizará
en futuras ampliaciones.

## Artefactos

- Corpus: `artifacts/corpus/cases.jsonl`.
- Contexto MusicBrainz: `artifacts/corpus/binding-context.jsonl`.
- Fallbacks manuales:
  `artifacts/corpus/manual-fallback-expectations.json`.
- Instantánea previa:
  `artifacts/corpus/snapshots/cases-1500-before-3000.jsonl`.
- Auditoría de diversidad:
  `artifacts/corpus/build-3000-audit.json`.
- Investigación dirigida:
  `artifacts/probes/20260727-3000-conflict-research.md`.
- Run dirigido final:
  `artifacts/targeted-runs/20260727T191939Z/`.
- Regresión completa final:
  `artifacts/enhanced-runs/20260727T192441Z/`.
- Caché MusicBrainz: `artifacts/cache/musicbrainz/`.

No se modificó la aplicación desplegada, no se reprodujo música, no se
reinició el servicio y no hubo despliegue.
