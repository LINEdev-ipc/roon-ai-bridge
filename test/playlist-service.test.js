const test = require("node:test");
const sharp = require("sharp");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PlaylistService } = require("../dist/services/playlistService");
const { enrichBrowseItem } = require("../dist/roon/roonBrowseService");

function tempConfig() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-playlists-"));
  return {
    dataDir,
    port: 3000,
    nodeEnv: "test",
    logLevel: "silent",
    roonExtensionName: "RoonIA",
    roonExtensionId: "test",
    enableBrowse: true,
    enableMcp: true,
    enableAuth: false,
    apiToken: null,
    publicBaseUrl: "http://localhost",
    oauthIssuer: "http://localhost",
    oauthApprovalPin: null,
    roonStreamingSource: "tidal"
  };
}

test("temporary playlists stay out of saved listings and promote in place", () => {
  const service = new PlaylistService(tempConfig());
  const saved = service.createPlaylist({ name: "Saved", tracks: [{ query: "saved track" }] });
  const temporary = service.savePreparedTemporaryPlaylist({
    name: "Cooking session",
    description: "A working mix",
    intent: "relaxed electronic music for cooking",
    expiry_days: 7,
    tracks: [
      { query: "Tycho Awake", title: "Awake", artist: "Tycho" },
      { query: "Bonobo Kerala", title: "Kerala", artist: "Bonobo" }
    ]
  });

  assert.equal(temporary.lifecycle.type, "temporary");
  assert.equal(temporary.lifecycle.intent, "relaxed electronic music for cooking");
  assert.ok(Date.parse(temporary.lifecycle.expires_at) > Date.now());
  assert.deepEqual(service.listPlaylists().playlists.map((item) => item.playlist_id), [saved.playlist_id]);
  assert.deepEqual(
    service.listPlaylists({ scope: "temporary" }).playlists.map((item) => item.playlist_id),
    [temporary.playlist_id]
  );
  assert.equal(service.listPlaylists({ scope: "all" }).total, 2);

  const originalTrackIds = temporary.tracks.map((track) => track.track_id);
  const promoted = service.promoteTemporaryPlaylist(temporary.playlist_id, {
    name: "Cooking electronics"
  });
  assert.equal(promoted.playlist_id, temporary.playlist_id);
  assert.equal(promoted.name, "Cooking electronics");
  assert.equal(promoted.lifecycle.type, "saved");
  assert.deepEqual(promoted.tracks.map((track) => track.track_id), originalTrackIds);
  assert.equal(service.listPlaylists({ scope: "temporary" }).total, 0);
  assert.equal(service.listPlaylists().total, 2);
  assert.throws(
    () => service.promoteTemporaryPlaylist(promoted.playlist_id),
    (error) => error.code === "PLAYLIST_NOT_TEMPORARY"
  );
});

test("expired temporary playlists are purged with their tracks", () => {
  const service = new PlaylistService(tempConfig());
  const temporary = service.savePreparedTemporaryPlaylist({
    name: "Short lived",
    intent: "test expiry",
    expiry_days: 1,
    tracks: [{ query: "one song", title: "One Song", artist: "Artist" }]
  });
  assert.equal(service.purgeExpiredTemporaryPlaylists(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)), 1);
  assert.equal(service.listPlaylists({ scope: "temporary" }).total, 0);
  assert.throws(
    () => service.getPlaylist(temporary.playlist_id),
    (error) => error.code === "PLAYLIST_NOT_FOUND"
  );
});

test("migrates legacy JSON playlists to SQLite and supports full track management", () => {
  const config = tempConfig();
  fs.writeFileSync(
    path.join(config.dataDir, "virtual-playlists.json"),
    JSON.stringify(
      {
        playlists: [
          {
            playlist_id: "legacy-mix",
            name: "Legacy Mix",
            description: "Migrated",
            created_at: "2026-01-01T10:00:00.000Z",
            updated_at: "2026-01-01T10:00:00.000Z",
            tracks: [
              {
                track_id: "legacy-track-1",
                query: "bad bunny dakiti",
                title: "Dákiti",
                artist: "Bad Bunny",
                album: "El Último Tour Del Mundo",
                position: 1
              }
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const service = new PlaylistService(config);
  const migrated = service.getPlaylist("legacy-mix");
  assert.equal(migrated.tracks_count, 1);
  assert.equal(migrated.tracks[0].query, "bad bunny dakiti");
  assert.match(migrated.tracks[0].identity.fingerprint, /^sha256:/);
  assert.equal(migrated.tracks[0].identity.title, migrated.tracks[0].title);
  assert.equal(migrated.tracks[0].resolution.status, "missing");

  const created = service.createPlaylist({
    name: "SQLite Mix",
    cover_image_key: "playlist-cover-1",
    tracks: [
      {
        query: "rosalia despecha",
        title: "Despechá",
        artist: "ROSALÍA",
        image_key: "img-1"
      },
      {
        query: "dua lipa houdini",
        title: "Houdini",
        artist: "Dua Lipa"
      }
    ]
  });

  assert.equal(created.tracks_count, 2);
  assert.equal(created.cover_image_key, "playlist-cover-1");
  assert.deepEqual(created.cover, { image_key: "playlist-cover-1" });
  assert.deepEqual(created.tracks[0].cover, { image_key: "img-1" });

  const renamed = service.updatePlaylist(created.playlist_id, {
    name: "SQLite Mix Updated",
    description: "Nueva descripción"
  });
  assert.equal(renamed.name, "SQLite Mix Updated");

  const updatedTrack = service.updateTrack(created.playlist_id, renamed.tracks[0].track_id, {
    query: "rosalia despecha live",
    title: "Despechá (Live)",
    artist: "ROSALÍA",
    album: "Festival",
    metadata: {
      image_key: "img-2",
      duration_seconds: 211
    }
  });
  assert.equal(updatedTrack.tracks[0].query, "rosalia despecha live");
  assert.deepEqual(updatedTrack.tracks[0].cover, { image_key: "img-2" });

  const reordered = service.reorderTracks(created.playlist_id, [
    updatedTrack.tracks[1].track_id,
    updatedTrack.tracks[0].track_id
  ]);
  assert.equal(reordered.tracks[0].title, "Houdini");
  assert.equal(reordered.tracks[1].position, 2);

  const replaced = service.replaceTracks(created.playlist_id, [
    {
      query: "the weeknd blinding lights",
      title: "Blinding Lights",
      artist: "The Weeknd",
      metadata: {
        image_key: "img-3",
        release_year: 2020
      }
    }
  ]);
  assert.equal(replaced.tracks_count, 1);
  assert.equal(replaced.tracks[0].metadata.release_year, 2020);

  const removed = service.removeTrack(created.playlist_id, replaced.tracks[0].track_id);
  assert.equal(removed.tracks_count, 0);

  assert.deepEqual(service.deletePlaylist(created.playlist_id), {
    ok: true,
    playlist_id: created.playlist_id
  });
});

test("enriches library items with normalized song metadata and cover payload", () => {
  const enriched = enrichBrowseItem({
    title: "Dákiti",
    subtitle: "Bad Bunny",
    image_key: "cover-123",
    artist: "Bad Bunny",
    album: "El Último Tour Del Mundo",
    track_number: 3,
    disc_number: 1,
    duration_seconds: 205,
    release_year: 2020
  });

  assert.deepEqual(enriched.media, {
    title: "Dákiti",
    subtitle: "Bad Bunny",
    artist: "Bad Bunny",
    album: "El Último Tour Del Mundo",
    album_artist: null,
    composer: null,
    genre: null,
    track_number: 3,
    disc_number: 1,
    duration_seconds: 205,
    release_year: 2020,
    roon_item_key: null,
    image_key: "cover-123",
    source: null,
    quality: null,
    cover: { image_key: "cover-123" }
  });
});

test("enriches library items without exposing Roon internal link ids", () => {
  const enriched = enrichBrowseItem({
    title: "Space 1.8",
    subtitle: "[[2562426|Nala Sinephro]]",
    artist: "[[2562426|Nala Sinephro]]",
    album: "[[30548830|Space 1.8]]"
  });

  assert.equal(enriched.title, "Space 1.8");
  assert.equal(enriched.subtitle, "Nala Sinephro");
  assert.equal(enriched.roon_linked_metadata, true);
  assert.equal(enriched.media.artist, "Nala Sinephro");
  assert.equal(enriched.media.album, "Space 1.8");
});

test("normalizes, serves and clears a validated custom playlist cover", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({ name: "Custom artwork" });
  const png = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 20, g: 40, b: 70 } }
  }).png().toBuffer();

  const updated = await service.setCustomCover(playlist.playlist_id, {
    image_base64: png.toString("base64"),
    content_type: "image/png"
  });
  assert.match(updated.cover_image_key, /^custom:.+\.webp$/);
  const stored = service.getCustomCover(updated.cover_image_key.slice("custom:".length));
  assert.equal(stored.content_type, "image/webp");
  assert.ok(stored.bytes.length > 20);
  assert.ok(stored.bytes.length <= 750 * 1024);
  const metadata = await sharp(stored.bytes).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 1024);
  assert.deepEqual(await service.inspectCustomCover(updated.cover_image_key.slice("custom:".length)), {
    cover_image_key: updated.cover_image_key,
    content_type: "image/webp",
    width: 1024,
    height: 1024,
    format: "webp",
    bytes: stored.bytes.length,
    color_space: "srgb"
  });

  const cleared = service.clearCustomCover(playlist.playlist_id);
  assert.equal(cleared.cover_image_key, null);
  assert.throws(
    () => service.getCustomCover(stored.cover_image_key.slice("custom:".length)),
    (error) => error.code === "PLAYLIST_COVER_NOT_FOUND"
  );
});

