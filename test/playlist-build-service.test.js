const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { PlaylistBuildService } = require("../dist/services/playlistBuildService");
const { PlaylistService } = require("../dist/services/playlistService");

function tempConfig() {
  return {
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "roonia-playlist-build-")),
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

function mediaTrack(id, title, artist, options = {}) {
  return {
    result_id: id,
    roon_item_key: `key:${id}`,
    type: "track",
    media_type: "track",
    title,
    artist,
    artists: [{ type: "artist", title: artist, artist: null, result_id: null }],
    album: options.album ?? null,
    album_artist: options.albumArtist ?? null,
    version_hint: options.versionHint || "studio",
    subtitle: artist,
    image_key: options.imageKey || null,
    source: options.source || "tidal",
    source_confidence: "high",
    quality: options.quality || null,
    is_library: false,
    playable: options.playable !== false,
    is_best_match: true,
    selection_required: false,
    match_score: 100,
    confidence: "high",
    match_reasons: [],
    match_penalties: [],
    version_penalties: [],
    warnings: [],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    release_year: options.releaseYear ?? null,
    duration_seconds: options.durationSeconds ?? null,
    track_number: options.trackNumber ?? null,
    disc_number: options.discNumber ?? null,
    content_count: null,
    release_type: null,
    release_type_source: null,
    roon_rank: options.roonRank || 1,
    direct_match: true,
    direct_match_score: 100,
    links: {
      artist: null,
      artists: [],
      album: options.albumResultId
        ? { type: "album", title: options.album || "Album", artist, result_id: options.albumResultId }
        : null
    },
    ...(options.extra || {})
  };
}

function mediaAlbum(id, title, artist, options = {}) {
  return {
    ...mediaTrack(id, title, artist, options),
    type: "album",
    media_type: "album",
    playable: false,
    roon_item_key: `album:${id}`
  };
}

function fakeMedia(searchResults, albumDetails = {}) {
  return {
    searches: [],
    async search(request) {
      this.searches.push(request);
      const results = typeof searchResults === "function"
        ? searchResults(request)
        : searchResults[request.query] || [];
      return {
        query: request.query,
        source_preference: request.sourcePreference || "streaming_first",
        results,
        groups: { artist: [], album: [], ep: [], single_ep: [], single: [], track: results, playlist: [] },
        best_match: results[0] || null,
        best_by_type: { track: results[0] || null },
        ambiguous: false,
        ambiguity_reason: null,
        recommended_result_id: results[0]?.result_id || null,
        selection_required: false,
        warnings: []
      };
    },
    async getAlbumDetail(resultId) {
      if (!albumDetails[resultId]) throw new Error("album detail unavailable");
      return albumDetails[resultId];
    }
  };
}

test("temporary playlist builds preserve their purpose and lifecycle across replenishment", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia((request) => {
    if (request.query.includes("First Song")) return [mediaTrack("first-temp", "First Song", "Artist One")];
    if (request.query.includes("Second Song")) return [mediaTrack("second-temp", "Second Song", "Artist Two")];
    return [];
  });
  const builder = new PlaylistBuildService(playlistService, media);
  const initial = await builder.build({
    purpose: "temporary_playlist",
    name: "Temporary build",
    intent: "music for focused work",
    expiry_days: 10,
    desired_count: 2,
    tracks: [{ title: "First Song", artist_credit: "Artist One" }]
  });
  assert.equal(initial.phase, "needs_candidates");
  assert.equal(playlistService.listPlaylists({ scope: "all" }).total, 0);
  await assert.rejects(
    builder.build({
      purpose: "saved_playlist",
      build_id: initial.build_id,
      tracks: [{ title: "Second Song", artist_credit: "Artist Two" }]
    }),
    (error) => error.code === "PLAYLIST_BUILD_PURPOSE_MISMATCH"
  );
  const final = await builder.build({
    purpose: "temporary_playlist",
    build_id: initial.build_id,
    tracks: [{ title: "Second Song", artist_credit: "Artist Two" }]
  });
  assert.equal(final.phase, "finalized");
  assert.equal(final.playlist.lifecycle.type, "temporary");
  assert.equal(final.playlist.lifecycle.intent, "music for focused work");
  assert.equal(playlistService.listPlaylists().total, 0);
  assert.equal(playlistService.listPlaylists({ scope: "temporary" }).total, 1);
});

