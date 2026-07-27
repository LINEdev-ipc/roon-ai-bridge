# Investigación dirigida de conflictos del corpus 3000

Fecha: 2026-07-27  
Fuente MusicBrainz: caché incremental local del corpus de 3000 casos  
Fuente Roon: búsquedas de catálogo de solo lectura mediante RoonIA, sin
reproducción ni cambios en zonas o colas

## Alcance

Se revisaron los 79 casos elegibles que permanecían sin resolver tras
`20260727T183617Z`. Cada decisión conserva la grabación o variante pedida; una
mezcla, edición, directo o intérprete distinto nunca se acepta como sustituto.

## Reglas con evidencia positiva

- **Aphex Twin / Syro (6):** Roon usa corchetes para los mismos nombres de
  mezcla que MusicBrainz guarda entre paréntesis. La palabra `mix` solo activa
  intención de remix cuando forma parte de un descriptor de versión.
- **Sonic Youth / Daydream Nation (2):** `Album Version` es una etiqueta
  editorial genérica de la grabación de álbum, no una toma alternativa.
- **Bill Withers (1):** Roon antepone `Medley:` al mismo título compuesto
  `Harlem / Cold Baloney`.
- **Florence + the Machine (4):** Roon expone explícitamente
  `MTV Unplugged, 2012 / Live`; no se acepta un directo genérico.
- **Nouvelle Vague (2):** coinciden título completo de la sesión KCRW y artista;
  Roon clasifica `session` como variante alternativa.
- **f(x) (1):** Roon reduce únicamente el crédito conocido `f(x)` a `f`.
- **Caetano Veloso (1):** `The Carioca` aparece como
  `Carioca (The Carioca)`, una repetición exacta con el artículo movido.
- **Curtis Mayfield (2):** MusicBrainz contiene cuatro pistas llamadas `Rap`.
  El orden de aparición de la edición verificada las relaciona con los
  resultados de Roon `Rap (#1)` a `Rap (#4)`.
- **Marcelo D2 (1):** MusicBrainz usa `1967 (Ao vivo)` y Roon
  `1967 (Acústico)` dentro del mismo contexto acústico.
- **Charly García (1):** Roon reduce `Hello! MTV Unplugged` a `Unplugged`; la
  equivalencia exige artista, forma completa del lanzamiento y posición.

Resultado esperado de estas reglas: 21 resoluciones automáticas nuevas.

## Ausencias o identidades no demostrables

Los 58 casos restantes se congelan como fallback manual, agrupados y con sus
identificadores explícitos en
`artifacts/corpus/manual-fallback-expectations.json`.

- No aparecen el lanzamiento ni las grabaciones solicitadas:
  `L’Imprudence`, `Rebuild the Wall`, `Acústico MTV` de Ira!,
  `Live at River Plate` y `Logozo`.
- Roon solo ofrece una variante distinta: aniversario remix/remaster de
  `Sunbather`; mezclas diferentes de Bebel Gilberto y Destiny’s Child;
  variantes distintas del Mixshow de Madonna.
- El álbum existe pero la grabación exacta no aparece o no queda vinculada:
  `Mercedes Sosa en Argentina`, `A Foreign Sound` (`Manhattan`), varios bonus o
  pistas ocultas de `Fantasma`, `Cosmogramma` y `Geogaddi`, y cuatro títulos
  localizados de `LILAC`.
- `Originals` y `100 MPH` de Prince existen por separado en los resultados,
  pero Roon no demuestra que ese objeto reproducible pertenezca al lanzamiento
  archivístico pedido.
- El título de Moloko queda truncado antes de demostrar el sufijo exacto del
  vocal mix; no se fuerza la coincidencia.

## Consultas representativas conservadas

- Álbumes: `L’Imprudence Alain Bashung`,
  `Rebuild the Wall Luther Wright & the Wrongs`, `Acústico MTV Ira!`,
  `Curtis Live Curtis Mayfield`, `Originals`, `Mercedes Sosa en Argentina`,
  `Acústico MTV Marcelo D2`, `Hello MTV Unplugged Charly García`,
  `Live at River Plate AC/DC`, `Sunbather Deafheaven`, `LILAC IU`,
  `Cosmogramma`, `Geogaddi`, `Bebel Gilberto Remixed`,
  `American Life Mixshow Mix`, `All Back to the Mine Moloko`.
- Pistas: `Rap #1 Curtis Mayfield Curtis Live` hasta `Rap #4`,
  `1967 Marcelo D2 Acústico`, `Cerca de la revolución Charly García
  Unplugged`, `El Cosechero En Directo Mercedes Sosa`,
  `The Carioca Caetano Veloso A Foreign Sound`, `Velvet Cake Flying Lotus`,
  `From One Source All Things Depend Boards of Canada`,
  `Tché-Tché Angélique Kidjo` y una muestra de cada familia de remix.

Las consultas MusicBrainz y sus respuestas completas permanecen en
`artifacts/cache/musicbrainz`; esta investigación no vuelve a descargarlas.

