# Round 001 — experimento ListenBrainz

## Resultado

- Corpus: 60 propuestas.
- Tiempo completo, incluyendo verificación de MBIDs en MusicBrainz: 51.77 s.
- Mejora frente a la búsqueda progresiva original: 7.04×.
- Consultas: 120 a ListenBrainz Labs y 46 verificaciones a MusicBrainz.
- ListenBrainz devolvió un MBID en 36/60 casos.
- Acuerdo exacto con una identidad previa: 17/33.
- Recuperaciones nuevas aceptadas tras revisar MusicBrainz: 2.
- Casos que todavía requieren revisión humana o más evidencia: 7.
- Candidatos rechazados por ser otra versión, vídeo, directo o fragmento de DJ mix: 10.
- Sin resultado de ListenBrainz: 24.

## Lectura por estado anterior

| Estado anterior | Total | Devuelve candidato | Aceptado | Revisión | Rechazado | Sin resultado |
|---|---:|---:|---:|---:|---:|---:|
| Exacta | 33 | 24 | 17 acuerdos | 0 | 7 | 9 |
| Ambigua | 13 | 11 | 2 | 6 | 3 | 2 |
| No encontrada | 14 | 1 | 0 | 1 | 0 | 13 |

## Recuperaciones aceptadas

- Midnight City (Eric Prydz Private Remix) — M83: `168022f4-20d2-494f-a67e-a669a510f1e2`.
- Obsesión — Aventura: `fdb657f7-b82e-458e-9fa6-0969d5412c17`.

## Defecto previo descubierto

- PLI-003-006: The previous exact reference also needs review because its MusicBrainz artist credit includes Kanye West while the proposal did not.

## Casos revisados

| ID | Propuesta | Anterior | ListenBrainz | Revisión |
|---|---|---|---|---|
| PLI-001-005 | Champion Sound — Dubmatix | conflict | artist_recording_only | manual_review |
| PLI-001-013 | Smile Is the Key — Panda Dub | not_found | artist_recording_only | manual_review |
| PLI-002-001 | Missing (Todd Terry Club Mix) — Everything But the Girl | conflict | strategy_disagreement | manual_review |
| PLI-002-002 | Professional Widow (Armand's Star Trunk Funkin' Mix) — Tori Amos | conflict | artist_recording_only | manual_reject |
| PLI-002-003 | Brimful of Asha (Norman Cook Remix) — Cornershop | exact | artist_recording_only | manual_reject |
| PLI-002-006 | Born Slippy .NUXX — Underworld | conflict | strategy_disagreement | manual_review |
| PLI-002-009 | Reckoner (Maribou State Remix) — Radiohead | conflict | artist_recording_only | manual_reject |
| PLI-002-010 | Bloom (Jamie xx Rework Part 3) — Radiohead | conflict | artist_recording_only | manual_review |
| PLI-002-011 | Midnight City (Eric Prydz Private Remix) — M83 | conflict | artist_recording_only | manual_accept |
| PLI-003-002 | Obsesión — Aventura | conflict | agreement | manual_accept |
| PLI-003-003 | Dragostea din tei — O-Zone | conflict | artist_recording_only | manual_review |
| PLI-003-004 | Mas que nada — Sérgio Mendes | exact | artist_recording_only | manual_reject |
| PLI-003-005 | Boa sorte / Good Luck — Vanessa da Mata | exact | artist_recording_only | manual_reject |
| PLI-003-006 | Alors on danse — Stromae | exact | agreement | manual_reject |
| PLI-003-007 | Latinoamérica — Calle 13 | exact | artist_recording_only | manual_reject |
| PLI-003-008 | Zapata se queda — Lila Downs | exact | agreement | manual_reject |
| PLI-003-010 | Gangnam Style — PSY | conflict | artist_recording_only | manual_reject |
| PLI-003-011 | Bailando — Enrique Iglesias | conflict | agreement | manual_review |
| PLI-003-013 | Tú sí sabes quererme — Natalia Lafourcade | exact | artist_recording_only | manual_reject |

## Conclusión

ListenBrainz es útil como índice rápido y como señal de ranking, pero no como
resolutor definitivo. Reduce el tiempo de esta muestra aproximadamente siete
veces y propone candidatos para casi todos los conflictos, pero no recupera
los metadatos inventados por el LLM y puede escoger una versión incorrecta con
título y artista aparentemente perfectos.

La integración recomendable es:

1. Consultar ACRR (artista+canción+álbum) y ACR (artista+canción).
2. Si discrepan, conservar el caso como ambiguo.
3. Verificar el MBID en MusicBrainz y rechazar vídeos, directos, DJ mixes y
   variantes incompatibles.
4. Validar álbum, crédito completo y nombre de versión; no basta con artista
   principal y título.
5. Usar la búsqueda progresiva actual como fallback cuando ListenBrainz no
   devuelve resultado.
