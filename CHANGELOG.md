# Changelog

All notable production changes are documented here. Validation evidence for
each release lives under [`docs/`](docs/README.md).

## 0.20.0 Beta 16 - Unreleased

- Make the playlist MCP contract generate larger, better-structured reserve
  pools for constrained and exact-version requests, with explicit official
  audio release, collaborator, native-title and permanent-playlist guidance.
- Reject MusicBrainz video recordings and video-only ListenBrainz identities
  while recovering the corresponding official audio recording when evidence
  uniquely identifies it.
- Resolve additional exact live, remix and alternate recordings through
  release-specific ListenBrainz evidence, collective artist equivalence and
  normalized MusicBrainz release metadata without weakening version gates.
- Recover safe Roon bindings when linked performer credits or an exact
  MusicBrainz live-performance location identify the playable result, while
  continuing to reject another concert or an unanchored generic live result.
- Retain more reconciliation candidates and share provider work so reserve
  tracks can replace genuine conflicts without repeating unnecessary searches.
- Add an optional direct Roon Core connection for routed or VLAN environments
  together with isolated local validation start and stop scripts.

## 0.20.0 Beta 15 - Unreleased

- Recover failed MusicBrainz identities from a cached release tracklist while
  preserving title, artist, release and recording-version gates.
- Recover playable Roon tracks through an ordered, identity-verified album
  tracklist and share album searches and details across one playlist build.
- Refuse to substitute an unrelated compilation or reissue when an observed
  album has no compatible MusicBrainz release-group candidate.
- Tell playlist clients to supply every known album and to disable artist
  adjacency for deliberate one-artist selections.

## 0.20.0 Beta 7 - Unreleased

- Make MusicBrainz recording identity authoritative for stored title, artist,
  release group and duration while keeping only the transient playable binding
  from Roon.
- Accept equivalent Roon editions for an exact canonical recording and keep a
  valid stored binding intact when a later playback search is ambiguous.
- Make playlist-build retries idempotent, allow three genuine replenishment
  rounds and refuse to persist a playlist below its requested size.
- Consolidate resolution, migration and metadata refresh into
  `roon_rebuild_playlist`, preserving song selection, order, cover, manual
  associations and user metadata for current and legacy playlists.
- Remove redundant Roon album traversal and duplicate MusicBrainz enrichment
  from catalog-backed playlist creation.
- Redesign portal song details around identity, publication and credits, with
  artist/album navigation and MusicBrainz reference links.

## 0.20.0 Beta 5 - Unreleased

- Require an observed matching ISRC instead of treating catalog completeness as
  recording identity; ambiguous duplicates now remain explicit conflicts.
- Ignore legacy recording durations without Roon or release-track provenance so
  stale exact metadata cannot manufacture a recording match.
- Recover legacy primary artists from stored queries in both title-first and
  artist-first order without promoting flat composer credits.
- Search MusicBrainz directly by recording MBID and release title before the
  bounded release browse, then use observed year, disc and track positions to
  select an edition only when one verified candidate remains.
- Invalidate beta 4 recording-resolution caches and preserve shadow-mode,
  read-only playlist behavior.

## 0.20.0 Beta 4 - 2026-07-22

- Preserve punctuation in MusicBrainz recording searches and remove release
  mastering suffixes without treating a remaster as a distinct recording.
- Use a Roon album as weak recording evidence, fall back when it contradicts
  the requested standard/live version and report the release anchor conflict.
- Prefer a structured album artist over flat Roon display credits and allow a
  unique ISRC-supported duplicate to become a medium-confidence candidate.
- Browse MusicBrainz releases beyond the 25 linked entities returned by a
  recording lookup, while reporting a bounded/truncated catalog honestly.
- Send MusicBrainz `inc` parameters with the literal separator required by the
  API, invalidate beta 3 recording caches and audit exact legacy release
  metadata that conflicts with the catalog.
- Follow the renamed GitHub repository owner across Actions, GHCR, update
  checks, installers and deployment documentation.

## 0.20.0 Beta 3 - 2026-07-22

- Add per-lookup `cache_hit`, cache layer, elapsed time and provider request
  counts to MusicBrainz recording and release diagnostics.