test("crops large playlist artwork to a manageable square WebP", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({ name: "Large artwork" });
  const source = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: { r: 31, g: 73, b: 122 } }
  }).png().toBuffer();

  const updated = await service.setCustomCover(playlist.playlist_id, {
    image_base64: source.toString("base64"),
    content_type: "image/png"
  });
  const stored = service.getCustomCover(updated.cover_image_key.slice("custom:".length));
  const metadata = await sharp(stored.bytes).metadata();

  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 1024);
  assert.equal(metadata.format, "webp");
  assert.ok(stored.bytes.length <= 750 * 1024);
});

test("rejects low-resolution playlist artwork instead of storing a blurry cover", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({ name: "Too small" });
  const source = await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 31, g: 73, b: 122 } }
  }).png().toBuffer();

  await assert.rejects(
    () => service.setCustomCover(playlist.playlist_id, {
      image_base64: source.toString("base64"),
      content_type: "image/png"
    }),
    (error) => error.code === "INVALID_PLAYLIST_COVER" &&
      error.details.received_width === 256 &&
      error.details.minimum_width === 768
  );
  assert.equal(service.getPlaylist(playlist.playlist_id).cover_image_key, null);
});

test("resolves playlist cover preflight references by ID or accent-insensitive exact name", () => {
  const service = new PlaylistService(tempConfig());
  const playlist = service.createPlaylist({ name: "Música nocturna" });

  assert.equal(service.getPlaylistByReference({ id: playlist.playlist_id }).playlist_id, playlist.playlist_id);
  assert.equal(service.getPlaylistByReference({ name: "musica nocturna" }).playlist_id, playlist.playlist_id);
  assert.throws(
    () => service.getPlaylistByReference({ name: "Otra lista" }),
    (error) => error.code === "PLAYLIST_NOT_FOUND"
  );
});

test("lists virtual playlists without tracks by default and paginates tracks explicitly", () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  service.createPlaylist({ name: "Empty" });
  const long = service.createPlaylist({
    name: "Long",
    tracks: Array.from({ length: 194 }, (_, index) => ({
      query: `song ${index + 1}`,
      title: `Song ${index + 1}`
    }))
  });

  const summaries = service.listPlaylists({
    includeTracks: false,
    limit: 10,
    offset: 0
  });
  assert.equal(summaries.total, 2);
  assert.equal(summaries.include_tracks, false);
  assert.equal(summaries.playlists.length, 2);
  assert.equal(summaries.playlists.find((playlist) => playlist.playlist_id === long.playlist_id).track_count, 194);
  assert.equal("tracks" in summaries.playlists[0], false);

  const paged = service.listPlaylists({
    includeTracks: true,
    limit: 10,
    offset: 0,
    trackLimit: 5,
    trackOffset: 10
  });
  const longPage = paged.playlists.find(
    (playlist) => playlist.playlist_id === long.playlist_id
  );
  assert.equal(paged.playlists.length, 2);
  assert.equal(longPage.tracks.length, 5);
  assert.equal(longPage.track_pagination.total, 194);
  assert.equal(longPage.track_pagination.offset, 10);
  assert.equal(longPage.tracks[0].position, 11);

  const outside = service.listPlaylists({
    includeTracks: true,
    limit: 10,
    offset: 99
  });
  assert.equal(outside.total, 2);
  assert.equal(outside.playlists.length, 0);
});

test("playlist summaries expose exact and partial total durations", () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const complete = service.createPlaylist({
    name: "Timed mix",
    tracks: [
      { query: "one", title: "One", duration_seconds: 3600 },
      { query: "two", title: "Two", audio_metadata: { duration_seconds: 1860 } }
    ]
  });
  const partial = service.createPlaylist({
    name: "Partial mix",
    tracks: [
      { query: "known", title: "Known", duration_seconds: 900 },
      { query: "unknown", title: "Unknown" }
    ]
  });

  const summaries = service.listPlaylists({ includeTracks: false, limit: 10 }).playlists;
  const completeSummary = summaries.find((playlist) => playlist.playlist_id === complete.playlist_id);
  const partialSummary = summaries.find((playlist) => playlist.playlist_id === partial.playlist_id);
  assert.equal(completeSummary.total_duration_seconds, 5460);
  assert.equal(completeSummary.duration_known_track_count, 2);
  assert.equal(partialSummary.total_duration_seconds, 900);
  assert.equal(partialSummary.duration_known_track_count, 1);

  const detail = service.getPlaylistDetail(complete.playlist_id, { includeTracks: false });
  assert.equal(detail.total_duration_seconds, 5460);
  assert.equal(detail.duration_known_track_count, 2);
});

