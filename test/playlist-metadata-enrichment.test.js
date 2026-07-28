const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { PlaylistMetadataEnrichmentService } = require("../dist/services/playlistMetadataEnrichmentService");
const { PlaylistRepairService } = require("../dist/services/playlistRepairService");
const { PlaylistService } = require("../dist/services/playlistService");

function tempConfig() {
  return {
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "roonia-metadata-")),
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

function mediaTrack(overrides = {}) {
  return {
    result_id: "track-result",
    roon_item_key: "roon:track",
    type: "track",
    media_type: "track",
    title: "Song",
    artist: "Artist",
    artists: [],
    album: "Album",
    album_artist: "Artist",
    version_hint: "studio",
    subtitle: "Artist",
    image_key: "image-key",
    source: "tidal",
    source_confidence: "high",
    quality: null,
    is_library: false,
    playable: true,
    is_best_match: true,
    selection_required: false,
    match_score: 100,
    confidence: "high",
    match_reasons: [],
    match_penalties: [],
    version_penalties: [],
    warnings: [],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    release_year: null,
    duration_seconds: null,
    track_number: null,
    disc_number: null,
    content_count: null,
    release_type: null,
    release_type_source: null,
    release_section: null,
    roon_rank: 0,
    direct_match: true,
    direct_match_score: 100,
    data_origin: "roon_search_session",
    completeness: "unknown",
    ordered: null,
    identity_verified: true,
    links: {
      artist: null,
      artists: [],
      album: { type: "album", title: "Album", artist: "Artist", result_id: "album-result" }
    },
    ...overrides
  };
}

test("metadata refresh replaces stale catalog observations without changing the selected identity", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const playlist = playlistService.createPlaylist({
    name: "Metadata",
    tracks: [{
      query: "Song Artist",
      title: "Song",
      artist: "Artist",
      album: "Album",
      audio_metadata: { title: "Song", artist: "Artist", album: "Album", composer: "Stored Composer" },
      resolution: { status: "resolved", selected_result_id: "old-result" }
    }]
  });
  const detailed = mediaTrack({ duration_seconds: 245, track_number: 4, release_year: 1999 });
  const media = {
    async search() { return { results: [] }; },
    async getAlbumDetail() {
      return {
        album: mediaTrack({ result_id: "album-result", type: "album", media_type: "album", title: "Album", playable: false }),
        tracks: [detailed],
        related_tracks: [],
        warnings: []
      };
    }
  };
  const service = new PlaylistMetadataEnrichmentService(playlistService, media);
  const identityFingerprint = playlist.tracks[0].identity.fingerprint;
  const result = await service.refreshTrack(playlist.playlist_id, playlist.tracks[0].track_id, {
    result: mediaTrack({ composer: null })
  });

  assert.equal(result.report.status, "completed");
  assert.equal(result.track.audio_metadata.duration_seconds, 245);
  assert.equal(result.track.audio_metadata.track_number, 4);
  assert.equal(result.track.audio_metadata.release_year, 1999);
  assert.equal(result.track.audio_metadata.composer, undefined);
  assert.equal(result.track.identity.fingerprint, identityFingerprint);
  assert.equal(result.report.metadata_status, "exact", JSON.stringify(result.report));
  assert.deepEqual(result.report.completeness.missing_fields, []);
});