- Preserve complete MusicBrainz artist credits and join phrases instead of
  exposing only the first credited artist.
- Explain rejected recording candidates with bounded reason codes for title,
  artist, release, ISRC, duration and version mismatches.
- Stop treating partial artist-name containment as identity equivalence, keeping
  people such as Jimi Hendrix distinct from groups such as The Jimi Hendrix
  Experience.
- Verify a stored recording MBID directly before searching again, while keeping
  a differing MusicBrainz artist credit explicit instead of rewriting intent.
- Audit legacy `exact` durations that lack `musicbrainz_release_track`
  provenance or disagree with the shadow result.

## 0.20.0 Beta 2 - 2026-07-22

- Resolve MusicBrainz recordings and releases as separate identities instead of
  treating the most common album as the recording's canonical edition.
- Stop at a release-group candidate when several editions remain possible and
  expose the evidence used to match an explicit hint or a Roon observation.
- Report an edition track duration only after verifying the recording inside a
  unique release; otherwise label the recording duration as a MusicBrainz
  median.
- Bind diagnostic Cover Art Archive URLs to the selected release or release
  group and explicitly leave existing Roon artwork coherence unverified.

## 0.20.0 Beta 1 - 2026-07-22

- Add the additive identity V2 shadow contract without changing stored playlist
  identity or manual Roon selections.
- Persist MusicBrainz recording-resolution results in SQLite with status-aware
  expiry, request serialization and bounded retries for HTTP 429/503 responses.
- Extend `roon_analyze_playlist` with optional, read-only MusicBrainz diagnostics
  for up to ten selected playlist tracks.
- Keep the portal manual search and reassignment workflow unchanged.

## 0.19.1 Beta - Unreleased

- Playlist metadata now keeps the selected recording identity separate from
  replaceable recording and release observations. Refreshes verify album
  membership, artwork and version coherence before persisting an edition.
- MusicBrainz enrichment now requires a Roon release or ISRC anchor, reports
  unresolved recording conflicts instead of choosing by popularity, and adds
  duration, credits, genres, ISRCs and original release year when verified.
- Model-created playlists persist the same enrichment report and catalog facts
  during preflight without changing the existing reserve policy.
- The debug portal exposes catalog, user and technical metadata in readable
  grids, formatted JSON, per-track reassignment and unboxed warning icons.

## 0.19.0 - 2026-07-21

- GitHub Actions now validates every change and publishes ready-to-run,
  multi-architecture Docker images for the `stable` and `beta` channels.
- LXC installation and portal updates download those images instead of
  compiling the application inside the LXC. Updates back up application data,
  verify container health and restore the previous release after a failure.
- Replaced the former MIT declaration with PolyForm Noncommercial 1.0.0 and an
  explicit policy that prohibits paid installation, maintenance and support.
- Added recorded, transactional SQLite migrations and removed duplicate schema
  files without changing existing user data.
- Corrected malformed UTF-8 Spanish text and added a source-encoding guard.
- Added ordered SIGTERM/SIGINT shutdown for HTTP servers, Roon discovery,
  background checks, logs and SQLite.

## 0.18.0 - 2026-07-20

- Promoted the validated v0.18.0 beta line to the stable `main` channel.
- Added a typed application composition root shared by the API, portal and MCP
  layers, removing post-construction context mutation.
- Removed the disconnected legacy MCP facade and made `bridge-v2` the only
  HTTP and stdio implementation.
- Split the portal backend into focused route modules and extracted the shared
  mini-player browser feature without changing routes or presentation.
- Preserved the public media, playlist and MCP facades while extracting their
  contracts and bounded search, cover and transport policies.
- Updated the architecture documentation and added explicit v0.18.0 regression
  and post-deployment validation guidance.

## 0.17.3 - 2026-07-20

- Promoted the validated v0.17.3 beta line to the stable `main` channel.
- Expanded the MCP Apps surface from three to six focused read-only widgets
  with a saved-playlist library, a bounded per-zone queue and an all-zone
  dashboard with grouped outputs, playback options and active safe limits.
- Normalized Roon queue display lines into title, artist and album fields so
  the portal and MCP queue views show track metadata instead of generic rows.
