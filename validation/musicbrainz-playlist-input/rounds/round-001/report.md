# Round 001 — LLM → MusicBrainz

## Resultado

- Propuestas: 60.
- Identidad exacta con la búsqueda progresiva: 29 (48.33 %).
- Identidades adicionales recuperadas navegando primero por álbum: 4.
- Identidad exacta combinada: 33 (55 %).
- Varias grabaciones compatibles sin resolver: 13.
- Sin candidato compatible: 14.
- Errores de proveedor después de la repetición dirigida: 0.
- Tiempo de la búsqueda progresiva y sus reintentos: 364.25 s.
- Tiempo del experimento adicional por álbum: 149.46 s.
- Tiempo total de investigación: 513.71 s.
- Consultas efectivas al proveedor: 238 (183 progresivas y 55 del experimento por álbum).

MusicBrainz contiene al menos un candidato compatible para el 76.67 % de las propuestas, pero el sistema solo demuestra una identidad única en el 55 %. El resultado todavía no es suficiente para producción.

## Aportación de los campos y estrategias

- Título + artista principal bastaron en 14 casos.
- Añadir álbum a la búsqueda progresiva resolvió otros 15 casos.
- Navegar primero por un release group de álbum verificado recuperó 4 conflictos adicionales.
- El crédito completo con «feat.» no recuperó ningún caso adicional.
- Entre las identidades exactas combinadas, el álbum propuesto coincidió con el canónico en 27/33 casos (81.82 %).
- El año propuesto fue exacto en 21/31 casos comparables y quedó a ±1 año en 27/31.

## Resultado por prompt

| Prompt | Exactas iniciales | Exactas combinadas | Ambiguas | No encontradas | Artistas principales repetidos |
|---|---:|---:|---:|---:|---|
| PLI-001 | 10 | 10 | 1 | 9 | ninguno |
| PLI-002 | 9 | 9 | 8 | 3 | radiohead, bicep |
| PLI-003 | 10 | 14 | 4 | 2 | ninguno |

## Casos

### PLI-001

| ID | Canción | Artista | Resultado | Estrategia |
|---|---|---|---|---|
| PLI-001-001 | The Fat Panther | Prince Fatty | exact | title_primary_artist |
| PLI-001-002 | Boxes and Amps | Zion Train | exact | title_primary_artist |
| PLI-001-003 | Don't Stop Dub | Kanka | not_found | — |
| PLI-001-004 | Azmari Dub | Dub Colossus | exact | title_primary_artist_album |
| PLI-001-005 | Champion Sound | Dubmatix | conflict | — |
| PLI-001-006 | Victory | Dubkasm | exact | title_primary_artist |
| PLI-001-007 | Strong Dub | Radikal Guru | exact | title_primary_artist |
| PLI-001-008 | Computer Age | Mungo's Hi Fi | exact | title_primary_artist_album |
| PLI-001-009 | Rooted and Grounded | Alpha Steppa | not_found | — |
| PLI-001-010 | The Big Tree | Stand High Patrol | exact | title_primary_artist |
| PLI-001-011 | Sixteen Tons of Pressure | O.B.F | exact | title_primary_artist |
| PLI-001-012 | Walk the Walk | Brain Damage | exact | title_primary_artist |
| PLI-001-013 | Smile Is the Key | Panda Dub | not_found | — |
| PLI-001-014 | Digital Robot | Manudigital | exact | title_primary_artist |
| PLI-001-015 | Dub Controler | Dreadsquad | not_found | — |
| PLI-001-016 | Dub Parade | High Tone | not_found | — |
| PLI-001-017 | Human Nature | Dub Spencer & Trance Hill | not_found | — |
| PLI-001-018 | Babylon Is Falling | Vibronics | not_found | — |
| PLI-001-019 | Elephant Dub | Tetra Hydro K | not_found | — |
| PLI-001-020 | Life Is a Heavy Burden | Creation Rebel | not_found | — |

### PLI-002