test("manual repair validates the selected track, marks it manual and enriches it", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const playlist = playlistService.createPlaylist({
    name: "Repair",
    tracks: [{ query: "Song Artist", title: "Song", artist: "Artist", resolution: { status: "ambiguous" } }]
  });
  const selected = mediaTrack();
  const media = {
    get() { return selected; },
    async search() { return { results: [] }; },
    async getAlbumDetail() {
      return {
        album: mediaTrack({ result_id: "album-result", type: "album", media_type: "album", title: "Album", playable: false }),
        tracks: [mediaTrack({ duration_seconds: 200 })],
        related_tracks: [],
        warnings: []
      };
    }
  };
  const metadataService = new PlaylistMetadataEnrichmentService(playlistService, media);
  let bindingOrigin = null;
  const trackCatalogService = {
    async describeRoonTrack() {
      return {
        status: "exact",
        reason: "unique_compatible_recording",
        recording: {
          musicbrainz_id: "mb-recording-manual",
          title: "Canonical Song",
          artist_credit: [{ musicbrainz_id: "mb-artist", name: "Canonical Artist", join_phrase: "" }],
          disambiguation: null,
          duration_seconds: 200,
          duration_source: "musicbrainz_recording_median",
          isrcs: ["USAAA2600002"]
        },
        release_group: { musicbrainz_id: "mb-release-group", title: "Canonical Album" },
        composers: ["Composer"],
        lyricists: ["Lyricist"],
        genres: [{ name: "rock" }],
        roon_binding: null,
        provenance: { canonical_metadata: "musicbrainz", cover_art: null, playback: "roon" }
      };
    },
    bind(recordingId, result, origin) {
      bindingOrigin = origin;
      return {
        binding_id: "manual-binding",
        recording_id: recordingId,
        item_key: result.roon_item_key,
        result_id: result.result_id,
        source: result.source,
        canonical_query: `${result.title} ${result.artist}`,
        reusable: false,
        playable: true,
        status: "observed",
        confidence: "high",
        selection_origin: origin,
        observed_at: "2026-07-27T20:00:00.000Z",
        last_verified_at: "2026-07-27T20:00:00.000Z"
      };
    }
  };
  const repairService = new PlaylistRepairService(
    playlistService,
    media,
    metadataService,
    undefined,
    trackCatalogService
  );
  const result = await repairService.selectTrack({
    playlistId: playlist.playlist_id,
    trackId: playlist.tracks[0].track_id,
    resultId: selected.result_id,
    selectionOrigin: "portal_user"
  });

  assert.equal(result.track.resolution.status, "manual");
  assert.equal(result.track.resolution.selection_origin, "portal_user");
  assert.equal(result.track.audio_metadata.duration_seconds, 200);
  assert.equal(result.track.title, "Canonical Song");
  assert.equal(result.track.artist, "Canonical Artist");
  assert.equal(result.track.audio_metadata.catalog.recording.musicbrainz_id, "mb-recording-manual");
  assert.equal(result.track.audio_metadata.catalog.roon_binding.selection_origin, "manual");
  assert.equal(bindingOrigin, "manual");
});

test("metadata enrichment opens a resolved track detail when search results omit album and duration", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const playlist = playlistService.createPlaylist({
    name: "Sparse search",
    tracks: [{ query: "Song Artist", title: "Song", artist: "Artist", resolution: { status: "resolved" } }]
  });
  let detailCalls = 0;
  const sparse = mediaTrack({ album: null, album_artist: null, duration_seconds: null, links: { artist: null, artists: [], album: null } });
  const media = {
    async getTrackMetadata() {
      detailCalls += 1;
      return mediaTrack({ album: "Album", album_artist: "Artist", duration_seconds: 241, track_number: 1, release_year: 2001 });
    },
    async search() { return { results: [] }; },
    async getAlbumDetail() { throw new Error("album search should not be needed"); }
  };
  const service = new PlaylistMetadataEnrichmentService(playlistService, media);
  const result = await service.refreshTrack(playlist.playlist_id, playlist.tracks[0].track_id, { result: sparse });

  assert.equal(detailCalls, 1);
  assert.equal(result.report.status, "completed");
  assert.equal(result.track.album, "Album");
  assert.equal(result.track.audio_metadata.duration_seconds, 241);
  assert.equal(result.track.audio_metadata.track_number, 1);
  assert.equal(result.track.audio_metadata.release_year, 2001);
  assert.equal(result.track.identity.album, null);
  assert.equal(result.report.warnings.includes("album_reference_unavailable"), false);
});

