# HTTP API

Default port: `3000`.

## Authentication

Authentication is optional and controlled by `.env`:

```env
ENABLE_AUTH=true
API_TOKEN=<long random token>
```

When enabled, `/health` and `/privacy` are public. Every Roon, playlist, history, preferences and MCP endpoint requires:

```bash
curl http://localhost:3000/roon/status \
  -H "Authorization: Bearer <API_TOKEN>"
```

Missing or invalid tokens return `401` with the standard error format.

Standard errors use a stable JSON shape:

```json
{
  "ok": false,
  "error": {
    "code": "ZONE_NOT_FOUND",
    "message": "Zone not found",
    "details": { "zone_id": "missing-zone" }
  }
}
```

## OAuth For ChatGPT Apps

OAuth metadata:

```bash
curl http://localhost:3000/.well-known/oauth-protected-resource
curl http://localhost:3000/.well-known/oauth-authorization-server
```

Dynamic client registration:

```bash
curl -X POST http://localhost:3000/oauth/register \
  -H "Content-Type: application/json" \
  -d '{"client_name":"ChatGPT","redirect_uris":["https://chatgpt.com/connector/oauth/example"]}'
```

Authorization endpoint:

```text
http://localhost:3000/oauth/authorize
```

Token endpoint:

```text
http://localhost:3000/oauth/token
```

The approval page asks for `OAUTH_APPROVAL_PIN`. If that variable is empty, it falls back to `API_TOKEN`.

## Health

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "ok": true,
  "service": "roon-ai-bridge"
}
```

## Phase 2 Virtual Playlists And Candidate Search

Media search can now return scored candidates for manual selection:

```bash
curl -X POST http://localhost:3000/roon/media/search \
  -H "Content-Type: application/json" \
  -d '{"query":"Red Right Hand Nick Cave","types":["track"],"count":10}'
```

Responses include `best_match`, `best_by_type`, grouped `artist`, `album`, `ep`,
`single_ep`, `single`, `track` and `playlist` results, plus the compatible flat
`results` array. `ambiguous`, `recommended_result_id` and `selection_required`
remain available for callers deciding whether an automatic playback action is
safe. Each result exposes `match_score`, `confidence`, `match_reasons`,
`match_penalties`, `version_hint`, `source`, `quality`, `is_library`, native
`roon_rank`, `direct_match`, `direct_match_score` and navigable artist/album
`links`. Multi-artist credits are also exposed as an `artists` array and as
`links.artists`; each entry has its own title and reusable `result_id` when the
same search returned that artist.

Album-like results additionally expose `release_type` (`album`, `ep`, `single`,
`single_ep`, `compilation`, `live`, `remix` or `unknown`) and
`release_type_source` (`roon_metadata`, `roon_section`, `musicbrainz`, `inferred`
or `unknown`).
The Roon search-root result is used as the principal relevance/popularity signal;
native category order breaks ties when Roon exposes no direct match.
Unknown Roon metadata is returned as `unknown`, `low`, `null`, or omitted
rather than guessed.

Artist detail follows the native Discography, Albums, EPs and Singles sections
instead of accepting surname/substring search matches. Preview shelves are
expanded through Roon's native `View All` list before the response is marked
complete, so the portal does not stop at the first visible row. Releases found
inside an artist page are re-resolved with the exact album title plus artist
when their original browse session has already been consumed. If a retained
catalog session has expired, detail resolution performs one fresh catalog
search before considering a verified local-library identity. When Roon's
artist object exposes only its local `0/1 Albums` count, the service may recover
catalog releases from the Albums category only after correlating the raw
Roon-linked artist ID. Exact linked identity, rather than a name substring,
excludes homonyms; releases where that ID is not the primary credit are kept in
an `Appearances` section. This recovery remains `partial` because the Browse
search does not expose Roon Desktop's formal discography classification.

Album detail follows counted English and Spanish track-list and disc levels,
including labels such as `3 Tracks` and `3 pistas`, and bounded repeated album
wrappers whose title, artist and artwork still match. It paginates until the
requested limit, so the `tracks` array represents the complete Roon list rather
than its first page. Long linked artist-credit subtitles are metadata, not
editorial album descriptions.
Playlist detail opens a selected Roon catalog playlist and returns its ordered
tracks in pages. Use `count` up to 100 and increase `offset` until
`pagination.has_more` is false:

```bash
curl "http://localhost:3000/roon/media/<RESULT_ID>/playlist-detail?count=100&offset=0"
```

Each row includes a one-based `playlist_position` plus the temporary media
reference and normalized title, artist, album, duration and source metadata
that Roon exposed. These catalog references are not permanent recording IDs;
saved RoonIA playlist entries receive their own stable `track_id` and identity
fingerprint.
When a streaming album opens as a Roon `action_list` instead of a navigable
track list, the service recovers the ordered tracks from Roon's Tracks category
using the exact album title, artist ownership and shared cover fingerprint.
If Roon exposes no discography sections, the artist fallback loads up to the
requested release limit and enriches exact title/artist matches with MusicBrainz
type and first-release year. It does not traverse every unmatched release, so
artist detail remains fast; the year is presented only in release detail.

Broaden a search when the right candidate is missing:

```bash
curl -X POST http://localhost:3000/roon/media/search/expand \
  -H "Content-Type: application/json" \
  -d '{"original_query":"Red Right Hand Nick Cave Peaky Blinders soundtrack","types":["track"],"strategy":"all","count":25}'