- Cache-busted the shared widget renderer under `ui://roon-ai-bridge/v19/` and
  kept artwork private in result metadata for every new view.
- Added temporary working playlists for activity, mood and occasion requests.
  They use the same strict batched recording preflight as saved playlists, stay
  out of normal playlist listings and can replace or extend the Roon queue.
- Added explicit MCP intents to create, inspect and promote temporary playlists.
  Promotion preserves the playlist ID, verified tracks, ordering and artwork.
- Added per-playlist expiration with automatic database and custom-cover
  cleanup. New temporary playlists use the configurable 1-365 day lifetime;
  changing it does not rewrite existing expiration dates.
- Added the expiration setting under Portal > Ajustes > Sistema and a dedicated
  temporary-playlist manager under Música > Playlists that is visible only
  while Modo Debug is enabled.
- Added ordered, paginated track reads for playlists selected from the native
  Roon catalog, allowing a model to compare them with saved RoonIA playlists.

## 0.17.2 - 2026-07-17

- Promoted the validated v0.17.2 beta line to the stable `main` channel.
- Refined automatic playlist collages to rotate every two seconds at random
  positions, changing one tile in 2x2 and 3x3 layouts and two tiles in 4x4
  layouts without fade or zoom transitions. Distinct artwork is sampled and
  kept unique within the visible grid whenever the playlist provides enough
  different covers.
- Reordered playlist card details to show the track count and last playback
  immediately after the title, followed by a naturally sized description.
- Added total playlist duration in hours and minutes to portal cards, marking
  partial totals when one or more tracks have no known duration.
- Replaced stacked portal toasts and stale update text in the header with one
  concise three-second action notification whose newest message takes priority.
- Added contextual feedback for playback, volume, grouping, queue, playlist,
  access and administration actions.
- Simplified the header version to omit the build and identify beta installs as
  `vX.Y.Z (beta)`.
- Reorganized System settings with a compact update block, conditional update
  availability, clearer live status labels and a separate service restart
  panel.
- Added a guided beta-exit flow: install the latest stable release immediately
  or retain the installed beta without receiving newer betas until `main`
  reaches the same version, then switch automatically to stable.
- Added configurable daily update checks, persisted version-check results and
  a permanent available-update notice in the header and System settings.
- Added a persistent Modo Debug in a separate diagnostics panel. It reveals
  technical System details, advanced OAuth diagnostics and the Registros tab
  without changing the service log level.
- Rebuilt model-created playlists as a batched preflight: title and artist are
  mandatory, confident album/year data act as identity hints, ambiguous or
  missing recordings are never persisted, reserves and two replenishment
  rounds can fill the requested size, and any final shortfall is reported.
- Playlist creation now deduplicates recordings, rejects unintended live,
  remix, cover and alternate versions, avoids adjacent tracks by the same
  artist and stores the complete available Roon observation separately from
  model-supplied metadata.
- Playlist playback now reconstructs fresh Roon references with the original
  successful title-and-artist query when enriched secondary credits or release
  context make the canonical metadata query too restrictive.
- Rebuilt manual media search so typed Roon categories run in independent
  sessions concurrently, while the portal renders each category as soon as it
  arrives and cancels stale searches.
- Replaced search skeleton rectangles with per-section activity indicators,
  restored the direct Roon `Mejor resultado`, and added silent background
  hydration with 12-item progressive `Ver más` expansion up to 100 results per
  category.
- Artist and album details now prefer exact native-library identities through
  a cached ordinal index, label their provenance and completeness, and retain
  the selected search session when a streaming result must be opened.
- Exact catalog references now take precedence while valid, preserving Roon's
  classified artist discography and complete streaming album contents even
  when individual track rows omit number or duration metadata.
- Manual result sections now keep Roon's own order rather than promoting local
  exact-title namesakes. `Mejor resultado` requires corroborating identity
  evidence, so Disclosure resolves to Roon's artist instead of an unrelated
  same-title album.
- Artist and album search results now traverse Roon `action_list` menus through
  safe entity-navigation actions before reading content. Artist fichas retain
  Roon's section labels and order, and streaming album fichas load their real
  ordered tracklists when exposed by Browse.