| ID | Canción | Artista | Resultado | Estrategia |
|---|---|---|---|---|
| PLI-002-001 | Missing (Todd Terry Club Mix) | Everything But the Girl | conflict | — |
| PLI-002-002 | Professional Widow (Armand's Star Trunk Funkin' Mix) | Tori Amos | conflict | — |
| PLI-002-003 | Brimful of Asha (Norman Cook Remix) | Cornershop | exact | title_primary_artist_album |
| PLI-002-004 | Sing It Back (Boris Musical Mix) | Moloko | exact | title_primary_artist_album |
| PLI-002-005 | Go (Woodtick Mix) | Moby | exact | title_primary_artist_album |
| PLI-002-006 | Born Slippy .NUXX | Underworld | conflict | — |
| PLI-002-007 | Teardrop (Mazaruni Dub One) | Massive Attack | conflict | — |
| PLI-002-008 | Walking on a Dream (RAC Mix) | Empire of the Sun | exact | title_primary_artist |
| PLI-002-009 | Reckoner (Maribou State Remix) | Radiohead | conflict | — |
| PLI-002-010 | Bloom (Jamie xx Rework Part 3) | Radiohead | conflict | — |
| PLI-002-011 | Midnight City (Eric Prydz Private Remix) | M83 | conflict | — |
| PLI-002-012 | Innerbloom (What So Not Remix) | RÜFÜS DU SOL | not_found | — |
| PLI-002-013 | Tearing Me Up (RAC Remix) | Bob Moses | not_found | — |
| PLI-002-014 | Line of Sight (Chet Porter Remix) | ODESZA | exact | title_primary_artist |
| PLI-002-015 | Opal (Four Tet Remix) | Bicep | exact | title_primary_artist_album |
| PLI-002-016 | Never Come Back (Four Tet Remix) | Caribou | exact | title_primary_artist |
| PLI-002-017 | Glue (Original Mix) | Bicep | not_found | — |
| PLI-002-018 | You Got the Love (New Voyager Radio Edit) | The Source | conflict | — |
| PLI-002-019 | Running Up That Hill (A Deal With God) (2012 Remix) | Kate Bush | exact | title_primary_artist_album |
| PLI-002-020 | Everything in Its Right Place (Gigamesh Remix) | Radiohead | exact | title_primary_artist |

### PLI-003

| ID | Canción | Artista | Resultado | Estrategia |
|---|---|---|---|---|
| PLI-003-001 | Me gustas tú | Manu Chao | exact | title_primary_artist_album |
| PLI-003-002 | Obsesión | Aventura | conflict | — |
| PLI-003-003 | Dragostea din tei | O-Zone | conflict | — |
| PLI-003-004 | Mas que nada | Sérgio Mendes | exact | title_primary_artist_album |
| PLI-003-005 | Boa sorte / Good Luck | Vanessa da Mata | exact | title_primary_artist_album |
| PLI-003-006 | Alors on danse | Stromae | exact | title_primary_artist_album |
| PLI-003-007 | Latinoamérica | Calle 13 | exact | title_primary_artist_album |
| PLI-003-008 | Zapata se queda | Lila Downs | exact | album_first_release_group |
| PLI-003-009 | Ai se eu te pego | Michel Teló | exact | album_first_release_group |
| PLI-003-010 | Gangnam Style | PSY | conflict | — |
| PLI-003-011 | Bailando | Enrique Iglesias | conflict | — |
| PLI-003-012 | Dernière danse | Indila | exact | album_first_release_group |
| PLI-003-013 | Tú sí sabes quererme | Natalia Lafourcade | exact | album_first_release_group |
| PLI-003-014 | Ye | Burna Boy | exact | title_primary_artist |
| PLI-003-015 | Djadja | Aya Nakamura | exact | title_primary_artist_album |
| PLI-003-016 | Malamente | Rosalía | not_found | — |
| PLI-003-017 | Jerusalema | Master KG | exact | title_primary_artist_album |
| PLI-003-018 | Shinunoga E-Wa | Fujii Kaze | not_found | — |
| PLI-003-019 | BIBI Vengeance | BIBI | exact | title_primary_artist |
| PLI-003-020 | Water | Tyla | exact | title_primary_artist_album |


## Conclusiones

1. El álbum es evidencia decisiva, pero no debe ser un filtro obligatorio: ayuda cuando el LLM lo acierta y bloquea la recuperación cuando lo inventa o elige otra edición.
2. El año debe utilizarse como señal de ranking tolerante, no como verdad ni filtro exacto.
3. Para consultar MusicBrainz funciona mejor el artista principal. Los invitados deben validarse después sobre el crédito canónico.
4. Los conflictos contienen candidatos reales y deben resolverse navegando por release group, tipo de release, vídeo, año y pista.
5. Los timeouts deben reintentarse: los ocho fallos transitorios desaparecieron en una repetición dirigida.
6. El backend debe validar las restricciones editoriales: PLI-002 prohibía repetir artista y el LLM repitió Radiohead y Bicep.
7. La siguiente versión del contrato debe admitir título alternativo, título nativo y tipo de lanzamiento. Son necesarios para alias, transliteraciones y versiones concretas.
