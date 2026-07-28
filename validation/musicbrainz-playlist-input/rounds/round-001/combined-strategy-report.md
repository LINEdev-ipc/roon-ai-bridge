# Round 001 — estrategias combinadas MusicBrainz + ListenBrainz

## Resultado

- Corpus: 60 propuestas.
- Referencias verificadas antes de esta prueba: 34.
- La búsqueda MusicBrainz por palabras recuperó 34/34 MBIDs de referencia.
- El ranking combinado colocó el MBID correcto primero en 32/34 referencias.
- Regla conservadora: score ≥ 150 y margen ≥ 20.
- Precisión observada de la aceptación automática sobre referencias: 100 %.
- Recall automático sobre referencias: 79.41 %.
- Recuperaciones nuevas revisadas y aceptadas: 4.
- Nuevo conjunto verificado: 38/60 (63.33 %).

## Estrategias de consulta MusicBrainz

| Estrategia | Cobertura del MBID correcto | Primer resultado nativo correcto |
|---|---:|---:|
| title_words_artist | 34/34 (100 %) | 12/34 (35.29 %) |
| alias_words_artist | 11/34 (32.35 %) | 8/34 (23.53 %) |
| title_words_artist_release | 28/34 (82.35 %) | 18/34 (52.94 %) |
| title_words_artist_year | 28/34 (82.35 %) | 11/34 (32.35 %) |
| fuzzy_title_alias_artist | 0/34 (0 %) | 0/34 (0 %) |

La búsqueda flexible aporta cobertura, pero el primer resultado nativo de
MusicBrainz no es una decisión fiable. El ranking debe comprobar título,
artista, álbum, año, versión, créditos, vídeo, disambiguación, duración,
tipo de release y evidencia de ListenBrainz.

## Recuperaciones nuevas

- PLI-002-009: `356361ed-c811-42b1-b0b5-fb8d473a6c2e` — Full non-fragment Maribou State remix with exact title/version and ISRC; the alternative candidate is explicitly part of a continuous DJ mix. The LLM year and album were incorrect.
- PLI-002-012: `ad486327-79c7-4f9e-b468-551fc9e6d072` — Exact What So Not remix, compatible RÜFÜS/RÜFÜS DU SOL artist alias, official release context, matching year and non-video recording.
- PLI-002-018: `b884f9b9-6a2b-4182-a259-8755a11b3914` — Exact New Voyager radio edit with Candi Staton credit, compatible release and year, ISRCs, non-video, and a 76-point margin over the duplicate candidate.
- PLI-003-016: `f4a822f1-66ae-4781-ae7f-0d5274ba519e` — MusicBrainz canonical title MALAMENTE (Cap.1: Augurio), exact artist, El mal querer release, matching year, ISRC and no competing candidate.

## Estrategia recomendada

1. Pedir al LLM título, artista principal, crédito completo, invitados, álbum,
   año, intención de grabación y nombre exacto de versión.
2. Consultar en paralelo ACR y ACRR de ListenBrainz como candidatos rápidos.
3. Consultar MusicBrainz con todas las palabras significativas del título,
   artista principal y `video:false`.
4. Buscar alias solo como ampliación. Usar álbum y año para puntuar, no como
   filtros obligatorios.
5. Agrupar por recording MBID y puntuar título, créditos, release, fecha,
   versión, duración, disambiguación y señales de ListenBrainz.
6. Rechazar vídeos, fragmentos de DJ mix, medleys y variantes incompatibles.
7. Aceptar automáticamente solo con score ≥ 150, margen
   ≥ 20 y compatibilidad dura.
8. En los demás casos, navegar por release group o conservar el resultado como
   ambiguo; nunca escoger el primero por score nativo.

## Coste de la investigación

- Búsquedas alternativas MusicBrainz: 265 peticiones en 661.88 s.
- ListenBrainz: 120 peticiones en 51.77 s, más 46 verificaciones MusicBrainz.

Este coste prueba varias estrategias por canción. La cascada recomendada no
debe ejecutar todas: una consulta MusicBrainz por palabras, ACR/ACRR y
fallbacks solo para casos de bajo margen.