```

Advanced playlist endpoints:

- `GET /virtual-playlists/:playlist_id/validate`
- `POST /virtual-playlists/:playlist_id/resolve`
- `POST /virtual-playlists/:playlist_id/deduplicate`
- `POST /virtual-playlists/:playlist_id/sort`
- `GET /virtual-playlists/:playlist_id/export?format=json|csv|m3u`
- `POST /virtual-playlists/import`
- `POST /virtual-playlists/:playlist_id/tracks/:track_id/match`
- `POST /virtual-playlists/:playlist_id/tracks/from-search-result`

The existing `/playlists/...` routes expose the same behavior for portal
compatibility. Track payloads preserve legacy `metadata` while also exposing
separate `audio_metadata`, `user_metadata`, and `resolution` objects.

Resolve and persist the canonical catalog profile for a temporary Roon track
result:

```bash
curl http://localhost:3000/media/<RESULT_ID>/catalog
```

The endpoint accepts track results only. Its `catalog` response keeps the
MusicBrainz recording, artist credit, work, credits, genres, release group and
optional exact edition separate from `roon_binding`. The binding describes the
currently observed playable Roon item and is never a permanent Roon identifier.
Ambiguous MusicBrainz identities are returned with their explicit status and
are not written as canonical recordings.

## Privacy Notice

```bash
curl http://localhost:3000/privacy
```

This endpoint is public and can be used as the privacy policy URL when configuring a ChatGPT app.

## Roon Status

```bash
curl http://localhost:3000/roon/status
```

Response:

```json
{
  "core_connected": true,
  "core_name": "Roon Core",
  "transport_ready": true,
  "browse_ready": true,
  "zones_count": 2
}
```

## Capabilities

```bash
curl http://localhost:3000/roon/capabilities
```

## Safety Policy

The portal and external clients can inspect operational safety metadata:

```bash
curl http://localhost:3000/safety/policy
```

The response includes `version`, `volume_limits`, `tool_classification` and
`confirmation_policy`. Volume limit entries already expose a `limits[]` shape so
future time-windowed limits can be added without changing clients.

Playback, queue, grouping, transfer and normal volume changes do not require
confirmation. Confirmation is required only for destructive virtual playlist
operations and for volume increases above the configured safe limit.

Mutating MCP tools accept `dry_run:true` where supported. A dry run does not
execute the action and returns a structured plan with `classification`,
`planned_changes` and `warnings`. Destructive operations and unsafe volume
raises return `requires_confirmation:true` with `confirm_payload` suitable for a
portal confirmation modal.

## Library Browse

Browse root:

```bash
curl "http://localhost:3000/roon/library"
```

Browse a specific hierarchy:

```bash
curl "http://localhost:3000/roon/library?hierarchy=albums&count=50"
```

Library items now include a normalized `media` object with song-level metadata such as artist, album, track number, duration, release year and `cover.image_key` when Roon exposes those fields.

Open an item from a previous response:

```bash
curl "http://localhost:3000/roon/library?item_key=<ITEM_KEY>&zone_id=<ZONE_ID>"
```

Go back one browse level:

```bash
curl "http://localhost:3000/roon/library?pop_levels=1"
```

Reset to browse root:

```bash
curl "http://localhost:3000/roon/library?pop_all=true"
```

Supported library hierarchies:

- `browse`
- `albums`
- `artists`
- `genres`
- `composers`
- `internet_radio`
- `playlists`

## Typed Media Search

```bash
curl -G "http://localhost:3000/roon/media/search" \
  --data-urlencode "q=Bad Bunny" \
  --data-urlencode "types=track,album,artist" \
  --data-urlencode "zone_id=<ZONE_ID>" \
  --data-urlencode "source_preference=streaming_first"