test("gets one virtual playlist with paginated tracks or summary only", () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const empty = service.createPlaylist({ name: "Empty Detail" });
  const short = service.createPlaylist({
    name: "Short Detail",
    tracks: [
      { query: "one", title: "One" },
      { query: "two", title: "Two" }
    ]
  });
  const long = service.createPlaylist({
    name: "Long Detail",
    tracks: Array.from({ length: 80 }, (_, index) => ({
      query: `long ${index + 1}`,
      title: `Long ${index + 1}`
    }))
  });

  const summary = service.getPlaylistDetail(long.playlist_id, {
    includeTracks: false
  });
  assert.equal(summary.include_tracks, false);
  assert.equal(summary.track_count, 80);
  assert.equal(summary.returned_count, 0);
  assert.equal(summary.has_more, false);
  assert.equal("tracks" in summary, false);

  const page = service.getPlaylistDetail(long.playlist_id, {
    includeTracks: true,
    limit: 25,
    offset: 0
  });
  assert.equal(page.include_tracks, true);
  assert.equal(page.tracks.length, 25);
  assert.equal(page.returned_count, 25);
  assert.equal(page.has_more, true);
  assert.equal(page.tracks[0].position, 1);

  const outside = service.getPlaylistDetail(long.playlist_id, {
    includeTracks: true,
    limit: 25,
    offset: 999
  });
  assert.deepEqual(outside.tracks, []);
  assert.equal(outside.returned_count, 0);
  assert.equal(outside.has_more, false);

  const emptyPage = service.getPlaylistDetail(empty.playlist_id);
  assert.equal(emptyPage.track_count, 0);
  assert.deepEqual(emptyPage.tracks, []);
  assert.equal(emptyPage.has_more, false);

  const shortPage = service.getPlaylistDetail(short.playlist_id);
  assert.equal(shortPage.track_count, 2);
  assert.equal(shortPage.tracks.length, 2);
  assert.equal(shortPage.has_more, false);
});

test("update track position reorders only when position is provided", () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    name: "Position Mix",
    tracks: [
      { query: "one", title: "One" },
      { query: "two", title: "Two" },
      { query: "three", title: "Three" }
    ]
  });
  const [one, two, three] = playlist.tracks;

  const movedToFront = service.updateTrack(playlist.playlist_id, three.track_id, {
    query: three.query,
    title: three.title,
    position: 1
  });
  assert.deepEqual(
    movedToFront.tracks.map((track) => track.title),
    ["Three", "One", "Two"]
  );

  const movedToEnd = service.updateTrack(playlist.playlist_id, three.track_id, {
    query: three.query,
    title: "Three Updated",
    position: 3
  });
  assert.deepEqual(
    movedToEnd.tracks.map((track) => track.title),
    ["One", "Two", "Three Updated"]
  );

  const metadataOnly = service.updateTrack(playlist.playlist_id, one.track_id, {
    query: one.query,
    title: "One Updated",
    metadata: { note: "no position" }
  });
  assert.deepEqual(
    metadataOnly.tracks.map((track) => track.title),
    ["One Updated", "Two", "Three Updated"]
  );

  assert.throws(
    () =>
      service.updateTrack(playlist.playlist_id, two.track_id, {
        query: two.query,
        title: two.title,
        position: 4
      }),
    (error) => error.code === "INVALID_PLAYLIST_TRACK"
  );
});

test("invalid update track position leaves track fields unchanged", () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    name: "Atomicity Mix",
    tracks: [
      { query: "one", title: "One" },
      {
        query: "two",
        roon_item_key: "roon-two",
        title: "Two",
        artist: "Artist Two",
        album: "Album Two",
        metadata: {
          image_key: "image-two",
          note: "original"
        }
      },
      { query: "three", title: "Three" }
    ]
  });
  const target = playlist.tracks[1];

  assert.throws(
    () =>
      service.updateTrack(playlist.playlist_id, target.track_id, {
        query: "changed query",
        roon_item_key: "changed-key",
        title: "Changed",
        artist: "Changed Artist",
        album: "Changed Album",
        metadata: {
          image_key: "changed-image",
          note: "changed"
        },
        position: 99
      }),
    (error) => error.code === "INVALID_PLAYLIST_TRACK"
  );

  const after = service.getPlaylist(playlist.playlist_id);
  const unchanged = after.tracks.find((track) => track.track_id === target.track_id);
  assert.ok(unchanged);
  assert.equal(unchanged.position, target.position);
  assert.equal(unchanged.query, target.query);
  assert.equal(unchanged.roon_item_key, target.roon_item_key);
  assert.equal(unchanged.title, target.title);
  assert.equal(unchanged.artist, target.artist);
  assert.equal(unchanged.album, target.album);
  assert.equal(unchanged.image_key, target.image_key);
  assert.deepEqual(unchanged.metadata, target.metadata);
  assert.deepEqual(
    after.tracks.map((track) => track.title),
    ["One", "Two", "Three"]
  );
});

test("runs virtual playlist CRUD cleanup without leaking temporary resources", () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const created = service.createPlaylist({
    playlist_id: "roonia_test_crud",
    name: "roonia_test_crud",
    tracks: [{ query: "one", title: "One" }]
  });
  const added = service.addTrack(created.playlist_id, {
    query: "two",
    title: "Two"
  });
  const updated = service.updateTrack(
    created.playlist_id,
    added.tracks[0].track_id,
    { query: "one updated", title: "One Updated" }
  );
  const reordered = service.reorderTracks(created.playlist_id, [
    updated.tracks[1].track_id,
    updated.tracks[0].track_id
  ]);
  assert.equal(reordered.tracks[0].title, "Two");
  service.removeTrack(created.playlist_id, reordered.tracks[0].track_id);
  service.updatePlaylist(created.playlist_id, { name: "roonia_test_renamed" });
  service.deletePlaylist(created.playlist_id);

  assert.throws(
    () => service.getPlaylist(created.playlist_id),
    (error) => error.code === "PLAYLIST_NOT_FOUND"
  );
});

test("marks missing virtual playlist identities explicitly", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const mediaService = {
    async search(request) {
      assert.equal(request.query, "Imaginary Song Imaginary Artist");
      assert.deepEqual(request.types, ["track"]);
      assert.equal(request.sourcePreference, "streaming_first");
      return {
        query: request.query,
        source_preference: request.sourcePreference || "highest_quality",
        results: [],
        warnings: []
      };
    }
  };

  const playlist = await service.createPlaylistResolved(
    {
      name: "Unresolved Mix",
      tracks: [
        {
          title: "Imaginary Song",
          artist: "Imaginary Artist"
        }
      ]
    },
    { mediaService }
  );

  assert.equal(playlist.tracks_count, 1);
  assert.equal(playlist.tracks[0].query, "Imaginary Song Imaginary Artist");
  assert.equal(playlist.tracks[0].roon_item_key, null);
  assert.equal(playlist.tracks[0].metadata.resolution.status, "missing");
  assert.match(
    playlist.tracks[0].metadata.resolution.reason,
    /no_results/i
  );
});

