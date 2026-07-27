const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { WidgetV2ViewService } = require("../dist/bridge-v2/widgets/viewService");
const { createDatabase } = require("../dist/db/database");
const { PlaylistService } = require("../dist/services/playlistService");

function media(id, type, title, overrides = {}) {
  return {
    result_id: id,
    type,
    media_type: type,
    title,
    artist: type === "artist" ? null : "Radiohead",
    album: type === "track" ? "Kid A" : null,
    album_artist: "Radiohead",
    subtitle: "Radiohead",
    version_hint: "studio",
    image_key: `image-${id}`,
    source: "qobuz",
    source_confidence: "high",
    quality: { label: "24-bit / 96 kHz", bit_depth: 24, sample_rate_hz: 96000, format: "FLAC" },
    is_library: false,
    playable: true,
    match_score: 95,
    confidence: "high",
    match_reasons: [],
    match_penalties: [],
    version_penalties: [],
    warnings: [],
    expires_at: new Date(Date.now() + 60000).toISOString(),
    ...overrides
  };
}

function zone(id, name, state, title, outputs) {
  return {
    zone_id: id,
    display_name: name,
    state,
    now_playing: {
      image_key: `now-${id}`,
      three_line: { line1: title, line2: "Radiohead", line3: "Kid A" }
    },
    outputs,
    settings: { shuffle: false, auto_radio: false, loop: "disabled" }
  };
}

function output(id, name, value, muted = false) {
  return {
    output_id: id,
    display_name: name,
    volume: { type: "number", min: 0, max: 60, value, step: 1, is_muted: muted }
  };
}

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-widget-v19-"));
  const config = { dataDir, publicBaseUrl: "https://example.test", enableAuth: false, apiToken: null };
  const database = createDatabase(config);
  const playlists = new PlaylistService(config, database);
  playlists.createPlaylist({
    playlist_id: "focus",
    name: "Focus",
    description: "Concentración sin distracciones.",
    cover_image_key: "custom:custom-cover",
    tracks: [{
      track_id: "t1",
      query: "Everything",
      title: "Everything In Its Right Place",
      artist: "Radiohead",
      album: "Kid A",
      image_key: "cover-1"
    }]
  });

  const zones = [
    zone("zone-office", "Despacho", "playing", "Everything In Its Right Place", [
      output("out-left", "Despacho izquierdo", 18),
      output("out-right", "Despacho derecho", 21, true)
    ]),
    zone("zone-kitchen", "Cocina", "playing", "Idioteque", [output("out-kitchen", "Cocina", 12)]),
    zone("zone-lounge", "Salón", "paused", "How to Disappear Completely", [output("out-lounge", "Salón", 15)])
  ];
  const outputs = zones.flatMap((item) => item.outputs);
  const artist = media("artist-1", "artist", "Radiohead");
  const album = media("album-1", "album", "Kid A", { release_year: 2000 });
  const track = media("track-1", "track", "Everything In Its Right Place", { duration_seconds: 251 });
  const refs = new Map([[artist.result_id, artist], [album.result_id, album], [track.result_id, track]]);
  const context = {
    config,
    roonClient: {
      getZones: () => zones,
      getZone: (id) => zones.find((item) => item.zone_id === id) || null,
      getOutputs: () => outputs,
      getOutput: (id) => outputs.find((item) => item.output_id === id) || null,
      getTransport: () => ({
        subscribe_queue(zone, count, callback) {
          callback("Subscribed", {
            items: [{
              queue_item_id: 41,
              length: 289,
              image_key: "queue-cover",
              one_line: { line1: "Pyramid Song - Radiohead" },
              two_line: { line1: "Pyramid Song", line2: "Radiohead" },
              three_line: { line1: "Pyramid Song", line2: "Radiohead", line3: "Amnesiac" }
            }].slice(0, count)
          });
          return { unsubscribe(done) { if (done) done(); } };
        }
      }),
      isCoreConnected: () => true,
      getCoreName: () => "Test Core",
      isTransportReady: () => true,
      isBrowseReady: () => true,
      isImageReady: () => true
    },
    playlistService: playlists,
    volumeLimitService: {
      findActiveLimit: (_zone, candidate) => candidate.output_id === "out-left"
        ? { limit_id: "safe-office", name: "Despacho seguro", safe_max: 25 }
        : null
    },
    mediaService: {
      search: async () => ({
        query: "Radiohead",
        results: [artist, album, track],
        recommended_result_id: artist.result_id,
        selection_required: false,
        ambiguous: false,
        warnings: []
      }),
      get: (id) => refs.get(id),
      getArtistDetail: async () => ({
        artist,
        bio: "English alternative rock band.",
        popular_tracks: [track],
        albums: [album],
        singles_eps: [],
        warnings: []
      }),
      getAlbumDetail: async () => ({
        album,
        description: "A landmark album.",
        tracks: [track],
        warnings: []
      })
    }
  };
  return { database, context };
}