test("playlist build saves every verified track after three replenishment rounds", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia((request) => {
    if (request.query.includes("First Song")) return [mediaTrack("first", "First Song", "Artist One")];
    if (request.query.includes("Second Song")) return [mediaTrack("second", "Second Song", "Artist Two")];
    return [];
  });
  const builder = new PlaylistBuildService(playlistService, media);

  const initial = await builder.build({
    name: "Safe but shorter",
    desired_count: 3,
    tracks: [{ candidate_id: "p1", title: "First Song", artist_credit: "Artist One" }]
  });
  assert.equal(initial.phase, "needs_candidates");
  assert.equal(initial.next_round, 1);
  assert.equal(initial.rounds_remaining, 3);
  assert.equal(initial.missing_count, 2);
  assert.equal(playlistService.listPlaylists().total, 0);

  const roundOne = await builder.build({
    build_id: initial.build_id,
    tracks: [{ candidate_id: "r1", title: "Unavailable Song", artist_credit: "Nobody" }]
  });
  assert.equal(roundOne.phase, "needs_candidates");
  assert.equal(roundOne.next_round, 2);
  assert.equal(roundOne.rounds_remaining, 2);
  assert.equal(playlistService.listPlaylists().total, 0);

  const roundTwo = await builder.build({
    build_id: initial.build_id,
    tracks: [{ candidate_id: "r2", title: "Second Song", artist_credit: "Artist Two" }]
  });
  assert.equal(roundTwo.phase, "needs_candidates");
  assert.equal(roundTwo.rounds_remaining, 1);
  const partial = await builder.build({
    build_id: initial.build_id,
    tracks: [{ candidate_id: "r3", title: "Still Unavailable", artist_credit: "Nobody Else" }]
  });
  assert.equal(partial.phase, "finalized");
  assert.equal(partial.complete, false);
  assert.equal(partial.added_count, 2);
  assert.equal(partial.missing_count, 1);
  assert.equal(partial.playlist.tracks_count, 2);
  assert.equal(partial.rejection_summary.total, 2);
  assert.equal(playlistService.listPlaylists().total, 1);
});

test("playlist build treats an exact repeated batch as an idempotent retry", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia((request) =>
    request.query.includes("First Song")
      ? [mediaTrack("first-idempotent", "First Song", "Artist One")]
      : request.query.includes("Second Song")
        ? [mediaTrack("second-idempotent", "Second Song", "Artist Two")]
        : []
  );
  const builder = new PlaylistBuildService(playlistService, media);
  const request = {
    name: "Idempotent build",
    desired_count: 2,
    tracks: [{ candidate_id: "first", title: "First Song", artist_credit: "Artist One" }]
  };
  const initial = await builder.build(request);
  const searchesAfterInitial = media.searches.length;
  const retry = await builder.build({
    build_id: initial.build_id,
    tracks: request.tracks
  });

  assert.deepEqual(retry, initial);
  assert.equal(media.searches.length, searchesAfterInitial);
  assert.equal(retry.next_round, 1);

  const completed = await builder.build({
    build_id: initial.build_id,
    tracks: [{ candidate_id: "second", title: "Second Song", artist_credit: "Artist Two" }]
  });
  assert.equal(completed.phase, "finalized");
  assert.equal(completed.complete, true);
  assert.equal(completed.playlist.tracks_count, 2);
});

test("playlist build rejects an unintended live result and fills the target from a reserve", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia((request) => {
    if (request.query.includes("Angel")) {
      return [mediaTrack("angel-live", "Angel (Live)", "Massive Attack", { versionHint: "live" })];
    }
    if (request.query.includes("Teardrop")) {
      return [mediaTrack("teardrop", "Teardrop", "Massive Attack")];
    }
    return [];
  });
  const result = await new PlaylistBuildService(playlistService, media).build({
    name: "Reserve replacement",
    desired_count: 1,
    tracks: [
      { candidate_id: "p1", role: "primary", result_id: "angel-live", title: "Angel", artist_credit: "Massive Attack" },
      { candidate_id: "r1", role: "reserve", title: "Teardrop", artist_credit: "Massive Attack" }
    ]
  });

  assert.equal(result.phase, "finalized");
  assert.equal(result.complete, true);
  assert.equal(result.playlist.tracks_count, 1);
  assert.equal(result.playlist.tracks[0].title, "Teardrop");
  assert.equal(result.rejected[0].candidate_id, "p1");
  assert.equal(result.rejected[0].status, "missing");
  assert.equal(result.accepted[0].role, "reserve");
});

