# Round 002 — simulación de la cascada real

## Primera pasada

| Playlist | Aceptadas | Candidatas | Rechazadas | Sin resultado | Tiempo |
|---|---:|---:|---:|---:|---:|
| SIM-001 | 19 | 1 | 0 | 0 | 30.19 s |
| SIM-002 | 13 | 3 | 1 | 3 | 30.63 s |
| SIM-003 | 17 | 3 | 0 | 0 | 37.37 s |

## Resultado por playlist

| Playlist | Procesadas/objetivo | Alcanzadas | Candidatas | Rechazadas | Fallback | Tiempo total | Media/canción |
|---|---:|---:|---:|---:|---:|---:|---:|
| SIM-001 | 20/20 | 20 (100 %) | 0 | 0 | 9 s | 39.19 s | 1.96 s |
| SIM-002 | 20/20 | 15 (75 %) | 3 | 2 | 49.07 s | 79.7 s | 3.99 s |
| SIM-003 | 20/20 | 18 (90 %) | 2 | 0 | 6.63 s | 44 s | 2.2 s |

Total: 53/60 aceptadas automáticamente
(88.33 %) en 162.89 s.

## Contraste con referencias anteriores

La misma regla conservadora se volvió a ejecutar sobre
34 identidades verificadas:
27/27
aceptaciones correctas, precisión observada
100 % y recall
79.41 %.

La simulación ejecuta por canción una búsqueda MusicBrainz por palabras del
título y artista, ACR y ACRR de ListenBrainz en paralelo, verificación en
MusicBrainz de los MBID adicionales, ranking combinado y la regla conservadora
score ≥ 150, margen ≥ 20.

Las canciones con estado `candidate` no se pierden: tienen una coincidencia
compatible, pero no alcanzan margen suficiente para aceptación automática.

## Hallazgos

- Los MBID duplicados de la misma identidad deben agruparse antes de calcular
  el margen. Se consideran equivalentes solo con título/versión compatibles y
  el mismo ISRC o una duración con diferencia máxima de 15 segundos.
- Álbum y año mejoran el ranking, pero siguen sin ser filtros obligatorios.
- Los vocalistas propuestos pueden no aparecer en el artist credit de la
  grabación MusicBrainz; su ausencia reduce confianza, pero no demuestra una
  incompatibilidad.
- Un remixer puede estar codificado en el artist credit aunque no aparezca en
  el título canónico de la grabación.
- La lista de versiones exactas concentra todos los fallos y consume 49.07 s
  de fallback para recuperar solo dos aceptaciones adicionales. Este fallback
  debe navegar por pistas de releases y ejecutarse únicamente cuando la
  versión propuesta sea verificable.