```

Supported types:

- `track`
- `album`
- `artist`
- `playlist`

Every result includes a temporary `result_id`. Use it within 20 minutes:

```bash
curl "http://localhost:3000/roon/media/<RESULT_ID>"

curl -X POST "http://localhost:3000/roon/media/<RESULT_ID>/play" \
  -H "Content-Type: application/json" \
  -d '{"zone_id":"<ZONE_ID>","mode":"replace_queue"}'
```

Stable result fields include `result_id`, `type`, `media_type`, `title`,
`artist`, `album`, `album_artist`, `source`, `quality`, `is_library`,
`image_key`, `roon_item_key`, `playable` and `expires_at`. `source` and
`quality` are extracted from Roon browse metadata when available; otherwise
`source` remains `unknown`, `quality` remains `null`, and `is_library` remains
`null` instead of guessing. Unknown or expired result IDs return
`SEARCH_NO_RESULTS`; they are scoped to the current in-memory search session.

Playback modes:

- `replace_queue`
- `play_next`
- `append`

For artist results, normal playback uses the artist catalog. Similar-music radio is explicit:

```bash
curl -X POST "http://localhost:3000/roon/media/<RESULT_ID>/radio" \
  -H "Content-Type: application/json" \
  -d '{"zone_id":"<ZONE_ID>"}'
```

Artist releases:

```bash
curl "http://localhost:3000/roon/media/<ARTIST_RESULT_ID>/releases?zone_id=<ZONE_ID>"
```

MCP `roon_search_media` omits base64 artwork by default. Pass
`include_images: true` only when the client needs inline cover images; internal
resolution flows use `image_key` metadata instead.

## Legacy Search

```bash
curl "http://localhost:3000/roon/search?q=massive%20attack&count=10"
```

Optional parameters:

- `zone_id`: includes zone context for playback-capable browse actions.
- `offset`: defaults to `0`.
- `count`: defaults to `25`, max `100`.
- `session_key`: keeps related browse/search calls in the same Roon browse session.

## Legacy Play By Query

```bash
curl -X POST http://localhost:3000/roon/play \
  -H "Content-Type: application/json" \
  -d '{"zone_id":"<ZONE_ID>","query":"massive attack mezzanine"}'
```

The implementation searches Roon, selects the first plausible playable result, then follows Roon browse actions until playback starts or no playback action is found.

## Queue

Read queue snapshot:

```bash
curl "http://localhost:3000/roon/queue/<ZONE_ID>?max_item_count=50"
```

Play from a queue item:

```bash
curl -X POST http://localhost:3000/roon/queue/<ZONE_ID> \
  -H "Content-Type: application/json" \
  -d '{"action":"play_from_here","queue_item_id":"<QUEUE_ITEM_ID>"}'
```

Add a query result next:

```bash
curl -X POST http://localhost:3000/roon/queue/<ZONE_ID> \
  -H "Content-Type: application/json" \
  -d '{"action":"add_next","query":"bad bunny"}'
```

Add a query result to the queue:

```bash
curl -X POST http://localhost:3000/roon/queue/<ZONE_ID> \
  -H "Content-Type: application/json" \
  -d '{"action":"add_to_queue","query":"bad bunny"}'
```

Inspect queue/play actions exposed by Roon for a query:

```bash
curl -X POST http://localhost:3000/roon/queue/<ZONE_ID> \
  -H "Content-Type: application/json" \
  -d '{"action":"inspect_actions","query":"bad bunny"}'
```

The add actions depend on Roon exposing matching browse actions for the selected result. `add_to_queue` only executes an explicit end-of-queue action; if Roon only exposes an ambiguous `Add to Queue` action that behaves like add-next, the API returns `QUEUE_ACTION_NOT_FOUND` with `available_actions`.

## Virtual Playlists

List virtual playlists:

```bash
curl "http://localhost:3000/playlists?include_tracks=false&limit=25&offset=0"
```

List tracks for returned playlists only when needed:

```bash
curl "http://localhost:3000/playlists?include_tracks=true&limit=5&offset=0&track_limit=25&track_offset=0"
```

The list response is paginated and includes summaries by default:

```json
{
  "playlists": [
    {
      "playlist_id": "mix",
      "name": "Mix",
      "track_count": 194,
      "tracks_count": 194
    }
  ],
  "total": 1,
  "limit": 25,
  "offset": 0,
  "include_tracks": false
}
```

Create a virtual playlist:

```bash
curl -X POST http://localhost:3000/playlists \
  -H "Content-Type: application/json" \
  -d '{"playlist_id":"bad-bunny-test","name":"Bad Bunny Test","tracks":[{"query":"bad bunny dakiti"},{"query":"bad bunny neverita"}]}'