test("playlist build never promotes two indistinguishable strict matches out of ambiguity", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia((request) => {
    if (request.query.includes("Ambiguous Song")) {
      return [
        mediaTrack("ambiguous-a", "Ambiguous Song", "Same Artist", { album: "Release A" }),
        mediaTrack("ambiguous-b", "Ambiguous Song", "Same Artist", { album: "Release B" })
      ];
    }
    if (request.query.includes("Safe Reserve")) {
      return [mediaTrack("safe-reserve", "Safe Reserve", "Other Artist")];
    }
    return [];
  });
  const result = await new PlaylistBuildService(playlistService, media).build({
    name: "No ambiguous recordings",
    desired_count: 1,
    tracks: [
      { candidate_id: "ambiguous", title: "Ambiguous Song", artist_credit: "Same Artist" },
      { candidate_id: "reserve", role: "reserve", title: "Safe Reserve", artist_credit: "Other Artist" }
    ]
  });

  assert.equal(result.phase, "finalized");
  assert.equal(result.playlist.tracks.length, 1);
  assert.equal(result.playlist.tracks[0].title, "Safe Reserve");
  assert.equal(result.rejected.find((item) => item.candidate_id === "ambiguous").status, "needs_enrichment");
});

test("playlist build reorders the final resolved set so the same artist is never adjacent", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const tracks = {
    "A One Artist A": [mediaTrack("a1", "A One", "Artist A")],
    "A Two Artist A": [mediaTrack("a2", "A Two", "Artist A")],
    "B One Artist B": [mediaTrack("b1", "B One", "Artist B")],
    "B Two Artist B": [mediaTrack("b2", "B Two", "Artist B")]
  };
  const result = await new PlaylistBuildService(playlistService, fakeMedia(tracks)).build({
    name: "No adjacent artists",
    desired_count: 4,
    tracks: [
      { title: "A One", artist_credit: "Artist A" },
      { title: "A Two", artist_credit: "Artist A" },
      { title: "B One", artist_credit: "Artist B" },
      { title: "B Two", artist_credit: "Artist B" }
    ]
  });

  assert.equal(result.complete, true);
  const artists = result.playlist.tracks.map((track) => track.artist);
  for (let index = 1; index < artists.length; index += 1) {
    assert.notEqual(artists[index], artists[index - 1]);
  }
});

test("playlist build hydrates the selected track and stores the complete Roon observation separately from LLM hints", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const searchTrack = mediaTrack("search-track", "Hydrated Song", "Hydrated Artist", {
    albumResultId: "album-result"
  });
  const detailedTrack = mediaTrack("detail-track", "Hydrated Song", "Hydrated Artist", {
    album: "Observed Album",
    albumArtist: "Hydrated Artist",
    releaseYear: 1999,
    durationSeconds: 245,
    trackNumber: 4,
    discNumber: 1,
    quality: { label: "24-bit / 96 kHz / FLAC", bit_depth: 24, sample_rate_hz: 96000, format: "FLAC" },
    extra: { isrc: "GBTEST990001" }
  });
  const album = mediaAlbum("album-result", "Observed Album", "Hydrated Artist", { releaseYear: 1999 });
  const media = fakeMedia(
    { "Hydrated Song Hydrated Artist": [searchTrack] },
    { "album-result": { album, description: null, tracks: [detailedTrack], warnings: [] } }
  );

  const result = await new PlaylistBuildService(playlistService, media).build({
    name: "Hydrated",
    tracks: [{
      candidate_id: "p1",
      title: "Hydrated Song",
      artist_credit: "Hydrated Artist",
      album_hint: "Hint Album",
      release_year_hint: 2000
    }]
  });
  const stored = result.playlist.tracks[0];
  assert.equal(stored.album, "Observed Album");
  assert.equal(stored.audio_metadata.release_year, 1999);
  assert.equal(stored.audio_metadata.duration_seconds, 245);
  assert.equal(stored.audio_metadata.isrc, "GBTEST990001");
  assert.equal(stored.audio_metadata.metadata_status, "exact");
  assert.equal(stored.audio_metadata.release.title, "Observed Album");
  assert.equal(stored.identity.album, null);
  assert.equal(stored.user_metadata.llm_hints.album, "Hint Album");
  assert.equal(stored.user_metadata.llm_hints.release_year, 2000);
  assert.equal(stored.resolution.roon_observation.album_detail.attempted, true);
  assert.equal(stored.resolution.roon_observation.album_detail.matched_track.isrc, "GBTEST990001");
  assert.equal(stored.resolution.metadata_enrichment.metadata_status, "exact");
  assert.equal(stored.resolution.selected_candidate.album, null);
  assert.equal(stored.resolution.selection_origin, "automatic");
  assert.equal(stored.resolution.readiness, "ready");
});