test("exact playlist binding verifies the Roon release even with a canonical catalog profile", async () => {
  const playlistService = new PlaylistService(tempConfig());
  let detailCalls = 0;
  const sparse = mediaTrack({
    title: "Inevitable (En Vivo)",
    artist: "Shakira",
    version_hint: "live",
    album: null,
    album_artist: null,
    duration_seconds: null,
    links: { artist: null, artists: [], album: null }
  });
  const media = {
    async getTrackMetadata() {
      detailCalls += 1;
      return mediaTrack({
        title: "Inevitable (En Vivo)",
        artist: "Shakira",
        version_hint: "live",
        album: "MTV Unplugged",
        album_artist: "Shakira",
        duration_seconds: 219,
        track_number: 6,
        release_year: 1999,
        links: { artist: null, artists: [], album: null }
      });
    },
    async search() { return { results: [] }; },
    async getAlbumDetail() { throw new Error("direct track detail already verified the release"); }
  };
  const profile = {
    status: "exact",
    reason: "unique_compatible_recording_from_release_observation_identity_only",
    recording: {
      musicbrainz_id: "mb-shakira-unplugged",
      title: "Inevitable",
      artist_credit: [{ musicbrainz_id: "shakira", name: "Shakira", join_phrase: "" }],
      disambiguation: "acoustic performance",
      duration_seconds: 219,
      duration_source: "musicbrainz_recording_median",
      isrcs: []
    },
    composers: [],
    lyricists: [],
    genres: [],
    release_group: {
      musicbrainz_id: "group-mtv-unplugged",
      title: "MTV Unplugged",
      artist_credit: [],
      first_release_date: "1999",
      release_year: 1999,
      primary_type: "Album",
      secondary_types: ["Live"],
      disambiguation: null,
      selection_reason: "catalog_album_matches_observed_album"
    },
    release: null,
    work: null,
    credits: [],
    cover_art: null,
    roon_binding: null,
    provenance: { canonical_metadata: "musicbrainz", cover_art: null, playback: null },
    warnings: []
  };
  const service = new PlaylistMetadataEnrichmentService(playlistService, media);
  const result = await service.enrichResult(sparse, {
    title: "Inevitable",
    artist: "Shakira",
    album: "MTV Unplugged",
    catalog_profile: profile,
    verify_release: true
  });

  assert.equal(detailCalls, 1);
  assert.equal(result.result.album, "MTV Unplugged");
  assert.equal(result.result.duration_seconds, 219);
  assert.equal(result.report.release.verified_by, "roon_direct_album_navigation");
  assert.equal(result.audio_metadata.recording.musicbrainz_id, "mb-shakira-unplugged");
});

test("release verification searches with the requested performer before polluted Roon credits", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const searches = [];
  const sparse = mediaTrack({
    title: "Home (Air \"Around the Golf\" Remix)",
    artist: "Martin L. Gore, Jean-Benoît Dunckel, Nicolas Godin, Depeche Mode",
    artists: [
      { type: "artist", title: "Martin L. Gore", artist: null, result_id: null },
      { type: "artist", title: "Jean-Benoît Dunckel", artist: null, result_id: null },
      { type: "artist", title: "Nicolas Godin", artist: null, result_id: null },
      { type: "artist", title: "Depeche Mode", artist: null, result_id: null }
    ],
    album: null,
    album_artist: null,
    image_key: null,
    version_hint: "remix",
    links: { artist: null, artists: [], album: null }
  });
  const media = {
    async getTrackMetadata() {
      return sparse;
    },
    async search(request) {
      searches.push(request);
      return { results: [] };
    },
    async getAlbumDetail() {
      throw new Error("no album result was returned");
    }
  };
  const service = new PlaylistMetadataEnrichmentService(playlistService, media);
  await service.enrichResult(sparse, {
    title: "Home (Air \"Around the Golf\" Remix)",
    artist: "Depeche Mode",
    album: "Remixes 81–04",
    verify_release: true
  });

  assert.equal(searches[0].query, "Remixes 81–04 Depeche Mode");
  assert.doesNotMatch(searches[0].query, /Martin L\. Gore|Jean-Benoît|Nicolas Godin/);
});

test("duplicate refreshes for the same playlist track share one Roon operation", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const playlist = playlistService.createPlaylist({
    name: "Coalesced",
    tracks: [{ query: "Song Artist", title: "Song", artist: "Artist", resolution: { status: "resolved" } }]
  });
  let detailCalls = 0;
  const sparse = mediaTrack({ album: null, album_artist: null, duration_seconds: null, links: { artist: null, artists: [], album: null } });
  const media = {
    async getTrackMetadata() {
      detailCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return mediaTrack({ album: "Album", duration_seconds: 180 });
    },
    async search() { return { results: [] }; },
    async getAlbumDetail() { throw new Error("album search should not be needed"); }
  };
  const service = new PlaylistMetadataEnrichmentService(playlistService, media);
  const [first, second] = await Promise.all([
    service.refreshTrack(playlist.playlist_id, playlist.tracks[0].track_id, { result: sparse }),
    service.refreshTrack(playlist.playlist_id, playlist.tracks[0].track_id, { result: sparse })
  ]);

  assert.equal(detailCalls, 1);
  assert.equal(first.report.status, "completed");
  assert.equal(second.report.status, "completed");
});