test("resolves virtual playlist entries with the best playable track", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const mediaService = {
    async search(request) {
      assert.equal(request.query, "Red Right Hand Nick Cave & the Bad Seeds");
      assert.deepEqual(request.types, ["track"]);
      assert.equal(request.sourcePreference, "streaming_first");
      return {
        query: request.query,
        source_preference: request.sourcePreference || "highest_quality",
        warnings: [],
        results: [
          {
            result_id: "media_album",
            roon_item_key: "album-key",
            media_type: "album",
            title: "Red Right Hand",
            subtitle: "Nick Cave & the Bad Seeds",
            image_key: null,
            source: "tidal",
            source_confidence: "medium",
            quality: null,
            playable: true,
            expires_at: new Date().toISOString()
          },
          {
            result_id: "media_track",
            roon_item_key: "track-key",
            media_type: "track",
            title: "Red Right Hand",
            subtitle: "Nick Cave & the Bad Seeds",
            image_key: "cover-key",
            source: "tidal",
            source_confidence: "medium",
            quality: {
              label: "24-bit / 96 kHz / FLAC",
              bit_depth: 24,
              sample_rate_hz: 96000,
              format: "FLAC"
            },
            playable: true,
            expires_at: new Date().toISOString()
          }
        ]
      };
    }
  };

  const playlist = await service.createPlaylistResolved(
    {
      name: "Resolved Mix",
      tracks: [
        {
          title: "Red Right Hand",
          artist: "Nick Cave & the Bad Seeds",
          query: "Red Right Hand Nick Cave Bad Seeds"
        }
      ]
    },
    { mediaService }
  );

  assert.equal(playlist.tracks[0].roon_item_key, "track-key");
  assert.equal(playlist.tracks[0].metadata.resolution.status, "resolved");
  assert.equal(playlist.tracks[0].metadata.resolution.selected_candidate.title, "Red Right Hand");
  assert.equal(playlist.tracks[0].resolution.roon_item_key_persistent, false);
  assert.equal(playlist.tracks[0].roon_binding.state, "stale");
  assert.equal(playlist.tracks[0].image_key, "cover-key");
});

test("automatic resolver marks close low-metadata candidates ambiguous instead of resolved", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    name: "Ambiguous Mix",
    tracks: [{ title: "Same Song", artist: "Same Artist", query: "Same Song Same Artist" }]
  });
  const mediaService = {
    async search() {
      return {
        query: "Same Song Same Artist",
        source_preference: "highest_quality",
        warnings: [],
        results: [
          {
            result_id: "candidate-1",
            roon_item_key: "key-1",
            media_type: "track",
            title: "Same Song",
            subtitle: "Same Artist",
            artist: "Same Artist",
            album: null,
            source: "unknown",
            quality: null,
            is_library: null,
            playable: true,
            confidence: "low",
            version_hint: "studio"
          },
          {
            result_id: "candidate-2",
            roon_item_key: "key-2",
            media_type: "track",
            title: "Same Song",
            subtitle: "Same Artist",
            artist: "Same Artist",
            album: null,
            source: "unknown",
            quality: null,
            is_library: null,
            playable: true,
            confidence: "low",
            version_hint: "studio"
          }
        ]
      };
    }
  };

  const resolved = await service.resolveVirtualPlaylistItems(playlist.playlist_id, { mediaService });
  assert.equal(resolved.resolution[0].status, "ambiguous");
  const validation = service.validatePlaylist(playlist.playlist_id);
  assert.equal(validation.summary.resolved, 0);
  assert.equal(validation.summary.unresolved, 1);
  assert.equal(validation.summary.ambiguous, 1);
});

test("read-only virtual playlist operations do not update playlist updated_at", () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    name: "Read Only Mix",
    tracks: [{ query: "one", title: "One", roon_item_key: "roon-one" }]
  });
  const before = service.getPlaylist(playlist.playlist_id).updated_at;

  service.listPlaylists({ includeTracks: true });
  service.getPlaylistDetail(playlist.playlist_id);
  service.validatePlaylist(playlist.playlist_id);
  service.exportPlaylist(playlist.playlist_id, "json");
  service.exportPlaylist(playlist.playlist_id, "csv");
  service.exportPlaylist(playlist.playlist_id, "m3u");

  assert.equal(service.getPlaylist(playlist.playlist_id).updated_at, before);
});

test("phase 2 metadata model preserves user metadata and exposes audio metadata separately", () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    playlist_id: "peaky_blinders_soundtrack_complete",
    name: "Peaky Blinders",
    tracks: [
      {
        query: "Red Right Hand Nick Cave",
        title: "Red Right Hand",
        artist: "Nick Cave & The Bad Seeds",
        metadata: {
          season: 1,
          episode: 1,
          scene: "bar fight",
          notes: "Tema usado en escena de transicion",
          release_year: 1994
        }
      }
    ]
  });

  const track = playlist.tracks[0];
  assert.equal(track.user_metadata.season, 1);
  assert.equal(track.user_metadata.episode, 1);
  assert.equal(track.audio_metadata.release_year, 1994);
  assert.equal(track.metadata.season, 1);
  assert.equal(track.metadata.release_year, 1994);
});

test("phase 2 validation, dedupe, sort and export work without modifying on dry run", () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    name: "Phase 2 Mix",
    tracks: [
      {
        query: "Song B Artist",
        title: "Song B",
        artist: "Artist",
        roon_item_key: "roon-1",
        user_metadata: { season: 2, episode: 1 }
      },
      {
        query: "Song A Artist",
        title: "Song A",
        artist: "Artist",
        roon_item_key: "roon-1",
        user_metadata: { season: 1, episode: 2 }
      },
      {
        query: "Missing Metadata"
      }
    ]
  });

  const validation = service.validatePlaylist(playlist.playlist_id);
  assert.equal(validation.summary.unresolved, 3);
  assert.equal(validation.summary.stale, 2);
  assert.equal(validation.summary.missing, 1);
  assert.equal(validation.summary.missing_metadata, 3);
  assert.equal(validation.issues.some((issue) => issue.type === "duplicates"), false);

  const dedupe = service.deduplicatePlaylist(playlist.playlist_id, { dry_run: true });
  assert.equal(dedupe.groups.length, 0);

  const sorted = service.sortPlaylist(playlist.playlist_id, {
    dry_run: true,
    sort_by: [
      { field: "user_metadata.season", direction: "asc" },
      { field: "user_metadata.episode", direction: "asc" }
    ]
  });
  assert.deepEqual(sorted.tracks.slice(0, 2).map((track) => track.old_position), [2, 1]);

  const csv = service.exportPlaylist(playlist.playlist_id, "csv");
  assert.match(csv, /user_metadata.season/);
  assert.match(csv, /Song A/);
});