test("playlist build handles exact non-Latin title and artist identities", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia({
    "背徳の人 ムック": [mediaTrack("jp-track", "背徳の人", "ムック")]
  });
  const result = await new PlaylistBuildService(playlistService, media).build({
    name: "Unicode",
    tracks: [{ title: "背徳の人", artist_credit: "ムック" }]
  });
  assert.equal(result.playlist.tracks_count, 1);
  assert.equal(result.playlist.tracks[0].title, "背徳の人");
});

test("dub is treated as a genre word unless the title identifies a dub version", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia((request) => {
    if (request.query.includes("Modern Dub")) {
      return [mediaTrack("modern-dub", "Modern Dub", "Dub Artist")];
    }
    if (request.query.includes("Version Song")) {
      return [mediaTrack("dub-mix", "Version Song (Dub Mix)", "Dub Artist", {
        versionHint: "alternate"
      })];
    }
    return [];
  });
  const builder = new PlaylistBuildService(playlistService, media);

  const standard = await builder.build({
    name: "Dub genre",
    tracks: [{ title: "Modern Dub", artist_credit: "Dub Artist" }]
  });
  assert.equal(standard.added_count, 1);

  const wrongVersion = await builder.build({
    name: "Standard version",
    desired_count: 1,
    tracks: [{ title: "Version Song", artist_credit: "Dub Artist" }]
  });
  assert.equal(wrongVersion.phase, "needs_candidates");
  assert.equal(wrongVersion.added_count, 0);

  const explicitVersion = await builder.build({
    name: "Dub version",
    tracks: [{
      title: "Version Song (Dub Mix)",
      artist_credit: "Dub Artist",
      recording_intent: "dub"
    }]
  });
  assert.equal(explicitVersion.added_count, 1, JSON.stringify(explicitVersion));
});