- Artist discographies now follow native `View All` continuations instead of
  stopping at Roon's preview shelf. Catalog releases are reopened with their
  exact album-and-artist identity so albums outside the local library retain
  access to their ordered streaming tracklists.
- Expired catalog detail sessions now retry through a fresh Roon search before
  considering a verified local-library fallback, preserving the complete
  streaming discography on repeated artist and album opens.
- Album detail recognizes counted English and Spanish track sections such as
  `3 Tracks` and `3 pistas`, and no longer presents long linked artist-credit
  lists as editorial descriptions.
- Artist detail now recovers streaming releases from Roon's Albums search when
  the artist object exposes only the local `0/1 Albums` count. Raw Roon-linked
  artist IDs are retained for exact attribution, homonyms are excluded and
  secondary-credit releases are separated as appearances.
- Catalog album detail follows bounded, identity-matched repeated list wrappers
  before reading tracks, matching the native Browse path used by releases such
  as `Caracal (Deluxe)` and `The Complete Animals`.
- Removed name-only discography fabrication and synthetic album ordering:
  unverified global matches are omitted or displayed separately as related
  results, actions are excluded from tracklists and track numbers are parsed
  only from Roon's structured data or native list prefixes.
- Search ambiguity now blocks recommendation for indistinguishable exact
  candidates, and artist-credit parsing preserves slash band names such as
  AC/DC.

## 0.17.1 - 2026-07-16

- Rebuilt the embedded widgets through `ui://roon-ai-bridge/v17/` with the
  portal visual system, app-only verified actions, stable state reconciliation
  and signed artwork delivery through the public MCP route.
- Added deterministic media search, richer artist discographies and complete
  multi-disc album track lists while preserving Roon's preferred result.
- Added strict playlist track resolution that prefers the intended recording,
  reports ambiguity and chooses TIDAL or the best known quality only among
  equivalent recordings.
- Added playlist artwork management, paginated widget views, recent-playback
  ordering and a clearer `Mi Música` portal experience.
- Added a locally advancing playback clock with seek support between live Roon
  snapshots.

## 0.17.0 - 2026-07-13

### Added

- Canonical MCP v2 facade with 30 intent tools, three model-visible widget
  entry points and one app-only navigation tool.
- Focused player, media explorer and library widgets under the cache-busted
  `ui://roon-ai-bridge/v11/` resource namespace.
- Portal connection management for ChatGPT OAuth and generic MCP clients.
- Artist releases, album tracks, deeper entity views and richer media search
  ranking.
- Persistent recording identity snapshots for virtual playlists, including
  fresh Roon reference reconstruction before playback.
- Standalone LXC update watcher with terminal status reporting and build-level
  update comparison.

### Changed

- Redesigned the administration portal and its active-zone playback flows.
- Replaced the broad legacy MCP catalog with one intent per model-visible
  tool; legacy MCP aliases are no longer exposed by the v2 facade.
- Improved search preference for clean studio recordings and explicit
  classification of live, remix, edit, remaster, binaural and other alternate
  versions.
- Strengthened Roon SDK normalization, state caching, grouping, transfer,
  queue, image, volume and transport behavior.
- Hardened API-key, OAuth, portal-authentication and tool-access boundaries.

### Fixed

- Prevented temporary Roon Browse identifiers from being treated as durable
  playlist identities.
- Preserved the queue when the first playlist recording cannot be resolved
  safely and unambiguously.
- Corrected portal controls and artwork loading after updates.
- Completed MCP Apps `tool-input` notification and ChatGPT `toolInput` global
  handling in the focused widgets.
- Made connection and update failures observable without exposing secrets.

### Upgrade notes

- Stable installations update from the `main` branch; beta installations use
  `beta` while beta updates are enabled.
- MCP v2 metadata and widget resources are cached by ChatGPT. After deployment,
  refresh the app and start a new conversation.
- See [release notes](docs/v0.17.0-release-notes.md) for compatibility details
  and [validation](docs/v0.17.0-validation.md) for release evidence.

## 0.16.0 - 2026-07-09

- Added operational diagnostics, action and technical logs, health/readiness
  endpoints and read-only extension inspection.

Earlier release history is recorded in the versioned validation documents in
[`docs/`](docs/README.md).