test("metadata enrichment never borrows an album from a different candidate cover", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const playlist = playlistService.createPlaylist({
    name: "Catalog fallback",
    tracks: [{ query: "Riders on the Storm The Doors", title: "Riders On The Storm", artist: "The Doors", resolution: { status: "resolved" } }]
  });
  const sparse = mediaTrack({
    title: "Riders On The Storm",
    artist: "The Doors",
    artists: [{ type: "artist", title: "The Doors", artist: null, result_id: null }],
    album: null,
    duration_seconds: null,
    image_key: "single-cover",
    links: { artist: null, artists: [], album: null }
  });
  const release = mediaTrack({ result_id: "la-woman", media_type: "album", type: "album", title: "L.A. Woman", artist: "The Doors", image_key: "album-cover" });
  const media = {
    async getTrackMetadata() { throw new Error("album action unavailable"); },
    async search(input) {
      if (input.types.length === 1 && input.types[0] === "album") return { results: [] };
      return { results: [
        mediaTrack({ result_id: "artist", media_type: "artist", type: "artist", title: "The Doors", artist: "The Doors" }),
        mediaTrack({ result_id: "lp-track", title: "Riders On The Storm ( LP Version )", artist: "The Doors", image_key: "album-cover", version_hint: "alternate" })
      ] };
    },
    async listArtistReleases() { return { releases: [release] }; },
    async getAlbumDetail() {
      return {
        album: release,
        tracks: [mediaTrack({ title: "Riders On The Storm ( LP Version )", artist: "The Doors", album: "L.A. Woman", duration_seconds: null, track_number: 10 })],
        related_tracks: [],
        warnings: []
      };
    }
  };
  const recordingMetadata = { async lookup() { throw new Error("unverified releases must not anchor MusicBrainz metadata"); } };
  const service = new PlaylistMetadataEnrichmentService(playlistService, media, undefined, "streaming_first", recordingMetadata);
  const result = await service.refreshTrack(playlist.playlist_id, playlist.tracks[0].track_id, { result: sparse });

  assert.equal(result.report.status, "partial");
  assert.equal(result.report.metadata_status, "unverified");
  assert.equal(result.track.album, null);
  assert.equal(result.track.audio_metadata.duration_seconds, undefined);
  assert.equal(result.report.warnings.includes("release_reference_unavailable"), true);
});

test("metadata refresh repairs a legacy identity polluted by an earlier enrichment", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const playlist = playlistService.createPlaylist({
    name: "Legacy enrichment",
    tracks: [{ query: "Song Artist", title: "Song", artist: "Artist", resolution: { status: "resolved" } }]
  });
  const track = playlist.tracks[0];
  const database = playlistService.database.db;
  const row = database.prepare(
    "SELECT metadata_json FROM virtual_playlist_tracks WHERE playlist_id = ? AND track_id = ?"
  ).get(playlist.playlist_id, track.track_id);
  const stored = JSON.parse(row.metadata_json);
  delete stored.identity.catalog_separated;
  stored.identity.album = "Wrong compilation";
  stored.identity.duration_seconds = 999;
  stored.audio_metadata = {
    ...stored.audio_metadata,
    album: "Wrong compilation",
    duration_seconds: 999,
    image_key: "selected-cover"
  };
  stored.resolution.selected_candidate = {
    result_id: "original-selection",
    media_type: "track",
    title: "Song",
    artist: "Artist",
    album: null,
    duration_seconds: null,
    version_hint: "studio",
    source: "tidal",
    image_key: "selected-cover"
  };
  stored.resolution.metadata_enrichment = { status: "completed" };
  database.prepare(
    "UPDATE virtual_playlist_tracks SET album = ?, metadata_json = ? WHERE playlist_id = ? AND track_id = ?"
  ).run("Wrong compilation", JSON.stringify(stored), playlist.playlist_id, track.track_id);

  const legacyFingerprint = stored.identity.fingerprint;
  const source = mediaTrack({
    album: null,
    duration_seconds: null,
    image_key: "selected-cover",
    links: { artist: null, artists: [], album: null }
  });
  const media = {
    async getTrackMetadata() { throw new Error("no direct release"); },
    async search() { return { results: [] }; },
    async listArtistReleases() { return { releases: [] }; }
  };
  const service = new PlaylistMetadataEnrichmentService(playlistService, media);
  const result = await service.refreshTrack(playlist.playlist_id, track.track_id, { result: source });

  assert.equal(result.track.identity.fingerprint, legacyFingerprint);
  assert.equal(result.track.identity.catalog_separated, true);
  assert.equal(result.track.identity.album, null);
  assert.equal(result.track.identity.duration_seconds, null);
  assert.equal(result.track.album, null);
  assert.equal(result.track.audio_metadata.album, undefined);
  assert.equal(result.track.audio_metadata.duration_seconds, undefined);
});