```

Creation, track addition and full replacement automatically try to resolve
tracks against Roon search. Entries can pass `query`, or `title` plus optional
`artist`. Every entry has a permanent RoonIA `track_id`, a versioned
`identity.fingerprint`, a canonical query and the best available recording
metadata. Resolution status is `resolved`, `manual`, `stale`, `ambiguous`,
`missing` or `error`.

`roon_item_key` and search `result_id` values are Browse-session references,
not recording identifiers. They are retained only as the last diagnostic
observation (`roon_binding.reusable:false`). RoonIA reconstructs a fresh
reference from the stored identity before every playback or queue action.

Get one virtual playlist:

```bash
curl "http://localhost:3000/playlists/bad-bunny-test?include_tracks=true&limit=50&offset=0"
```

Set `include_tracks=false` to read only playlist metadata. Detail responses
always include `track_count`, `limit`, `offset`, `returned_count` and
`has_more`; offsets outside the track range return an empty track list with
`has_more:false`.

```json
{
  "playlist_id": "bad-bunny-test",
  "name": "Bad Bunny Test",
  "track_count": 194,
  "include_tracks": true,
  "limit": 50,
  "offset": 0,
  "returned_count": 50,
  "has_more": true,
  "tracks": []
}
```

Add a track:

```bash
curl -X POST http://localhost:3000/playlists/bad-bunny-test/tracks \
  -H "Content-Type: application/json" \
  -d '{"query":"bad bunny monaco","title":"MONACO","artist":"Bad Bunny","image_key":"cover-123"}'
```

Update playlist metadata:

```bash
curl -X PATCH http://localhost:3000/playlists/bad-bunny-test \
  -H "Content-Type: application/json" \
  -d '{"name":"Bad Bunny Test v0.10","description":"SQLite playlist"}'
```

Replace every track in a playlist:

```bash
curl -X PUT http://localhost:3000/playlists/bad-bunny-test/tracks \
  -H "Content-Type: application/json" \
  -d '{"tracks":[{"query":"bad bunny dakiti","title":"Dákiti"},{"query":"bad bunny monaco","title":"MONACO"}]}'
```

Full replacement is destructive and returns `requires_confirmation:true` unless
`confirm:true` is supplied in the JSON body. Pass `dry_run:true` to preview the
replacement without changing the playlist.

Retry resolution for missing, stale, ambiguous or failed entries, or force
re-resolution of all entries:

```bash
curl -X POST http://localhost:3000/playlists/bad-bunny-test/resolve \
  -H "Content-Type: application/json" \
  -d '{"force":false,"source_preference":"highest_quality"}'
```

Refresh only the audio metadata of already-resolved entries without changing
their recording identity:

```bash
curl -X POST http://localhost:3000/playlists/bad-bunny-test/metadata/refresh \
  -H "Content-Type: application/json" \
  -d '{"force":false}'
```

The refresh replaces the previous catalog observation atomically. It preserves
the selected recording identity and user metadata, verifies that the track,
album edition and artwork belong together, and returns `conflict` and
`unverified` counts alongside the legacy completed/partial/skipped/failed
totals. Each track stores `audio_metadata.metadata_status` as `exact`,
`partial`, `conflict` or `unverified`, plus separate `recording`, `release` and
`field_provenance` objects. Unverified external data is not copied into the
track merely to fill an empty field.

For one missing or ambiguous track, request fresh candidates and then persist
an explicit playable selection. The `result_id` is temporary, so the selection
must be submitted from the same active Roon search session:

```bash
curl "http://localhost:3000/playlists/bad-bunny-test/tracks/<TRACK_ID>/candidates?query=bad%20bunny%20monaco"

curl -X POST http://localhost:3000/playlists/bad-bunny-test/tracks/<TRACK_ID>/match \
  -H "Content-Type: application/json" \
  -d '{"result_id":"<RESULT_ID>","selection_reason":"explicit_user_selection"}'
```

`POST /playlists/:playlist_id/tracks/:track_id/repair` retries the strict
automatic resolver for just that entry. A successful manual or automatic
repair immediately runs metadata enrichment.

Update one track:

```bash
curl -X PATCH http://localhost:3000/playlists/bad-bunny-test/tracks/<TRACK_ID> \
  -H "Content-Type: application/json" \
  -d '{"query":"bad bunny monaco live","title":"MONACO (Live)","position":1}'
```

When `position` is provided, the track is moved to that 1-based position and
the remaining tracks are renumbered. Metadata-only updates without `position`
do not reorder the playlist.

Reorder tracks:

```bash
curl -X POST http://localhost:3000/playlists/bad-bunny-test/tracks/reorder \
  -H "Content-Type: application/json" \
  -d '{"track_ids":["<TRACK_ID_2>","<TRACK_ID_1>"]}'