test("phase 2 manual selection and add-from-result keep user metadata", () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    name: "Manual Match",
    tracks: [
      {
        query: "Red Right Hand Nick Cave",
        user_metadata: { season: 1, episode: 1 }
      }
    ]
  });
  const mediaResult = {
    result_id: "media_manual",
    roon_item_key: "roon-manual",
    type: "track",
    media_type: "track",
    title: "Red Right Hand",
    artist: "Nick Cave & The Bad Seeds",
    album: "Let Love In",
    album_artist: "Nick Cave & The Bad Seeds",
    subtitle: "Nick Cave & The Bad Seeds",
    version_hint: "studio",
    image_key: "cover",
    source: "library",
    source_confidence: "high",
    quality: null,
    is_library: true,
    playable: true,
    match_score: 94,
    confidence: "high",
    match_reasons: ["exact_title"],
    match_penalties: [],
    warnings: [],
    expires_at: new Date(Date.now() + 10000).toISOString()
  };
  const mediaService = { get: () => mediaResult };

  const matched = service.setTrackMatch(
    playlist.playlist_id,
    playlist.tracks[0].track_id,
    "media_manual",
    { mediaService, selectionReason: "manual_user_selection" }
  );
  assert.equal(matched.tracks[0].roon_item_key, "roon-manual");
  assert.equal(matched.tracks[0].resolution.status, "manual");
  assert.equal(matched.tracks[0].user_metadata.season, 1);
  assert.equal(matched.tracks[0].audio_metadata.album, "Let Love In");

  const added = service.addSearchResultToPlaylist(
    playlist.playlist_id,
    { result_id: "media_manual", user_metadata: { mood: "dark" } },
    mediaService
  );
  assert.equal(added.tracks_count, 2);
  assert.equal(added.tracks[1].user_metadata.mood, "dark");
  assert.equal(added.tracks[1].resolution.status, "manual");
});

test("automatic resolver persists recording identity and only caches the last Roon item key", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const mediaService = {
    async search(request) {
      if (request.query === "Max Cooper Repetition") {
        return {
          query: request.query,
          source_preference: "highest_quality",
          warnings: [],
          results: [
            {
              result_id: "media_repetition_binaural",
              roon_item_key: "225:0",
              type: "track",
              media_type: "track",
              title: "Repetition 3D (Binaural Version - Headphones Only)",
              artist: "Max Cooper",
              subtitle: "Max Cooper",
              album: "Yearning for the Infinite",
              album_artist: null,
              version_hint: "alternate",
              version_penalties: ["alternate_3d", "binaural_version"],
              image_key: null,
              source: "library",
              source_confidence: "high",
              quality: null,
              is_library: true,
              playable: true,
              is_best_match: false,
              selection_required: false,
              match_score: 0,
              confidence: "medium",
              match_reasons: [],
              match_penalties: [],
              warnings: [],
              expires_at: new Date().toISOString()
            },
            {
              result_id: "media_repetition_clean",
              roon_item_key: "225:1",
              type: "track",
              media_type: "track",
              title: "Repetition",
              artist: "Max Cooper",
              subtitle: "Max Cooper",
              album: "Yearning for the Infinite",
              album_artist: null,
              version_hint: "studio",
              version_penalties: [],
              image_key: null,
              source: "library",
              source_confidence: "high",
              quality: null,
              is_library: true,
              playable: true,
              is_best_match: true,
              selection_required: false,
              match_score: 0,
              confidence: "high",
              match_reasons: [],
              match_penalties: [],
              warnings: [],
              expires_at: new Date().toISOString()
            }
          ]
        };
      }
      return {
        query: request.query,
        source_preference: "highest_quality",
        warnings: [],
        results: [
          {
            result_id: "media_angel_clean",
            roon_item_key: "223:0",
            type: "track",
            media_type: "track",
            title: "Angel",
            artist: "Massive Attack",
            subtitle: "Massive Attack",
            album: "Mezzanine",
            album_artist: null,
            version_hint: "studio",
            version_penalties: [],
            image_key: null,
            source: "library",
            source_confidence: "high",
            quality: null,
            is_library: true,
            playable: true,
            is_best_match: true,
            selection_required: false,
            match_score: 0,
            confidence: "high",
            match_reasons: [],
            match_penalties: [],
            warnings: [],
            expires_at: new Date().toISOString()
          },
          {
            result_id: "media_angel_remix",
            roon_item_key: "223:1",
            type: "track",
            media_type: "track",
            title: "Angel (Blur Remix)",
            artist: "Massive Attack",
            subtitle: "Massive Attack",
            album: "Mezzanine",
            album_artist: null,
            version_hint: "remix",
            version_penalties: ["remix_version"],
            image_key: null,
            source: "library",
            source_confidence: "high",
            quality: null,
            is_library: true,
            playable: true,
            is_best_match: false,
            selection_required: false,
            match_score: 0,
            confidence: "medium",
            match_reasons: [],
            match_penalties: [],
            warnings: [],
            expires_at: new Date().toISOString()
          }
        ]
      };
    }
  };

  const playlist = await service.createPlaylistResolved(
    {
      playlist_id: "roonia_test_playlist_20260709_retest",
      name: "RoonIA Test Playlist Retest",
      tracks: [
        {
          query: "Max Cooper Repetition",
          title: "Repetition",
          artist: "Max Cooper",
          album: "Yearning for the Infinite"
        },
        {
          query: "Massive Attack Angel",
          title: "Angel",
          artist: "Massive Attack",
          album: "Mezzanine"
        }
      ]
    },
    { mediaService }
  );

  assert.deepEqual(playlist.tracks.map((track) => track.roon_item_key), ["225:1", "223:0"]);
  assert.equal(playlist.tracks[0].resolution.selected_roon_item_key, "225:1");
  assert.equal(playlist.tracks[1].resolution.selected_roon_item_key, "223:0");
  assert.equal(playlist.tracks[0].resolution.status, "resolved");
  assert.equal(playlist.tracks[1].resolution.status, "resolved");
  assert.equal(playlist.tracks[0].resolution.roon_item_key_persistent, false);
  assert.equal(playlist.tracks[0].roon_binding.state, "stale");
  assert.match(playlist.tracks[0].identity.fingerprint, /^sha256:/);
  assert.equal(playlist.tracks[0].identity.title, "Repetition");

  const validation = service.validatePlaylist(playlist.playlist_id);
  assert.equal(validation.summary.resolved, 2);
  assert.equal(validation.summary.unresolved, 0);
  assert.equal(validation.summary.ambiguous, 0);
});

