# MCP v2 Architecture

## Purpose

MCP v2 replaces the previous 89-tool facade with 36 canonical intent tools and
six focused read-only widget entry points. It is a
breaking contract with no legacy aliases. The HTTP API, portal and persisted
user data remain outside this replacement.

## Layers

```text
MCP protocol
  -> tool registry, widget resources and uniform result mapper
Application intentions
  -> semantic target and media resolution
Roon and persistence adapters
  -> native Roon transport/browse and SQLite data
```

The implementation lives in `src/bridge-v2`:

- `contracts.ts` defines target/media references and the result envelope.
- `targetResolver.ts` resolves exact accent-insensitive zone/output names or IDs.
- `intentGateway.ts` implements complete user intentions.
- `intents/transportIntentHandler.ts` owns state, playback, volume, power,
  playback-option, grouping and transfer orchestration behind that facade.
- `mcp/index.ts` is the active stdio entry point.
- `mcp/tools.ts` owns schemas, annotations and the 36-tool intent catalog.
- `mcp/server.ts` owns server instructions and HTTP/stdio construction.
- `widgets/viewService.ts` creates bounded, presentation-ready view models.
- `widgets/tools.ts` owns six model-visible read-only display entry points.
- `widgets/resources.ts` owns the cache-busted MCP Apps HTML resources.

The widget layer contains no mutations, controls or polling. `roon_show_now_playing`,
`roon_show_zones`, `roon_show_queue`, `roon_show_media`, `roon_show_playlist`
and `roon_show_playlist_library` each produce one bounded view model.
Full presentation payloads live in result `_meta`; model-visible
`structuredContent` stays concise.

### Search and resolution boundary

Roon Browse access and media normalization remain shared, but discovery and
automatic association use different application policies:

```text
RoonMediaService (catalog and temporary references)
  -> discovery search (HTTP portal, widgets and roon_search_media)
  -> TrackResolutionService (playlist association and playback reconstruction)
```

Discovery search preserves broad categorized results for a person or model to
inspect. `TrackResolutionService` requests tracks only, requires a sufficiently
strong title/artist/version identity, and treats source and quality as a second
selection stage. It may prefer TIDAL over a local copy only when the candidates
represent the same recording; a higher-quality cover, live version or wrong
artist can never outrank the correct recording.

## Efficient flows

### Direct transport

`roon_control_playback({ zone: { name: "Despacho" }, action: "pause" })`
resolves the name and performs the command in one call.

### Query and play

`roon_play_media` accepts a query, performs typed search internally and acts
only when the search has one recommended result that does not require
selection. Otherwise it returns candidates with `status: "ambiguous"` and
does not mutate Roon.

### Deep exploration

`roon_search_media` returns temporary references. `roon_get_media_entity`
uses the selected reference to retrieve artist releases/popular tracks or an
album track list through Roon Browse. For a selected Roon catalog playlist it
returns ordered track pages with `pagination.total`, `offset`, `returned` and
`has_more`. The model can page the source, read a saved target with
`roon_get_playlist`, and submit only missing recordings to
`roon_edit_playlist_tracks`; `roon_get_playlist` remains exclusively for
saved or temporary RoonIA playlists.

### Model-created playlist preflight

`roon_save_playlist` accepts one batch containing primary proposals and
reserves. For niche genres, dates or uncertain names, the model first calls
`roon_search_media` with focused queries and copies the exact `title`,
`artist_credit`, `album_hint` and temporary `result_id`. MusicBrainz remains
the authority that decides the recording identity. A fresh compatible
`result_id` is reused as the preferred Roon binding, avoiding a duplicate Roon
search; an expired or incompatible reference falls back to deterministic
title/artist search.

`release_year_from` and `release_year_to` constrain the MusicBrainz release
group's first-publication year. `release_year_hint` is only an observed
candidate hint and must never be guessed.

The preflight runs before any playlist write. It validates the title, every
required artist or performance credit, the requested recording family and a
playable Roon identity. Standard and remastered releases are equivalent for a
standard request. Live, remix, cover, dub, acoustic and other alternate
recordings require an explicit matching `recording_intent`. The word `dub` in
a genre or ordinary song title remains `standard`; only an explicit qualifier
such as `Dub Mix` or `Dub Version` selects the dub recording family. A
model-provided `result_id` is temporary evidence and never bypasses these
checks.