test("metadata enrichment fills recording facts only after the selected cover verifies the release", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const playlist = playlistService.createPlaylist({
    name: "Verified release",
    tracks: [{ query: "Song Artist", title: "Song", artist: "Artist", resolution: { status: "resolved" } }]
  });
  const sparse = mediaTrack({ album: null, duration_seconds: null, image_key: "album-cover", links: { artist: null, artists: [], album: null } });
  const release = mediaTrack({ result_id: "album", type: "album", media_type: "album", title: "Album", image_key: "album-cover" });
  const media = {
    async getTrackMetadata() { throw new Error("no direct album action"); },
    async search(input) {
      return input.types[0] === "artist"
        ? { results: [mediaTrack({ result_id: "artist", type: "artist", media_type: "artist", title: "Artist", artist: "Artist" })] }
        : { results: [] };
    },
    async listArtistReleases() { return { releases: [release] }; },
    async getAlbumDetail() {
      return { album: release, tracks: [mediaTrack({ image_key: "album-cover", duration_seconds: null, track_number: 2 })], related_tracks: [], warnings: [] };
    }
  };
  const recordingMetadata = {
    async lookup(input) {
      assert.equal(input.album, "Album");
      return {
        status: "exact",
        reason: "unique_compatible_recording",
        candidates: [],
        metadata: {
          recording_id: "mbid",
          title: "Song",
          artist: "Artist",
          album: "Album",
          disambiguation: "original studio mix",
          duration_seconds: 201,
          release_year: 1999,
          original_release_year: 1999,
          isrc: "TEST123",
          isrcs: ["TEST123"],
          composers: ["Composer"],
          lyricists: [],
          genres: ["rock"],
          confidence: "high"
        }
      };
    }
  };
  const service = new PlaylistMetadataEnrichmentService(playlistService, media, undefined, "streaming_first", recordingMetadata);
  const result = await service.refreshTrack(playlist.playlist_id, playlist.tracks[0].track_id, { result: sparse });

  assert.equal(result.report.metadata_status, "exact", JSON.stringify(result.report));
  assert.equal(result.track.audio_metadata.duration_seconds, 201);
  assert.equal(result.track.audio_metadata.composer, "Composer");
  assert.deepEqual(result.track.audio_metadata.genres, ["rock"]);
  assert.equal(result.track.identity.album, null);
});

test("manual playlist associations can reuse their matching candidate when re-resolution is ambiguous", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const playlist = playlistService.createPlaylist({
    name: "Manual identity",
    tracks: [{
      query: "Song Artist",
      title: "Song",
      artist: "Artist",
      audio_metadata: { title: "Song", artist: "Artist", image_key: "chosen-cover" },
      resolution: { status: "manual", selection_origin: "portal_user" }
    }]
  });
  const chosen = mediaTrack({ result_id: "chosen", image_key: "chosen-cover", album: null, duration_seconds: null, links: { artist: null, artists: [], album: null } });
  const competing = mediaTrack({ result_id: "competing", image_key: "other-cover", album: null, duration_seconds: null, links: { artist: null, artists: [], album: null } });
  const media = {
    async search() { return { results: [chosen, competing] }; },
    async getTrackMetadata(resultId) {
      assert.equal(resultId, "chosen");
      return mediaTrack({ result_id: "chosen", image_key: "chosen-cover", album: "Album", duration_seconds: 180 });
    },
    async getAlbumDetail() { throw new Error("not needed"); }
  };
  const service = new PlaylistMetadataEnrichmentService(playlistService, media);
  const result = await service.refreshTrack(playlist.playlist_id, playlist.tracks[0].track_id);

  assert.equal(result.report.status, "completed");
  assert.equal(result.track.resolution.status, "manual");
  assert.equal(result.track.album, "Album");
  assert.equal(result.track.audio_metadata.duration_seconds, 180);
});