test("automatic resolver never stores high confidence for ambiguous or unselected matches", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    name: "Ambiguous Angel",
    tracks: [{ query: "Angel", title: "Angel" }]
  });
  const mediaService = {
    async search() {
      return {
        query: "Angel",
        source_preference: "highest_quality",
        warnings: [],
        results: [
          {
            result_id: "angel-one",
            roon_item_key: "one",
            type: "track",
            media_type: "track",
            title: "Angel",
            artist: "Massive Attack",
            subtitle: "Massive Attack",
            album: null,
            album_artist: null,
            version_hint: "studio",
            version_penalties: [],
            image_key: null,
            source: "unknown",
            source_confidence: "low",
            quality: null,
            is_library: null,
            playable: true,
            is_best_match: false,
            selection_required: true,
            match_score: 0,
            confidence: "low",
            match_reasons: [],
            match_penalties: [],
            warnings: [],
            expires_at: new Date().toISOString()
          },
          {
            result_id: "angel-two",
            roon_item_key: "two",
            type: "track",
            media_type: "track",
            title: "Angel",
            artist: "Sarah McLachlan",
            subtitle: "Sarah McLachlan",
            album: null,
            album_artist: null,
            version_hint: "studio",
            version_penalties: [],
            image_key: null,
            source: "unknown",
            source_confidence: "low",
            quality: null,
            is_library: null,
            playable: true,
            is_best_match: false,
            selection_required: true,
            match_score: 0,
            confidence: "low",
            match_reasons: [],
            match_penalties: [],
            warnings: [],
            expires_at: new Date().toISOString()
          }
        ]
      };
    }
  };

  await service.resolveVirtualPlaylistItems(playlist.playlist_id, { mediaService });
  const resolved = service.getPlaylist(playlist.playlist_id).tracks[0];

  assert.equal(resolved.roon_item_key, null);
  assert.equal(resolved.resolution.status, "ambiguous");
  assert.notEqual(resolved.resolution.confidence, "high");
  assert.equal(resolved.resolution.selected_roon_item_key, null);
});

test("play_now virtual playlist replaces the queue then starts verified playback", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    name: "Playback Smoke",
    tracks: [
      { query: "first track noisy text", roon_item_key: "stored:first", title: "First", artist: "Artist One" },
      { query: "second track noisy text", roon_item_key: "stored:second", title: "Second", artist: "Artist Two" },
      { query: "third track noisy text", roon_item_key: "stored:third", title: "Third", artist: "Artist Three" }
    ]
  });
  const calls = [];
  const zone = {
    zone_id: "office",
    display_name: "Office",
    state: "paused",
    is_play_allowed: true
  };
  const lastBrowseItemKeyBySession = new Map();
  const searchInputBySession = new Map();
  const browse = {
    browse(opts, callback) {
      calls.push({ type: "browse", opts });
      lastBrowseItemKeyBySession.set(
        opts.multi_session_key,
        typeof opts.item_key === "string" ? opts.item_key : null
      );
      if (typeof opts.input === "string") {
        searchInputBySession.set(opts.multi_session_key, opts.input);
      }
      callback(false, { action: opts.item_key?.startsWith("action:") ? "message" : "list" });
    },
    load(opts, callback) {
      calls.push({ type: "load", opts });
      const lastItemKey = lastBrowseItemKeyBySession.get(opts.multi_session_key);
      const query = searchInputBySession.get(opts.multi_session_key) || "unknown";
      const isFirst = query === "Artist One First";
      const actionTitle = isFirst ? "Play now" : "Add to queue";
      const actionKey = isFirst ? "action:play" : "action:add-to-queue";
      const items = lastItemKey?.startsWith("stored:")
        ? []
        : lastItemKey
          ? [{ title: actionTitle, item_key: actionKey, hint: "action" }]
          : [{ title: query, item_key: `result:${query}`, hint: "track" }];
      callback(false, { list: { level: 0, title: "Search", count: items.length }, items });
    }
  };
  const transport = {
    control(_zone, command, callback) {
      calls.push({ type: "control", command });
      if (command === "play") zone.state = "playing";
      callback(false);
    }
  };
  const roonClient = {
    isCoreConnected: () => true,
    isBrowseReady: () => true,
    getBrowse: () => browse,
    getZone: (zoneId) => zoneId === zone.zone_id ? zone : null,
    isTransportReady: () => true,
    getTransport: () => transport
  };

  const result = await service.playPlaylist(roonClient, playlist.playlist_id, {
    zone_id: "office",
    mode: "play_now",
    session_key: "playlist-session"
  });

  assert.equal(result.ok, true);
  assert.equal(result.succeeded, 3);
  assert.equal(result.failed, 0);
  assert.equal(result.playback.command, "play");
  assert.equal(result.playback.state_verified, true);
  assert.ok(result.last_played_at);
  assert.equal(service.getPlaylist(playlist.playlist_id).last_played_at, result.last_played_at);
  assert.equal(
    service.listPlaylists().playlists[0].last_played_at,
    result.last_played_at
  );
  assert.equal(zone.state, "playing");
  assert.deepEqual(
    calls
      .filter((call) => call.type === "browse" && call.opts.item_key?.startsWith("action:"))
      .map((call) => call.opts.item_key),
    ["action:play", "action:add-to-queue", "action:add-to-queue"]
  );
  assert.deepEqual(
    calls
      .filter((call) => call.type === "browse" && call.opts.item_key?.startsWith("stored:"))
      .map((call) => call.opts.item_key),
    []
  );
  assert.deepEqual(
    calls
      .filter((call) => call.type === "browse" && call.opts.input)
      .map((call) => call.opts.input),
    ["Artist One First", "Artist Two Second", "Artist Three Third"]
  );
  assert.equal(calls.at(-1).type, "control");
  assert.equal(calls.at(-1).command, "play");
});