test("playlist preflight resolves MusicBrainz before Roon and persists the canonical recording identity", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const roonTrack = mediaTrack("canonical-roon", "Canonical Song", "Canonical Artist, Secondary Credit", {
    album: "Roon Edition",
    durationSeconds: 239
  });
  const media = fakeMedia((request) =>
    request.query === "Canonical Song Canonical Artist" ? [roonTrack] : []
  );
  let enrichmentCalls = 0;
  const metadataService = {
    enrichResult: async (result, hints) => {
      enrichmentCalls += 1;
      assert.equal(hints.catalog_profile.recording.musicbrainz_id, "mb-recording-1");
      return ({
      result,
      audio_metadata: {
        title: result.title,
        artist: result.artist,
        album: result.album,
        duration_seconds: result.duration_seconds,
        metadata_status: "partial"
      },
      report: {
        observed_at: "2026-07-27T20:00:00.000Z",
        album_result_id: null,
        warnings: []
      }
      });
    }
  };
  let binding = null;
  const trackCatalogService = {
    resolve: async (input) => {
      assert.equal(input.title, "Model Song");
      assert.equal(input.artist, "Model Artist");
      return {
        resolution: { status: "exact" },
        profile: {
          status: "exact",
          reason: "unique_compatible_recording",
          recording: {
            musicbrainz_id: "mb-recording-1",
            title: "Canonical Song",
            artist_credit: [{ musicbrainz_id: "mb-artist-1", name: "Canonical Artist", join_phrase: "" }],
            disambiguation: null,
            duration_seconds: 240,
            duration_source: "musicbrainz_recording_median",
            isrcs: ["USAAA2600001"]
          },
          composers: ["Composer"],
          lyricists: ["Lyricist"],
          genres: [{ name: "rock", count: 2, entity: "recording" }],
          release_group: {
            musicbrainz_id: "mb-release-group-1",
            title: "Canonical Album",
            artist_credit: [{ musicbrainz_id: "mb-artist-1", name: "Canonical Artist", join_phrase: "" }],
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
        }
      };
    },
    bind: (recordingId, result, origin) => {
      binding = { recordingId, resultId: result.result_id, origin };
      return {
        binding_id: "binding-1",
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
  const builder = new PlaylistBuildService(
    playlistService,
    media,
    undefined,
    "streaming_first",
    metadataService,
    trackCatalogService
  );

  const result = await builder.prepareCandidate({
    title: "Model Song",
    artist_credit: "Model Artist"
  });

  assert.equal(result.accepted, true);
  assert.equal(result.candidate.musicbrainz_recording_id, "mb-recording-1");
  assert.equal(result.track.audio_metadata.recording.musicbrainz_id, "mb-recording-1");
  assert.equal(result.track.artist, "Canonical Artist");
  assert.equal(result.track.album, "Canonical Album");
  assert.equal(result.track.audio_metadata.duration_seconds, 240);
  assert.equal(result.track.audio_metadata.composer, "Composer");
  assert.equal(result.track.resolution.catalog_identity.recording.musicbrainz_id, "mb-recording-1");
  assert.deepEqual(binding, {
    recordingId: "mb-recording-1",
    resultId: "canonical-roon",
    origin: "automatic"
  });
  assert.deepEqual(media.searches.map((request) => request.query), ["Canonical Song Canonical Artist"]);
  assert.equal(enrichmentCalls, 1);
});

test("playlist preflight sends ambiguous MusicBrainz identities to manual selection without searching Roon", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia([]);
  const trackCatalogService = {
    resolve: async () => ({
      resolution: { status: "conflict" },
      profile: {
        status: "ambiguous",
        reason: "multiple_compatible_recordings",
        recording: null,
        warnings: []
      }
    })
  };
  const builder = new PlaylistBuildService(
    playlistService,
    media,
    undefined,
    "streaming_first",
    undefined,
    trackCatalogService
  );

  const result = await builder.prepareCandidate({
    title: "Ambiguous Song",
    artist_credit: "Same Artist"
  });

  assert.equal(result.accepted, false);
  assert.equal(result.rejection.status, "manual_required");
  assert.match(result.rejection.reason, /^musicbrainz_ambiguous:/);
  assert.equal(media.searches.length, 0);
});

test("playlist build enforces the MusicBrainz first-publication year range", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia([]);
  const builder = new PlaylistBuildService(
    playlistService,
    media,
    undefined,
    "streaming_first",
    undefined,
    {
      resolve: async () => ({
        profile: {
          status: "exact",
          reason: "unique_compatible_recording",
          recording: {
            musicbrainz_id: "mb-old",
            title: "Old Song",
            artist_credit: [{ musicbrainz_id: "artist-old", name: "Old Artist", join_phrase: "" }]
          },
          release_group: {
            musicbrainz_id: "group-old",
            title: "Old Album",
            artist_credit: [],
            first_release_date: "2001-01-01",
            release_year: 2001,
            primary_type: "Album",
            secondary_types: [],
            disambiguation: null,
            selection_reason: "earliest_official_album"
          },
          warnings: []
        }
      })
    }
  );

  const result = await builder.build({
    name: "Recent only",
    desired_count: 1,
    release_year_from: 2020,
    tracks: [{ title: "Old Song", artist_credit: "Old Artist" }]
  });

  assert.equal(result.phase, "needs_candidates");
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reason, "musicbrainz_release_year_outside_requested_range");
  assert.equal(result.rejection_summary.by_reason.musicbrainz_release_year_outside_requested_range, 1);
  assert.equal(media.searches.length, 0);
});

test("playlist build keeps complete rejection counts with a bounded MCP payload", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const builder = new PlaylistBuildService(playlistService, fakeMedia([]));
  const tracks = Array.from({ length: 30 }, (_, index) => ({
    title: `Unavailable ${index + 1}`,
    artist_credit: `Unknown ${index + 1}`
  }));

  const result = await builder.build({
    name: "Bounded failures",
    desired_count: 1,
    tracks
  });

  assert.equal(result.phase, "needs_candidates");
  assert.equal(result.rejection_summary.total, 30);
  assert.equal(result.rejection_summary.returned_candidates, 25);
  assert.equal(result.rejected.length, 25);
});