```

Remove a track:

```bash
curl -X DELETE http://localhost:3000/playlists/bad-bunny-test/tracks/<TRACK_ID>
```

Deleting a playlist or removing a track requires confirmation. Without
`confirm:true`, the response includes `confirmation_reason`, `human_summary`,
`planned_action` and `confirm_payload`.

Play or enqueue a virtual playlist:

```bash
curl -X POST http://localhost:3000/playlists/bad-bunny-test/play \
  -H "Content-Type: application/json" \
  -d '{"zone_id":"<ZONE_ID>","mode":"add_to_queue"}'
```

Supported play modes:

- `add_to_queue`
- `add_next`
- `play_now`

For `play_now`, RoonIA resolves the first recording before replacing the queue.
If that identity is missing or ambiguous, the current queue is left unchanged.
After the first track starts, remaining identities are reconstructed and added
in order. A persisted `roon_item_key` is never sent back to Roon as an action
target.

Virtual playlists are local to RoonIA and are stored in `data/roonia.sqlite`.
On startup, legacy rows are enriched with persistent identity metadata without
changing their `track_id`; legacy Browse keys are marked `stale`. Legacy JSON
from `data/virtual-playlists.json` is migrated automatically when the SQLite
store is empty.

`GET /playlists` accepts `scope=saved|temporary|all` and defaults to `saved`,
so temporary working lists never appear in ordinary consumers by accident.
`POST /playlists/:playlist_id/promote` converts a non-expired temporary list
into a saved list in place and accepts optional `name` and `description`.

## MCP Tools

v0.6 added core local features through an MCP stdio server. v0.8 exposes the same MCP server over HTTP at `/mcp`, and v0.8.1 adds OAuth for a private ChatGPT app.

Remote MCP endpoint:

```text
https://roonia.ipchome.com/mcp
```

ChatGPT uses an OAuth access token. Direct administrative tests can use the static `API_TOKEN`.

Run from `/opt/roon-ai-bridge` after building:

```bash
DATA_DIR=/opt/roon-ai-bridge/data ENABLE_BROWSE=true npm run mcp
```

Implemented tools:

- `roon_status`
- `roon_list_zones`
- `roon_control_playback`
- `roon_change_volume`
- `roon_transfer_playback`
- `roon_group_zones`
- `roon_ungroup_zone`
- `roon_search`
- `roon_play_by_query`
- `roon_get_queue`
- `roon_queue_by_query`
- `roon_play_queue_item_from_here`
- `roon_list_virtual_playlists`
- `roon_create_virtual_playlist`
- `roon_get_virtual_playlist`
- `roon_update_virtual_playlist`
- `roon_delete_virtual_playlist`
- `roon_add_virtual_playlist_track`
- `roon_update_virtual_playlist_track`
- `roon_remove_virtual_playlist_track`
- `roon_replace_virtual_playlist_tracks`
- `roon_reorder_virtual_playlist_tracks`
- `roon_resolve_virtual_playlist`
- `roon_play_virtual_playlist`
- `roon_list_temporary_playlists`
- `roon_create_temporary_playlist`
- `roon_promote_temporary_playlist`
- `roon_search_media`
- `roon_analyze_playlist` optionally accepts one to ten `catalog_track_ids` for
  read-only MusicBrainz identity V2 diagnostics. In v0.20.0 beta.2 the result
  resolves recording and release identities separately, includes release-group
  ambiguity, duration provenance and edition-bound Cover Art Archive evidence.
  The returned `catalog_diagnostics` always declares `mode=shadow` and
  `mutates_playlist=false`.
  Beta.3 adds bounded provider traces with cache layer, request counts, search
  attempts and rejection reasons. A stored recording MBID is verified directly
  before a new search, and `stored_metadata_audit` reports legacy exact fields
  that lack release-track evidence.
  Beta.4 preserves search punctuation, treats remastering as release evidence,
  uses album observations as a reversible recording hint and can distinguish a
  duplicate recording only when one compatible candidate has unique ISRC
  evidence. Release diagnostics browse beyond the recording lookup's linked
  entities and expose `candidate_provider_trace`; a bounded browse that ends
  early returns `release_catalog_truncated_before_anchor` instead of declaring
  a false conflict. Legacy exact releases contradicted by the catalog report
  `stored_exact_release_conflicts_with_catalog`.
  Beta.5 no longer treats the mere presence of an ISRC as evidence: the code
  must match an observed ISRC or duplicates remain ambiguous. Legacy durations
  participate in matching only with Roon or release-track provenance. Release
  anchors are searched directly by recording MBID and title before bounded
  browsing, and observed year, disc and track positions may narrow an edition;
  MusicBrainz still has to verify the recording on the selected release track.
- `roon_get_media_details`
- `roon_list_artist_releases`
- `roon_play_media`
- `roon_start_radio`
- `roon_add_media_to_queue`
- `roon_list_outputs`
- `roon_seek`
- `roon_mute_output`
- `roon_change_output_volume`
- `roon_mute_all`
- `roon_pause_all`
- `roon_output_power`
- `roon_change_playback_settings`
- `roon_restart_queue`
- `roon_run_browse_action`
- `roon_get_image`

Read-only tools include status, zone/output listing, queue reads, media search,
media details, artist releases, image fetches and virtual playlist reads.
State-changing tools include playback, queue mutation, volume/mute, grouping,
playlist CRUD, media playback and output power/settings changes. Destructive or
audible tools should be exercised manually against a real Roon Core.

Important MCP contracts:

- `roon_list_zones` returns lightweight now-playing metadata by default. Pass
  `include_image_data: true` only when inline base64 artwork is required.
- `roon_search_media` is bound to typed search and never returns `roon_status`.
  Pass `include_images: true` only for embedded cover data.
- `roon_get_media_details` accepts a `result_id` from the same recent
  `roon_search_media` session.
- `roon_list_virtual_playlists` defaults to `include_tracks: false`; use
  `limit`, `offset`, `track_limit` and `track_offset` for bounded payloads.
- `roon_get_virtual_playlist` defaults to `include_tracks: true`, `limit: 50`
  and `offset: 0`; use `include_tracks: false` for metadata only.
- `roon_update_virtual_playlist_track` moves a track when `position` is
  supplied; use `roon_reorder_virtual_playlist_tracks` for full-order updates.
- `roon_control_playback` treats `pause` on paused zones and `play` on playing
  zones as successful idempotent states.
- `roon_change_volume` validates output ranges and returns refreshed output
  volume state after the command.

## Safe Live Tests

Automated tests do not perform audible playback and do not change real volume.
Any future integration tests against a real Roon Core must be gated behind:

```bash
ROONIA_ENABLE_LIVE_TESTS=true
```

Live volume tests must not raise volume and must respect these maximums:
Salon `35`, Despacho `35`, Cocina `19`. Destructive live tests should create
temporary resources prefixed with `roonia_test_` and clean them in `finally`
blocks.

## Administration Portal API

The portal on port `3001` uses protected same-origin endpoints:

- `GET /api/auth/status`
- `POST /api/auth/setup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/session`
- `GET /api/dashboard`
- `GET /api/admin/settings`
- `GET /api/admin/system`
- `PATCH /api/admin/system/ports`
- `PATCH /api/admin/system/update-preferences`
- `PATCH /api/admin/system/debug-preferences`
- `PATCH /api/admin/system/playlist-preferences`
- `POST /api/admin/system/update-channel`
- `POST /api/admin/system/check-update`
- `POST /api/admin/system/update`
- `POST /api/admin/system/restart`

`POST /api/admin/system/update-channel` accepts
`{"allow_beta_updates":true}` to enable beta updates. This does not change the
`installed_channel` reported by the system until an update is installed. A
stable installation can disable the preference again with
`{"allow_beta_updates":false}` and no strategy. To leave an installed beta, send
`allow_beta_updates:false` with one of these strategies:

- `install_stable`: writes an update request targeting `main` immediately. The
  stable release can be older than the installed beta.
- `wait_for_stable`: retains the installed beta, blocks newer beta updates and
  checks `main` daily. When the stable semantic version is equal to or newer
  than the retained beta, the service requests the `main` update automatically.

While the deferred strategy is active, `GET /api/admin/system` reports the
current beta update channel, `installed_channel:"beta"`,
`allow_beta_updates:false` and a `beta_exit_policy`
object describing the retained version.

`PATCH /api/admin/system/debug-preferences` accepts a required boolean
`debug_mode`. The value is persisted in `data/runtime-config.json` and is
returned by `/api/session`, `/api/admin/settings` and `/api/admin/system` so the
portal can apply the same visibility rules immediately and after restart.

`PATCH /api/admin/system/playlist-preferences` accepts
`temporary_playlist_expiry_days` from 1 through 365. The persisted value is
used for newly created temporary playlists; existing lists retain their own
expiration timestamp. When Debug mode is enabled, the portal exposes a
separate temporary-playlist section with the normal edit, playback and delete
controls plus promotion. Disabling Debug hides that section without deleting
its playlists.
- `GET /api/admin/api-keys`
- `POST /api/admin/api-keys`
- `DELETE /api/admin/api-keys/:key_id`
- CRUD and apply routes below `/api/admin/zone-presets`
- Read/write/apply routes below `/api/admin/output-volumes`

It also exposes existing Roon routes below `/api/roon/*` and playlist routes
below `/api/playlists/*`. Every portal API endpoint requires
`Authorization: Bearer <ADMIN_TOKEN>`.

```bash
curl -X POST http://localhost:3001/api/admin/api-keys \
  -H "Authorization: Bearer $PORTAL_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Home automation","role":"control"}'
```

Roles:

- `read`: read-only access to the main HTTP API.
- `control`: reads and mutating Roon/playlist requests.
- `admin`: control plus access to the portal and API-key management.

The creation response contains `token` once. List responses expose only
`key_prefix`; revocation is permanent.

## Advanced Transport And Outputs

- `GET /roon/outputs`
- `POST /roon/zones/:zone_id/seek`
- `POST /roon/zones/:zone_id/settings`
- `POST /roon/zones/:zone_id/queue/restart`
- `POST /roon/outputs/:output_id/mute`
- `POST /roon/outputs/:output_id/volume`
- `POST /roon/outputs/:output_id/power`
- `POST /roon/mute-all`
- `POST /roon/pause-all`
- `GET /roon/images/:image_key`
- `POST /roon/browse/action`

Power actions are `standby`, `toggle_standby` and `convenience_switch`. Seek
modes are `absolute` and `relative`. Playback settings accept `shuffle`,
`auto_radio` and `loop`.

`POST /roon/browse/action` executes an `item_key` in its existing Browse
session and can include `input` for `input_prompt`. Responses preserve native
`list`, `message`, `none`, `replace_item` and `remove_item` effects.

Queue restart plays from the first item returned by Roon; it does not clear or
rebuild the queue.

## Zones

```bash
curl http://localhost:3000/roon/zones
```

## Playback Control

```bash
curl -X POST http://localhost:3000/roon/zones/<ZONE_ID>/control \
  -H "Content-Type: application/json" \
  -d '{"command":"playpause"}'
```

Supported commands:

- `play`
- `pause`
- `playpause`
- `stop`
- `next`
- `previous`

## Zone Playback Transfer

```bash
curl -X POST http://localhost:3000/roon/zones/transfer \
  -H "Content-Type: application/json" \
  -d '{"source_zone_id":"<SOURCE_ZONE_ID>","target_zone_id":"<TARGET_ZONE_ID>"}'
```

The endpoint uses Roon's native `transfer_zone` command to move the current
queue and playback state. It does not reconstruct the queue from metadata.

## Zone Grouping

Preserve the primary zone queue and group compatible additional zones:

```bash
curl -X POST http://localhost:3000/roon/zones/group \
  -H "Content-Type: application/json" \
  -d '{"primary_zone_id":"<PRIMARY_ZONE_ID>","additional_zone_ids":["<ZONE_ID_2>","<ZONE_ID_3>"]}'
```

Fully split every output in a grouped zone:

```bash
curl -X POST http://localhost:3000/roon/zones/<GROUPED_ZONE_ID>/ungroup
```

Both operations wait for the Roon zone subscription to confirm the final
topology and return `state_verified: true`. Grouping preserves the queue of the
primary zone and replaces the independent queues of added zones.

## Volume

Relative:

```bash
curl -X POST http://localhost:3000/roon/zones/<ZONE_ID>/volume \
  -H "Content-Type: application/json" \
  -d '{"mode":"relative","value":1}'
```

Absolute:

```bash
curl -X POST http://localhost:3000/roon/zones/<ZONE_ID>/volume \
  -H "Content-Type: application/json" \
  -d '{"mode":"absolute","value":35}'
```

The API checks whether the zone has outputs with Roon volume control.
It always enforces Roon/device hard limits. RoonIA safe limits are evaluated in
this order: stable `output_id`, output name, zone name, then global fallback.

Initial safe limits:

- Salon / Salón: `35`
- Despacho: `35`
- Cocina: `19`

Volume responses include `volume_policy`:

```json
{
  "safe_limit_applied": true,
  "safe_limit": 35,
  "hard_limit": 60,
  "requires_confirmation": false,
  "reason": "within_safe_limit"
}
```

Increasing above the safe limit returns `requires_confirmation:true` unless
`confirm:true` is supplied. Decreases and increases within the safe limit
execute directly. Use `dry_run:true` to preview a volume change without sending
it to Roon.

## Zone Presets

Presets are RoonIA-owned entities and portal-only virtual zones. They do not
create real Roon zones.

- `GET /zone-presets`
- `POST /zone-presets`
- `GET /zone-presets/:preset_id`
- `PUT /zone-presets/:preset_id`
- `DELETE /zone-presets/:preset_id`
- `POST /zone-presets/:preset_id/apply`
- `POST /zone-presets/:preset_id/dry-run`

`apply` accepts `dry_run` and `confirm`. It returns resolved targets, planned
grouping/volume changes, before/after snapshots and safe-volume warnings or
confirmation requirements. Applying a preset does not start music or replace
queues.

## Volume Limits

- `GET /volume-limits`
- `POST /volume-limits`
- `GET /volume-limits/:limit_id`
- `PUT /volume-limits/:limit_id`
- `DELETE /volume-limits/:limit_id`
- `POST /volume-limits/evaluate`

Limits resolve by `output_id`, `zone_id`, `output_name`, `zone_name`, then
global fallback. Scheduled limits have priority over general limits for the
same target. Overlapping schedules for the same target are rejected.

## Prepared 501 Endpoints

These endpoints exist but are not implemented in v0.8.1:

- `GET /history`
- `GET /preferences`

## Error Format

```json
{
  "error": {
    "code": "ZONE_NOT_FOUND",
    "message": "Zone not found",
    "details": {}
  }
}
```

Planned error codes:

- `ROON_NOT_CONNECTED`
- `ROON_NOT_AUTHORIZED`
- `AUTH_REQUIRED`
- `AUTH_INVALID`
- `TRANSPORT_NOT_READY`
- `BROWSE_NOT_READY`
- `INVALID_SEARCH_QUERY`
- `SEARCH_NO_RESULTS`
- `PLAYBACK_ACTION_NOT_FOUND`
- `QUEUE_NOT_READY`
- `INVALID_QUEUE_ACTION`
- `INVALID_QUEUE_ITEM_ID`
- `QUEUE_ACTION_NOT_FOUND`
- `PLAYLIST_NOT_FOUND`
- `PLAYLIST_TRACK_NOT_FOUND`
- `INVALID_PLAYLIST`
- `INVALID_PLAYLIST_TRACK`
- `INVALID_PLAYLIST_PLAY_MODE`
- `ZONE_NOT_FOUND`
- `OUTPUT_NOT_FOUND`
- `UNSUPPORTED_COMMAND`
- `VOLUME_NOT_SUPPORTED`
- `INVALID_VOLUME_MODE`
- `INVALID_VOLUME_VALUE`
- `NOT_IMPLEMENTED`
- `INTERNAL_ERROR`
## Widget endpoints

RoonIA v0.15.0 exposes reusable widget contracts for ChatGPT Apps and the portal.
These endpoints return JSON state/action contracts and never embed artwork as base64
by default.

- `GET /widgets/now-playing`
- `POST /widgets/now-playing/action`
- `GET /widgets/playlists`
- `GET /widgets/playlists/:playlist_id`
- `POST /widgets/playlists/action`
- `GET /widgets/search`
- `POST /widgets/search`
- `POST /widgets/search/action`
- `GET /media/albums/:result_id`
- `GET /media/artists/:result_id`
- `GET /media/:result_id/catalog`
- `GET /roon/images/:image_key`
- `GET /media/images/:image_key`

The same contracts are available in the portal API under `/api/widgets/*`.

Example now-playing payload:

```json
{
  "widget_type": "now_playing",
  "selected_zone_id": "1601...",
  "zones": [
    {
      "zone_id": "1601...",
      "display_name": "Despacho",
      "state": "playing",
      "now_playing": {
        "title": "Everything In Its Right Place",
        "artist": "Radiohead",
        "album": "Kid A",
        "image_key": "...",
        "image_url": "/roon/images/..."
      },
      "actions": ["play_pause", "previous", "next", "volume_down", "volume_up"]
    }
  ]
}
```

## Portal connection administration

Authenticated portal administrators can inspect and manage AI connections:

- `GET /api/admin/connections`
- `POST /api/admin/connections/oauth/clients`
- `POST /api/admin/connections/oauth/clients/:client_id/revoke`
- `DELETE /api/admin/connections/oauth/clients/:client_id`
- `PATCH /api/admin/connections/oauth/pin`
- `POST /api/admin/connections/mcp-credentials`

The overview returns public endpoints, readiness checks and sanitized client
records. Access tokens are never returned. Creating an MCP credential returns
its Bearer token and generated configuration once; subsequent reads expose only
the key prefix and usage metadata.