Candidates are resolved with bounded concurrency. Valid reserves fill rejected
or duplicated primaries, then the final accepted set is reordered so the same
artist is not adjacent. Only accepted, fully resolved tracks are written, in a
single transaction. Each stored row separates normalized `audio_metadata`,
model hints and provenance in `user_metadata`, and the raw search/album-detail
observation in `resolution.roon_observation`.

When `desired_count` cannot be met, the tool returns `status: "needs_input"`
with a short-lived `build_id` and a structured `rejection_summary`. Server
instructions map ambiguity, not-found, missing binding, duplicate and date
failures to a concrete replenishment action. The individual rejection list is
bounded to the latest 25 entries while the summary retains complete counts.
Three genuine replenishment
rounds are accepted. If the target is still not met, every verified track is
saved atomically; `build_summary.added_count`, `missing_count` and `complete`
state the exact outcome. A zero-track build still fails instead of creating an
empty playlist. Build sessions live in the running process for 30 minutes.

### Temporary working playlists

Activity, mood and occasion requests that do not ask to preserve a named list
use `roon_create_temporary_playlist`. It accepts the same strictly verified
candidate batch and replenishment protocol as `roon_save_playlist`, but writes
an immutable expiration timestamp alongside the playlist. The configured
lifetime is read when a new build starts; changing the setting affects future
temporary playlists only.

Temporary playlists are excluded from ordinary saved-playlist listings and
name lookup. `roon_list_temporary_playlists` exposes them deliberately, and
normal playback uses the returned stable playlist ID. Expired rows are removed
with their tracks and custom artwork before playlist operations. If the user
wants to keep one, `roon_promote_temporary_playlist` removes only its lifecycle
record, optionally changes its name or description, and preserves its ID,
tracks, order and cover.

### Batch playlist editing

`roon_edit_playlist_tracks` accepts an ordered batch of add, update, remove,
reorder or replace operations. This avoids one MCP round trip per track while
keeping playlist deletion in a separate destructive tool. Its operation
schemas are explicit so the model does not need to infer field names.

Add and replace operations use the same strict preflight and complete metadata
capture as playlist creation; unresolved candidates are reported as omitted
without being written. Additions are also compared with the target's existing
identity fingerprint and normalized title/artist key, so a source playlist
cannot re-add an existing recording. Identity-changing updates are resolved
before returning.
An update with `changes.result_id` can repair one incorrect association
manually.
`roon_rebuild_playlist` is the single model-visible maintenance intent. It
migrates legacy tracks to the current MusicBrainz recording identity, repairs
Roon playback bindings and completes canonical metadata without changing the
selected songs, order, cover or user metadata. It accepts issue-only, selected
`track_ids` and full-playlist scopes, plus explicit `track_id`/`result_id`
selections after the model or portal user chooses an ambiguous candidate.
Reconstruction runs as one asynchronous job per playlist. The initial call
returns `status: "in_progress"` and a `job_id`; the same MCP tool polls that
job until completion. The portal uses the same job and shows the MusicBrainz,
Roon binding and metadata phases. There are no resolve, metadata-refresh or
`/virtual-playlists` compatibility routes.

An exact MusicBrainz recording supplies the stored title, artist credit,
release group and duration. Roon supplies the currently playable item and its
service-specific artwork. Equivalent country editions may satisfy playback,
but a remix, live performance or other recording family may not. A transient
ambiguous Roon search is reported for that playback attempt and does not erase
the last durable canonical identity or binding.

Starting with v0.20.0 beta.1, `roon_analyze_playlist` accepts up to ten explicit
`catalog_track_ids` and returns an identity V2 MusicBrainz diagnostic in shadow
mode. The diagnostic separates proposed primary artists, MusicBrainz work
credits and role-unknown Roon display credits. It is read-only and must not be
used as evidence that the stored playlist was migrated or repaired.