test("now-playing shows only active zones and every grouped output volume", () => {
  const { database, context } = fixture();
  try {
    const view = new WidgetV2ViewService(context).nowPlaying();
    assert.equal(view.view, "now_playing");
    assert.deepEqual(view.zones.map((item) => item.name), ["Despacho", "Cocina"]);
    assert.equal(view.zones[0].media.title, "Everything In Its Right Place");
    assert.equal(view.zones[0].media.image_key, "now-zone-office");
    assert.equal(view.zones[0].media.image_url, null);
    assert.deepEqual(view.zones[0].outputs.map((item) => [item.name, item.volume.value, item.volume.muted]), [
      ["Despacho izquierdo", 18, false],
      ["Despacho derecho", 21, true]
    ]);
  } finally { database.close(); }
});

test("now-playing filters a named zone and omits it when it is idle", () => {
  const { database, context } = fixture();
  try {
    const service = new WidgetV2ViewService(context);
    const office = service.nowPlaying({ zone: { name: "Despacho" } });
    assert.deepEqual(office.zones.map((item) => item.name), ["Despacho"]);
    const lounge = service.nowPlaying({ zone: { name: "Salón" } });
    assert.equal(lounge.requested_zone.name, "Salón");
    assert.deepEqual(lounge.zones, []);
  } finally { database.close(); }
});

test("now-playing keeps artwork as a private image reference before hydration", () => {
  const { database, context } = fixture();
  context.config.enableAuth = true;
  context.config.apiToken = "private-test-token";
  try {
    const view = new WidgetV2ViewService(context).nowPlaying({ zone: { id: "zone-office" } });
    assert.equal(view.zones[0].media.image_key, "now-zone-office");
    assert.equal(view.zones[0].media.image_url, null);
  } finally { database.close(); }
});

test("media adapts to artist, album and ambiguous search results", async () => {
  const { database, context } = fixture();
  try {
    const service = new WidgetV2ViewService(context);
    const artist = await service.media({ query: "Radiohead" });
    assert.equal(artist.view, "search_results");
    assert.equal(artist.best_match.title, "Radiohead");
    assert.equal(artist.groups.artist[0].title, "Radiohead");

    const artistDetail = await service.media({ query: "Radiohead", types: ["artist"] });
    assert.equal(artistDetail.view, "artist");
    assert.equal(artistDetail.artist.title, "Radiohead");
    assert.equal(artistDetail.popular_tracks[0].title, "Everything In Its Right Place");
    assert.equal(artistDetail.albums[0].title, "Kid A");

    const album = await service.media({ result_id: "album-1" });
    assert.equal(album.view, "album");
    assert.equal(album.description, "A landmark album.");
    assert.equal(album.tracks[0].title, "Everything In Its Right Place");

    const catalogPlaylist = media("playlist-1", "playlist", "Radiohead Essentials");
    context.mediaService.search = async () => ({
      results: [catalogPlaylist],
      recommended_result_id: catalogPlaylist.result_id,
      selection_required: false,
      ambiguous: false,
      warnings: []
    });
    const playlistResults = await service.media({ query: "Radiohead", types: ["playlist"] });
    assert.equal(playlistResults.view, "search_results");
    assert.equal(playlistResults.groups.playlist[0].title, "Radiohead Essentials");

    context.mediaService.search = async () => ({
      results: [context.mediaService.get("album-1"), context.mediaService.get("track-1")],
      recommended_result_id: null,
      selection_required: true,
      ambiguous: true,
      warnings: []
    });
    const results = await service.media({ query: "Everything" });
    assert.equal(results.view, "search_results");
    assert.deepEqual(results.results.map((item) => item.media_type), ["album", "track"]);
  } finally { database.close(); }
});

test("track cards expose canonical MusicBrainz metadata and the Roon binding", async () => {
  const { database, context } = fixture();
  context.trackCatalogService = {
    describeRoonTrack: async () => ({
      status: "exact",
      reason: "unique_compatible_recording",
      fetched_at: "2026-07-27T20:00:00.000Z",
      recording: {
        musicbrainz_id: "recording-1",
        title: "Everything In Its Right Place",
        disambiguation: "original studio recording",
        video: false,
        duration_seconds: 251,
        duration_source: "musicbrainz_recording_median",
        isrcs: ["GBAYE0000812"],
        artist_credit: [{ musicbrainz_id: "artist-1", name: "Radiohead", join_phrase: "" }],
        artists: []
      },
      work: {
        musicbrainz_id: "work-1",
        title: "Everything In Its Right Place",
        type: "Song",
        language: "eng",
        iswcs: ["T-010.123.456-7"],
        disambiguation: null,
        relation_type: "performance",
        relation_attributes: []
      },
      credits: [],
      composers: ["Thom Yorke"],
      lyricists: ["Thom Yorke"],
      genres: [{ name: "alternative rock", count: 8, entity: "recording" }],
      release_group: {
        musicbrainz_id: "release-group-1",
        title: "Kid A",
        artist_credit: [],
        first_release_date: "2000-10-02",
        release_year: 2000,
        primary_type: "Album",
        secondary_types: [],
        disambiguation: null,
        selection_reason: "catalog_album_matches_observed_album"
      },
      release: null,
      cover_art: {
        entity_type: "release_group",
        entity_id: "release-group-1",
        image_id: "cover-1",
        original_url: "https://archive.org/original.jpg",
        thumbnail_250_url: "https://archive.org/250.jpg",
        thumbnail_500_url: "https://archive.org/500.jpg",
        thumbnail_1200_url: "https://archive.org/1200.jpg",
        front: true,
        back: false,
        approved: true,
        source: "cover_art_archive"
      },
      roon_binding: {
        binding_id: "binding-1",
        recording_id: "recording-1",
        item_key: "roon-item",
        result_id: "track-1",
        source: "qobuz",
        canonical_query: "Everything In Its Right Place Radiohead",
        reusable: false,
        playable: true,
        status: "observed",
        confidence: "high",
        selection_origin: "display",
        observed_at: "2026-07-27T20:00:00.000Z",
        last_verified_at: "2026-07-27T20:00:00.000Z"
      },
      provenance: {
        canonical_metadata: "musicbrainz",
        cover_art: "cover_art_archive",
        playback: "roon"
      },
      warnings: []
    })
  };
  try {
    const view = await new WidgetV2ViewService(context).media({ result_id: "track-1" });
    assert.equal(view.view, "track");
    assert.equal(view.catalog.recording.musicbrainz_id, "recording-1");
    assert.equal(view.catalog.release_group.title, "Kid A");
    assert.equal(view.catalog.roon_binding.source, "qobuz");
    assert.equal(view.catalog.cover_art.thumbnail_500_url, "https://archive.org/500.jpg");
  } finally {
    database.close();
  }
});