test("production playlist playback reconstructs fresh media references from persistent identities", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    name: "Fresh References",
    tracks: [
      { query: "old noisy one", roon_item_key: "stale:one", title: "One", artist: "Artist", album: "Album" },
      { query: "old noisy two", roon_item_key: "stale:two", title: "Two", artist: "Artist", album: "Album" }
    ]
  });
  service.updateTrackAudioMetadata(playlist.playlist_id, playlist.tracks[0].track_id, {
    title: "One",
    artist: "Artist",
    album: "Verified Album",
    duration_seconds: 321,
    metadata_status: "exact",
    release: { title: "Verified Album", verified_by: "test" }
  }, {
    status: "completed",
    metadata_status: "exact",
    observed_at: new Date().toISOString()
  });
  const searches = [];
  const plays = [];
  const mediaService = {
    async search(request) {
      searches.push(request);
      const title = request.query.includes("Two") ? "Two" : "One";
      return {
        results: [{
          result_id: `fresh:${title}`,
          roon_item_key: `fresh-key:${title}`,
          type: "track",
          media_type: "track",
          title,
          artist: "Artist",
          subtitle: "Artist",
          album: "Album",
          album_artist: "Artist",
          version_hint: "studio",
          version_penalties: [],
          source: "library",
          source_confidence: "high",
          quality: null,
          image_key: null,
          is_library: true,
          playable: true,
          is_best_match: true,
          selection_required: false,
          match_score: 100,
          confidence: "high",
          match_reasons: [],
          match_penalties: [],
          warnings: [],
          expires_at: new Date(Date.now() + 60000).toISOString()
        }],
        warnings: []
      };
    },
    async play(resultId, zoneId, mode) {
      plays.push({ resultId, zoneId, mode });
      return { ok: true, result_id: resultId, mode };
    }
  };
  let controlCalls = 0;
  const zone = { zone_id: "office", state: "paused", is_play_allowed: true };
  const roonClient = {
    isCoreConnected: () => true,
    getZone: () => zone,
    isTransportReady: () => true,
    getTransport: () => ({
      control(_zone, command, callback) {
        controlCalls += 1;
        if (command === "play") zone.state = "playing";
        callback(false);
      }
    })
  };

  const result = await service.playPlaylist(
    roonClient,
    playlist.playlist_id,
    { zone_id: "office", mode: "play_now" },
    { mediaService }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(searches.map((request) => request.query), ["One Artist", "Two Artist"]);
  assert.deepEqual(plays.map((call) => call.mode), ["replace_queue", "append"]);
  assert.deepEqual(plays.map((call) => call.resultId), ["fresh:One", "fresh:Two"]);
  assert.equal(controlCalls, 1);
  assert.ok(result.results.every((entry) => entry.cached_roon_item_key_used === false));
  const playedTrack = service.getPlaylist(playlist.playlist_id).tracks[0];
  assert.equal(playedTrack.audio_metadata.album, "Verified Album");
  assert.equal(playedTrack.audio_metadata.duration_seconds, 321);
  assert.equal(playedTrack.audio_metadata.metadata_status, "exact");
  assert.equal(playedTrack.resolution.metadata_enrichment.metadata_status, "exact");
});

test("playback retries the original resolved query when enriched artist credits are too restrictive", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    name: "Enriched credits",
    tracks: [{
      query: "Chimes Hudson Mohawke",
      title: "Chimes",
      artist: "Hudson Mohawke, Ross Birchard",
      album: "Lantern",
      audio_metadata: {
        title: "Chimes",
        artist: "Hudson Mohawke, Ross Birchard",
        album: "Lantern",
        release_year: 2015,
        version_hint: "studio",
        source: "tidal"
      },
      resolution: {
        status: "resolved",
        score: 120,
        reason: "selected_equivalent_recording"
      }
    }]
  });
  const searches = [];
  const plays = [];
  const mediaService = {
    async search(request) {
      searches.push(request);
      if (request.query !== "Chimes Hudson Mohawke") {
        return { results: [], warnings: [] };
      }
      return {
        results: [{
          result_id: "fresh:chimes",
          roon_item_key: "fresh-key:chimes",
          type: "track",
          media_type: "track",
          title: "Chimes",
          artist: "Hudson Mohawke",
          artists: [{ type: "artist", title: "Hudson Mohawke", artist: null, result_id: null }],
          subtitle: "Hudson Mohawke",
          album: "Lantern",
          album_artist: "Hudson Mohawke",
          release_year: 2015,
          version_hint: "studio",
          version_penalties: [],
          source: "tidal",
          source_confidence: "high",
          quality: null,
          image_key: null,
          is_library: false,
          playable: true,
          is_best_match: true,
          selection_required: false,
          match_score: 100,
          confidence: "high",
          match_reasons: [],
          match_penalties: [],
          warnings: [],
          expires_at: new Date(Date.now() + 60000).toISOString()
        }],
        warnings: []
      };
    },
    async play(resultId, zoneId, mode) {
      plays.push({ resultId, zoneId, mode });
      return { ok: true, result_id: resultId, mode };
    }
  };
  const zone = { zone_id: "office", state: "paused", is_play_allowed: true };
  const roonClient = {
    isCoreConnected: () => true,
    getZone: () => zone,
    isTransportReady: () => true,
    getTransport: () => ({
      control(_zone, command, callback) {
        if (command === "play") zone.state = "playing";
        callback(false);
      }
    })
  };

  const result = await service.playPlaylist(
    roonClient,
    playlist.playlist_id,
    { zone_id: "office", mode: "play_now" },
    { mediaService }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(searches.map((request) => request.query), [
    "Chimes Hudson Mohawke, Ross Birchard",
    "Chimes Hudson Mohawke"
  ]);
  assert.ok(searches.every((request) => request.strategy.prefer_original_album === true));
  assert.deepEqual(plays, [{ resultId: "fresh:chimes", zoneId: "office", mode: "replace_queue" }]);
  assert.equal(service.getPlaylist(playlist.playlist_id).tracks[0].resolution.status, "resolved");
});

test("playback accepts equivalent Roon editions for a canonical MusicBrainz recording", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const catalog = {
    status: "exact",
    reason: "unique_compatible_recording",
    fetched_at: "2026-07-28T10:00:00.000Z",
    recording: {
      musicbrainz_id: "mb-hours",
      title: "Hours",
      disambiguation: null,
      video: false,
      duration_seconds: 344,
      duration_source: "musicbrainz_recording_median",
      artist_credit: [{ musicbrainz_id: "mb-tycho", name: "Tycho", join_phrase: "" }],
      isrcs: ["US2J71104502"]
    },
    composers: [],
    lyricists: [],
    genres: [],
    release_group: {
      musicbrainz_id: "mb-dive",
      title: "Dive",
      artist_credit: [{ musicbrainz_id: "mb-tycho", name: "Tycho", join_phrase: "" }],
      first_release_date: "2011-10-04",
      release_year: 2011,
      primary_type: "Album",
      secondary_types: [],
      disambiguation: null,
      selection_reason: "earliest_official_album"
    },
    release: null,
    work: null,
    credits: [],
    cover_art: null,
    roon_binding: null,
    provenance: { canonical_metadata: "musicbrainz", cover_art: null, playback: null },
    warnings: []
  };
  const playlist = service.createPlaylist({
    name: "Canonical playback",
    tracks: [{
      query: "Hours Tycho",
      title: "Hours",
      artist: "Tycho",
      album: "Dive",
      audio_metadata: {
        title: "Hours",
        artist: "Tycho",
        album: "Dive",
        duration_seconds: 344,
        source: "tidal",
        metadata_status: "exact",
        catalog
      },
      resolution: { status: "resolved", selected_result_id: "old-hours" }
    }]
  });
  const candidate = (id, album) => ({
    result_id: id,
    roon_item_key: `key:${id}`,
    type: "track",
    media_type: "track",
    title: "Hours",
    artist: "Tycho, Zac Brown",
    artists: [
      { type: "artist", title: "Tycho", artist: null, result_id: null },
      { type: "artist", title: "Zac Brown", artist: null, result_id: null }
    ],
    subtitle: "Tycho, Zac Brown",
    album,
    album_artist: "Tycho",
    duration_seconds: 344,
    version_hint: "studio",
    version_penalties: [],
    source: "tidal",
    source_confidence: "high",
    quality: null,
    image_key: null,
    is_library: false,
    playable: true,
    is_best_match: false,
    selection_required: true,
    match_score: 100,
    confidence: "high",
    match_reasons: [],
    match_penalties: [],
    warnings: [],
    expires_at: new Date(Date.now() + 60_000).toISOString()
  });
  const plays = [];
  const mediaService = {
    async search(request) {
      const results = [candidate("hours-us", "Dive"), candidate("hours-eu", "Dive (Deluxe)")];
      return {
        query: request.query,
        results,
        recommended_result_id: null,
        selection_required: true,
        warnings: []
      };
    },
    async play(resultId, zoneId, mode) {
      plays.push({ resultId, zoneId, mode });
      return { ok: true };
    }
  };
  const zone = { zone_id: "office", state: "paused", is_play_allowed: true };
  const roonClient = {
    isCoreConnected: () => true,
    getZone: () => zone,
    isTransportReady: () => true,
    getTransport: () => ({
      control(_zone, command, callback) {
        if (command === "play") zone.state = "playing";
        callback(false);
      }
    })
  };

  const result = await service.playPlaylist(
    roonClient,
    playlist.playlist_id,
    { zone_id: "office", mode: "play_now" },
    { mediaService }
  );
  const stored = service.getPlaylist(playlist.playlist_id).tracks[0];

  assert.equal(result.ok, true);
  assert.deepEqual(plays, [{ resultId: "hours-us", zoneId: "office", mode: "replace_queue" }]);
  assert.equal(stored.artist, "Tycho");
  assert.equal(stored.album, "Dive");
  assert.equal(stored.audio_metadata.catalog.recording.musicbrainz_id, "mb-hours");
  assert.equal(stored.resolution.status, "resolved");
});