Starting with beta.2, the diagnostic also treats recording, release group and
exact release as separate identities. It returns an exact edition only when the
available anchors identify one release and MusicBrainz confirms the recording
as a unique track on it. Otherwise it stops at a release-group candidate or an
explicit ambiguity. Track duration and Cover Art Archive evidence always state
which MusicBrainz entity they belong to.

Beta.3 makes those decisions auditable. Recording and exact-release lookups
report memory/SQLite cache hits, provider request counts and bounded candidate
rejection reasons. A previously stored recording MBID is verified directly
against MusicBrainz before falling back to search. Stored `exact` durations that
do not cite a release track are reported as legacy inconsistencies and are not
silently promoted into identity V2.

Beta.4 repairs the provider boundary and matching sequence found by the full
playlist beta report. Recording search keeps human punctuation, strips only
release-level mastering labels and treats a stored Roon album as weak evidence
that may be discarded when it conflicts with the requested recording family.
Flat display credits never outrank a structured album artist. When MusicBrainz
contains duplicate compatible recordings, a result advances only if one has
unique ISRC evidence and remains a medium-confidence candidate. Release
identity paginates beyond the 25 linked entities returned by a recording
lookup; a bounded, truncated browse cannot prove that an observed album is
absent. MusicBrainz include lists are serialized with the literal `+` separator
required by the API.

Beta.5 corrects the remaining identity-evidence boundary. An ISRC affects
selection only when it matches an independently observed code; the fact that
one duplicate happens to have cataloged ISRCs is never a tiebreaker. A legacy
duration without Roon or release-track provenance is excluded from recording
matching. Legacy queries recover a primary artist with the exact title at
either edge. Release resolution searches the recording MBID plus anchor title
before falling back to bounded browsing, then uses observed year, disc and
track positions only to narrow candidates. Exact release status still requires
MusicBrainz to verify the recording as a unique track on that release.
Generated playlist artwork uses an explicit two-step MCP flow.
`roon_prepare_playlist_cover` resolves the playlist by exact ID or normalized
name and returns its description, bounded track context, generation requirements
and required next steps before image generation begins. The server instructions
require this preflight before generated artwork.

`roon_set_playlist_cover` declares `image_file` through
`_meta["openai/fileParams"]`, so ChatGPT passes an authorized `file_id` and
temporary `download_url` instead of asking the model to serialize binary data as
Base64. The bridge accepts only public HTTPS file URLs, bounds download time and
bytes, redacts the temporary URL from logs and retains inline Base64 only for
legacy clients.

JPEG, PNG and WebP sources must be at least 768×768. RoonIA rejects smaller
thumbnails rather than storing a blurry cover, corrects orientation, center
crops, strips metadata and writes a verified square WebP at 1024×1024 and no
more than 750 KB. The tool result reports the stored dimensions, format, color
space and byte count.

### Lightweight visual responses

`roon_show_now_playing` renders only active playing zones and can resolve an
optional named zone in the same call. Grouped zones expose every output and its
individual volume. `roon_show_media` returns categorized results for a generic
query and expands an unambiguous artist, album or track in one call when one
explicit type is supplied. `roon_show_playlist` resolves an exact name or ID
and returns cover, description and bounded song rows. `roon_show_playlist_library`
returns paginated saved-playlist cards, `roon_show_queue` resolves one zone and
renders a bounded queue snapshot, and `roon_show_zones` summarizes all zones,
grouped outputs, playback options and active safe-volume limits. The iframe only
hydrates the returned data and never calls another tool.

## Result semantics

`status` describes protocol outcome; `verified` separately describes whether
the final external state was observed. `completed` therefore never implies
verification by itself. Errors are returned in the same envelope with
`status: "failed"` and `isError: true` at MCP level.

`structuredContent` contains the envelope once. Text content is a short human
summary and never repeats the full JSON payload.

## Compatibility boundary

The dependency audit completed in v0.18.0 and the disconnected `src/mcp`
implementation was removed. Both `/mcp` and `pnpm run mcp` now enter through
`src/bridge-v2/mcp`; there is no legacy runtime or model-visible alias layer.