test("playlist view contains cover, description and lightweight track rows", () => {
  const { database, context } = fixture();
  try {
    const view = new WidgetV2ViewService(context).playlist({ playlist: { name: "Focus" } });
    assert.equal(view.view, "playlist");
    assert.equal(view.playlist.name, "Focus");
    assert.equal(view.playlist.description, "Concentración sin distracciones.");
    assert.equal(view.playlist.image_key, "custom:custom-cover");
    assert.equal(view.playlist.image_url, null);
    assert.equal(view.tracks[0].title, "Everything In Its Right Place");
    assert.equal(view.tracks[0].image_key, "cover-1");
    assert.equal(view.tracks[0].image_url, null);
  } finally { database.close(); }
});

test("playlist view uses Roon artwork when the playlist has no custom cover", () => {
  const { database, context } = fixture();
  try {
    context.playlistService.updatePlaylist("focus", { cover_image_key: null });
    const view = new WidgetV2ViewService(context).playlist({ playlist: { id: "focus" } });
    assert.equal(view.playlist.image_key, "cover-1");
    assert.equal(view.playlist.image_url, null);
  } finally { database.close(); }
});

test("playlist library returns bounded saved playlist cards and pagination", () => {
  const { database, context } = fixture();
  try {
    const view = new WidgetV2ViewService(context).playlistLibrary({ limit: 1, offset: 0 });
    assert.equal(view.view, "playlist_library");
    assert.equal(view.playlists.length, 1);
    assert.equal(view.playlists[0].playlist_id, "focus");
    assert.equal(view.playlists[0].track_count, 1);
    assert.equal(view.playlists[0].image_key, "custom:custom-cover");
    assert.deepEqual(view.pagination, { offset: 0, returned: 1, total: 1, has_more: false });
  } finally { database.close(); }
});

test("queue view resolves a named zone and normalizes upcoming items", async () => {
  const { database, context } = fixture();
  try {
    const view = await new WidgetV2ViewService(context).queue({
      zone: { name: "Despacho" },
      count: 10
    });
    assert.equal(view.view, "queue");
    assert.equal(view.zone.name, "Despacho");
    assert.equal(view.zone.now_playing.title, "Everything In Its Right Place");
    assert.equal(view.items[0].queue_item_id, 41);
    assert.equal(view.items[0].title, "Pyramid Song");
    assert.equal(view.items[0].artist, "Radiohead");
    assert.equal(view.items[0].album, "Amnesiac");
    assert.equal(view.items[0].duration_seconds, 289);
    assert.equal(view.items[0].image_key, "queue-cover");
    assert.equal(view.total_duration_seconds, 289);
  } finally { database.close(); }
});

test("zones panel includes every zone, grouped outputs and active safe limits", () => {
  const { database, context } = fixture();
  try {
    const view = new WidgetV2ViewService(context).zones();
    assert.equal(view.view, "zones");
    assert.equal(view.zone_count, 3);
    assert.deepEqual(view.states, { playing: 2, paused: 1 });
    assert.deepEqual(view.zones.slice(0, 2).map((item) => item.name), ["Cocina", "Despacho"]);
    assert.equal(view.zones[2].zone_id, "zone-lounge");
    const office = view.zones.find((item) => item.name === "Despacho");
    assert.equal(office.outputs.length, 2);
    assert.deepEqual(office.outputs[0].safe_limit, {
      limit_id: "safe-office",
      name: "Despacho seguro",
      safe_max: 25
    });
    assert.equal(office.outputs[1].volume.muted, true);
    assert.equal(office.playback_settings.loop, "disabled");
  } finally { database.close(); }
});