test("a transient ambiguous playback search does not degrade a stored canonical binding", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    name: "Durable binding",
    tracks: [{
      query: "Hours Tycho",
      title: "Hours",
      artist: "Tycho",
      album: "Dive",
      roon_item_key: "stored-hours",
      audio_metadata: {
        title: "Hours",
        artist: "Tycho",
        album: "Dive",
        duration_seconds: 344,
        source: "tidal",
        metadata_status: "exact",
        catalog: {
          status: "exact",
          recording: {
            musicbrainz_id: "mb-hours",
            title: "Hours",
            artist_credit: [{ name: "Tycho", join_phrase: "" }],
            duration_seconds: 344,
            isrcs: []
          },
          release_group: { musicbrainz_id: "mb-dive", title: "Dive", release_year: 2011 },
          composers: [],
          lyricists: [],
          genres: []
        }
      },
      resolution: { status: "resolved", selected_result_id: "stored-result" }
    }]
  });
  const wrongCandidate = (id) => ({
    result_id: id,
    roon_item_key: `key:${id}`,
    type: "track",
    media_type: "track",
    title: "Hours (Live)",
    artist: "Tycho",
    subtitle: "Tycho",
    album: "Live",
    version_hint: "live",
    version_penalties: [],
    source: "tidal",
    source_confidence: "high",
    playable: true,
    selection_required: true,
    match_score: 90,
    confidence: "medium",
    match_reasons: [],
    match_penalties: [],
    warnings: [],
    expires_at: new Date(Date.now() + 60_000).toISOString()
  });
  const result = await service.playPlaylist(
    {
      getZone: () => ({ zone_id: "office", state: "playing", is_play_allowed: true }),
      isTransportReady: () => true,
      getTransport: () => ({ control() {} })
    },
    playlist.playlist_id,
    { zone_id: "office", mode: "play_now" },
    {
      mediaService: {
        async search() {
          return {
            results: [wrongCandidate("live-one"), wrongCandidate("live-two")],
            recommended_result_id: null,
            selection_required: true,
            warnings: []
          };
        },
        async play() {
          throw new Error("must not play a different version");
        }
      }
    }
  );
  const stored = service.getPlaylist(playlist.playlist_id).tracks[0];

  assert.equal(result.ok, false);
  assert.equal(stored.resolution.status, "resolved");
  assert.equal(stored.resolution.selected_result_id, "stored-result");
  assert.equal(stored.audio_metadata.catalog.recording.musicbrainz_id, "mb-hours");
});

test("play_now leaves the current queue untouched when the first identity is ambiguous", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const playlist = service.createPlaylist({
    name: "Ambiguous Start",
    tracks: [
      { query: "Same Song Artist", title: "Same Song", artist: "Artist" },
      { query: "Second Song Artist", title: "Second Song", artist: "Artist" }
    ]
  });
  let playCalls = 0;
  let controlCalls = 0;
  const candidate = (id) => ({
    result_id: id,
    roon_item_key: `key:${id}`,
    type: "track",
    media_type: "track",
    title: "Same Song",
    artist: "Artist",
    subtitle: "Artist",
    album: null,
    album_artist: null,
    version_hint: "studio",
    version_penalties: [],
    source: "unknown",
    source_confidence: "low",
    quality: null,
    image_key: null,
    is_library: null,
    playable: true,
    is_best_match: false,
    selection_required: true,
    match_score: 0,
    confidence: "low",
    match_reasons: [],
    match_penalties: [],
    warnings: [],
    expires_at: new Date(Date.now() + 60000).toISOString()
  });
  const mediaService = {
    async search() {
      return { results: [candidate("one"), candidate("two")], warnings: [] };
    },
    async play() {
      playCalls += 1;
      return { ok: true };
    }
  };
  const roonClient = {
    getZone: () => ({ zone_id: "office", state: "playing", is_play_allowed: true }),
    isTransportReady: () => true,
    getTransport: () => ({ control() { controlCalls += 1; } })
  };

  const result = await service.playPlaylist(
    roonClient,
    playlist.playlist_id,
    { zone_id: "office", mode: "play_now" },
    { mediaService }
  );

  assert.equal(result.ok, false);
  assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 2);
  assert.equal(result.last_played_at, null);
  assert.equal(service.getPlaylist(playlist.playlist_id).last_played_at, null);
  assert.equal(result.failures[0].error.code, "PLAYLIST_TRACK_AMBIGUOUS");
  assert.equal(result.failures[1].error.code, "PLAYLIST_START_ABORTED");
  assert.equal(playCalls, 0);
  assert.equal(controlCalls, 0);
});

test("playlist duplicate lookup matches existing recording identity before an add", () => {
  const service = new PlaylistService(tempConfig());
  const playlist = service.createPlaylist({
    name: "Existing recordings",
    tracks: [{
      query: "Teardrop Massive Attack",
      title: "Teardrop",
      artist: "Massive Attack",
      album: "Mezzanine"
    }]
  });

  const duplicate = service.findDuplicateTrack(playlist.playlist_id, {
    query: "Teardrop Massive Attack",
    title: "Teardrop",
    artist: "Massive Attack",
    album: "Collected"
  });
  assert.equal(duplicate.track_id, playlist.tracks[0].track_id);
  assert.equal(service.findDuplicateTrack(playlist.playlist_id, {
    query: "Angel Massive Attack",
    title: "Angel",
    artist: "Massive Attack"
  }), null);
});
