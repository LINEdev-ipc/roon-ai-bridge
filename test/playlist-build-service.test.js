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

test("temporary playlist builds finalize in one call and preserve their hidden lifecycle", async () => {
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
    tracks: [
      { title: "First Song", artist_credit: "Artist One" },
      { title: "Second Song", artist_credit: "Artist Two" }
    ]
  });
  assert.equal(initial.phase, "finalized");
  assert.equal(initial.complete, true);
  assert.equal(initial.playlist.lifecycle.type, "temporary");
  assert.equal(initial.playlist.lifecycle.intent, "music for focused work");
  assert.equal(playlistService.listPlaylists().total, 0);
  assert.equal(playlistService.listPlaylists({ scope: "temporary" }).total, 1);
});

test("playlist build saves every verified track as a partial result in one call", async () => {
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
    tracks: [
      { candidate_id: "p1", title: "First Song", artist_credit: "Artist One" },
      { candidate_id: "p2", title: "Unavailable Song", artist_credit: "Nobody" },
      { candidate_id: "r1", role: "reserve", title: "Second Song", artist_credit: "Artist Two" },
      { candidate_id: "r2", role: "reserve", title: "Still Unavailable", artist_credit: "Nobody Else" }
    ]
  });
  assert.equal(initial.phase, "finalized");
  assert.equal(initial.complete, false);
  assert.equal(initial.added_count, 2);
  assert.equal(initial.missing_count, 1);
  assert.equal(initial.playlist.tracks_count, 2);
  assert.equal(initial.rejection_summary.total, 2);
  assert.equal(playlistService.listPlaylists().total, 1);
});

test("playlist build refuses a generated target without a candidate pool", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia(() => []);
  const builder = new PlaylistBuildService(playlistService, media);

  await assert.rejects(
    builder.build({
      name: "Missing candidates",
      desired_count: 20,
      tracks: []
    }),
    (error) => error?.code === "INVALID_PLAYLIST"
      && /non-empty candidate pool/.test(error.message)
  );
  assert.equal(playlistService.listPlaylists().total, 0);
});

test("playlist build reports the adaptive reserve policy and stops after reaching the target", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia((request) =>
    request.query.includes("First Song")
      ? [mediaTrack("first-idempotent", "First Song", "Artist One")]
      : request.query.includes("Second Song")
        ? [mediaTrack("second-idempotent", "Second Song", "Artist Two")]
        : []
  );
  const builder = new PlaylistBuildService(playlistService, media);
  const completed = await builder.build({
    name: "Adaptive reserves",
    desired_count: 2,
    selection_complexity: "exact_versions",
    tracks: [
      { candidate_id: "first", title: "First Song", artist_credit: "Artist One" },
      { candidate_id: "second", title: "Second Song", artist_credit: "Artist Two" },
      { candidate_id: "unused", role: "reserve", title: "Unavailable", artist_credit: "Nobody" },
      { candidate_id: "unused-2", role: "reserve", title: "Unavailable 2", artist_credit: "Nobody" }
    ]
  });
  assert.equal(completed.phase, "finalized");
  assert.equal(completed.complete, true);
  assert.equal(completed.playlist.tracks_count, 2);
  assert.deepEqual(completed.performance.reserve_policy, {
    complexity: "exact_versions",
    multiplier: 1.6,
    desired_count: 2,
    recommended_candidates: 4,
    supplied_candidates: 4,
    sufficient: true
  });
  assert.equal(media.searches.length, 2);
  assert.equal(completed.performance.roon_searches, 2);
  assert.equal(completed.performance.musicbrainz_requests, 0);
  assert.equal(completed.performance.listenbrainz_requests, 0);
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

test("canonical Roon direct matches tolerate edition annotations and canonical mix titles", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia((request) => {
    if (request.query.includes("180db_")) {
      return [mediaTrack("aphex-tempo", "180db_ [130]", "Aphex Twin, Richard D. James")];
    }
    if (request.query.includes("Cosmic Surfin")) {
      return [mediaTrack(
        "ymo-remaster",
        "Cosmic Surfin' (2018 Bob Ludwig Remastering)",
        "Haruomi Hosono, Yellow Magic Orchestra"
      )];
    }
    if (request.query.includes("syro u473t8")) {
      return [mediaTrack(
        "aphex-canonical-mix",
        "Syro u473t8+e [Piezoluminescence Mix]",
        "Aphex Twin, Richard D. James",
        { versionHint: "remix" }
      )];
    }
    if (request.query.includes("Natural Blues")) {
      return [
        mediaTrack("moby-direct-a", "Natural Blues", "Alan Lomax, Moby, Vera Hall"),
        mediaTrack("moby-direct-b", "Natural Blues", "Alan Lomax, Moby, Vera Hall")
      ];
    }
    return [];
  });

  const result = await new PlaylistBuildService(playlistService, media).build({
    name: "Canonical direct matches",
    desired_count: 4,
    tracks: [
      { title: "180db_", artist_credit: "Aphex Twin" },
      { title: "Cosmic Surfin’", artist_credit: "Yellow Magic Orchestra" },
      {
        title: "syro u473t8+e (piezoluminescence mix)",
        artist_credit: "Aphex Twin",
        recording_intent: "standard"
      },
      { title: "Natural Blues", artist_credit: "Moby" }
    ]
  });

  assert.equal(result.complete, true);
  assert.equal(result.added_count, 4);
  assert.deepEqual(
    result.playlist.tracks.map((track) => track.resolution.selected_result_id),
    ["aphex-tempo", "ymo-remaster", "aphex-canonical-mix", "moby-direct-a"]
  );
});

test("cover artists and album-anchored live or acoustic performances bind without invented title suffixes", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia((request) => {
    if (request.query.includes("Hallelujah")) {
      return [mediaTrack("buckley-cover", "Hallelujah", "Jeff Buckley", {
        album: "Grace"
      })];
    }
    if (request.query.includes("Inevitable")) {
      return [mediaTrack("shakira-unplugged", "Inevitable", "Shakira", {
        album: "MTV Unplugged"
      })];
    }
    if (request.query.includes("Pennyroyal Tea")) {
      return [mediaTrack("nirvana-live", "Pennyroyal Tea", "Nirvana", {
        album: "MTV Unplugged in New York"
      })];
    }
    if (request.query.includes("Wrong Acoustic")) {
      return [mediaTrack("wrong-studio", "Wrong Acoustic", "Artist", {
        album: "Studio Album"
      })];
    }
    if (request.query.includes("Reserve Song")) {
      return [mediaTrack("reserve-studio", "Reserve Song", "Artist")];
    }
    return [];
  });

  const result = await new PlaylistBuildService(playlistService, media).build({
    name: "Performance semantics",
    desired_count: 4,
    tracks: [
      {
        title: "Hallelujah",
        artist_credit: "Jeff Buckley",
        album_hint: "Grace",
        recording_intent: "cover"
      },
      {
        title: "Inevitable",
        artist_credit: "Shakira",
        album_hint: "MTV Unplugged",
        recording_intent: "acoustic"
      },
      {
        title: "Pennyroyal Tea",
        artist_credit: "Nirvana",
        album_hint: "MTV Unplugged in New York",
        recording_intent: "live"
      },
      {
        candidate_id: "wrong-acoustic",
        title: "Wrong Acoustic",
        artist_credit: "Artist",
        album_hint: "Acoustic Sessions",
        recording_intent: "acoustic"
      },
      {
        role: "reserve",
        title: "Reserve Song",
        artist_credit: "Artist"
      }
    ]
  });

  assert.equal(result.complete, true);
  assert.deepEqual(
    result.playlist.tracks.map((track) => track.resolution.selected_result_id),
    ["buckley-cover", "shakira-unplugged", "nirvana-live", "reserve-studio"]
  );
  assert.equal(
    result.rejected.find((candidate) => candidate.candidate_id === "wrong-acoustic").status,
    "missing"
  );
});

test("real-shaped acoustic results bind after release verification across Roon version classes", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia(() => [
    mediaTrack("shakira-unplugged", "Inevitable (En Vivo)", "Luis Fernando Ochoa, Shakira", {
      versionHint: "live"
    }),
    mediaTrack(
      "corrs-unplugged",
      "What Can I Do (MTV Unplugged Version)",
      "Andrea Corr, Caroline Corr, Jim Corr, Sharon Corr, The Corrs",
      { versionHint: "alternate" }
    )
  ]);
  const catalog = (input) => ({
    status: "exact",
    reason: "unique_compatible_recording_from_release_observation_identity_only",
    recording: {
      musicbrainz_id: input.title === "Inevitable" ? "mb-shakira-unplugged" : "mb-corrs-unplugged",
      title: input.title,
      artist_credit: input.title === "Inevitable"
        ? [
            { musicbrainz_id: "writer", name: "Luis Fernando Ochoa", join_phrase: ", " },
            { musicbrainz_id: "shakira", name: "Shakira", join_phrase: "" }
          ]
        : [{ musicbrainz_id: "corrs", name: "The Corrs", join_phrase: "" }],
      disambiguation: "acoustic performance",
      duration_seconds: input.title === "Inevitable" ? 219 : 224,
      duration_source: "musicbrainz_recording_median",
      isrcs: []
    },
    composers: [],
    lyricists: [],
    genres: [],
    release_group: {
      musicbrainz_id: `group-${input.title}`,
      title: input.album_observation,
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
    warnings: ["metadata_enrichment_pending"]
  });
  const trackCatalogService = {
    resolve: async (input) => {
      assert.equal(input.require_release_match, true);
      return { resolution: { status: "exact" }, profile: catalog(input) };
    },
    bind: () => ({ status: "observed" })
  };
  const metadataService = {
    enrichResult: async (result, hints) => {
      assert.equal(hints.verify_release, true);
      const album = result.result_id === "shakira-unplugged" ? "MTV Unplugged" : "Unplugged";
      const duration = result.result_id === "shakira-unplugged" ? 219 : 224;
      return {
        result: { ...result, album, duration_seconds: duration },
        audio_metadata: {
          title: result.title,
          artist: result.artist,
          album,
          duration_seconds: duration,
          metadata_status: "exact"
        },
        report: {
          observed_at: "2026-07-28T22:00:00.000Z",
          album_result_id: `album-${result.result_id}`,
          warnings: []
        }
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

  const shakira = await builder.prepareCandidate({
    title: "Inevitable",
    artist_credit: "Shakira",
    album_hint: "MTV Unplugged",
    recording_intent: "acoustic"
  });
  assert.equal(shakira.accepted, true, JSON.stringify(shakira));

  const result = await builder.build({
    name: "Acoustic release evidence",
    desired_count: 2,
    enqueue_metadata_enrichment: false,
    tracks: [
      {
        title: "Inevitable",
        artist_credit: "Shakira",
        album_hint: "MTV Unplugged",
        recording_intent: "acoustic"
      },
      {
        title: "What Can I Do",
        artist_credit: "The Corrs",
        album_hint: "Unplugged",
        recording_intent: "acoustic"
      }
    ]
  });

  assert.equal(result.complete, true);
  assert.equal(result.added_count, 2);
  assert.deepEqual(
    result.playlist.tracks.map((track) => track.resolution.selected_result_id),
    ["shakira-unplugged", "corrs-unplugged"]
  );
  assert.ok(media.searches.every((request) => !request.query.includes("Luis Fernando Ochoa")));
});

test("exact live binding rejects another concert and selects the requested release", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia(() => [
    mediaTrack(
      "nina-wrong-concert",
      "The Other Woman (Live In New York, 1964)",
      "Nina Simone, Jessie Mae Robinson",
      { versionHint: "live" }
    ),
    mediaTrack(
      "nina-town-hall",
      "The Other Woman (Live at Town Hall)",
      "Nina Simone, Jessie Mae Robinson",
      { versionHint: "live" }
    )
  ]);
  const profile = {
    status: "exact",
    reason: "unique_compatible_recording_from_release_observation_identity_only",
    recording: {
      musicbrainz_id: "mb-nina-town-hall",
      title: "The Other Woman",
      artist_credit: [{ musicbrainz_id: "nina", name: "Nina Simone", join_phrase: "" }],
      disambiguation: "live, 1959: Town Hall",
      duration_seconds: 185,
      duration_source: "musicbrainz_recording_median",
      isrcs: []
    },
    composers: [],
    lyricists: [],
    genres: [],
    release_group: {
      musicbrainz_id: "group-town-hall",
      title: "Nina Simone at Town Hall",
      artist_credit: [],
      first_release_date: "1959",
      release_year: 1959,
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
    warnings: ["metadata_enrichment_pending"]
  };
  const trackCatalogService = {
    resolve: async (input) => {
      assert.equal(input.require_release_match, true);
      return { resolution: { status: "exact" }, profile };
    },
    bind: () => ({ status: "observed" })
  };
  const metadataService = {
    enrichResult: async (result, hints) => {
      assert.equal(hints.verify_release, true);
      const correct = result.result_id === "nina-town-hall";
      const album = correct ? "Nina Simone at Town Hall" : "Live & Kickin (Vol. 1)";
      const duration = correct ? 185 : 255;
      return {
        result: { ...result, album, duration_seconds: duration },
        audio_metadata: {
          title: result.title,
          artist: result.artist,
          album,
          duration_seconds: duration,
          metadata_status: "exact"
        },
        report: {
          observed_at: "2026-07-28T22:00:00.000Z",
          album_result_id: `album-${result.result_id}`,
          warnings: []
        }
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

  const result = await builder.build({
    name: "Exact concert",
    desired_count: 1,
    enqueue_metadata_enrichment: false,
    tracks: [{
      title: "The Other Woman",
      artist_credit: "Nina Simone",
      album_hint: "Nina Simone at Town Hall",
      release_year_hint: 1959,
      recording_intent: "live",
      performance_sensitive: true
    }]
  });

  assert.equal(result.complete, true);
  assert.equal(result.playlist.tracks[0].resolution.selected_result_id, "nina-town-hall");
  assert.equal(result.playlist.tracks[0].album, "Nina Simone at Town Hall");
});

test("an empty diagnostic build preserves every rejection in the error details", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const builder = new PlaylistBuildService(playlistService, fakeMedia(() => []));

  await assert.rejects(
    builder.build({
      name: "Diagnostic failure",
      desired_count: 2,
      diagnostics: true,
      tracks: [
        { candidate_id: "missing-1", title: "Missing One", artist_credit: "Nobody" },
        { candidate_id: "missing-2", title: "Missing Two", artist_credit: "Nobody" }
      ]
    }),
    (error) => {
      assert.equal(error.code, "PLAYLIST_BUILD_INCOMPLETE");
      assert.equal(error.details.rejected_count, 2);
      assert.equal(error.details.rejected.length, 2);
      assert.equal(error.details.diagnostics.rejected_candidates.length, 2);
      assert.equal(error.details.diagnostics.candidate_metrics.length, 2);
      return true;
    }
  );
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

  const wrongVersion = await builder.prepareCandidate({
    title: "Version Song",
    artist_credit: "Dub Artist"
  });
  assert.equal(wrongVersion.accepted, false);

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

test("playlist preflight overlaps speculative Roon discovery with MusicBrainz and persists canonical identity", async () => {
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
      assert.equal(input.release_year, undefined);
      assert.equal(input.release_year_observation, 2011);
      assert.equal(input.metadata_depth, "identity");
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
    artist_credit: "Model Artist",
    release_year_hint: 2011
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
  assert.deepEqual(media.searches.map((request) => request.query), [
    "Model Song Model Artist",
    "Canonical Song Canonical Artist"
  ]);
  assert.equal(enrichmentCalls, 1);
});

test("playlist binding accepts equivalent Roon editions when canonical duration agrees", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia(() => [
    mediaTrack("edition-gb", "Edition Song", "Edition Artist", {
      album: "Original Album (GB)",
      durationSeconds: 240
    }),
    mediaTrack("edition-us", "Edition Song", "Edition Artist", {
      album: "Original Album (US)",
      durationSeconds: 240
    })
  ]);
  const trackCatalogService = {
    resolve: async () => ({
      resolution: {
        status: "exact",
        trace: {
          provider_requests: 1,
          cache_hit: false,
          listenbrainz: null
        }
      },
      profile: {
        status: "exact",
        reason: "unique_compatible_recording_identity_only",
        recording: {
          musicbrainz_id: "edition-recording",
          title: "Edition Song",
          artist_credit: [{
            musicbrainz_id: "edition-artist",
            name: "Edition Artist",
            join_phrase: ""
          }],
          disambiguation: null,
          duration_seconds: 240,
          duration_source: "musicbrainz_recording_median",
          isrcs: []
        },
        composers: [],
        lyricists: [],
        genres: [],
        release_group: {
          musicbrainz_id: "edition-group",
          title: "Original Album",
          artist_credit: [],
          first_release_date: "2020-01-01",
          release_year: 2020,
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
        warnings: ["metadata_enrichment_pending"]
      }
    }),
    bind: () => ({ status: "observed" })
  };
  const builder = new PlaylistBuildService(
    playlistService,
    media,
    undefined,
    "streaming_first",
    undefined,
    trackCatalogService
  );

  const result = await builder.build({
    name: "Equivalent editions",
    desired_count: 1,
    enqueue_metadata_enrichment: false,
    tracks: [{
      title: "Edition Song",
      artist_credit: "Edition Artist",
      performance_sensitive: true
    }]
  });

  assert.equal(result.complete, true);
  assert.equal(result.added_count, 1);
  assert.equal(result.playlist.tracks[0].resolution.selected_candidate.result_id, "edition-gb");
  assert.deepEqual(result.performance.metadata_enrichment, {
    mode: "disabled",
    queued_tracks: 1
  });
});

test("playlist creation queues full MusicBrainz enrichment after the playable list is saved", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia(() => [
    mediaTrack("background-track", "Background Song", "Background Artist", {
      album: "Background Album",
      durationSeconds: 215
    })
  ]);
  const profile = (full) => ({
    status: "exact",
    reason: full ? "verified_recording_mbid" : "unique_compatible_recording_identity_only",
    recording: {
      musicbrainz_id: "background-recording",
      title: "Background Song",
      artist_credit: [{
        musicbrainz_id: "background-artist",
        name: "Background Artist",
        join_phrase: ""
      }],
      disambiguation: null,
      duration_seconds: 215,
      duration_source: "musicbrainz_recording_median",
      isrcs: ["GBTEST2600002"]
    },
    composers: full ? ["Background Composer"] : [],
    lyricists: [],
    genres: full ? [{ name: "electronic", count: 1, entity: "recording" }] : [],
    release_group: {
      musicbrainz_id: "background-group",
      title: "Background Album",
      artist_credit: [],
      first_release_date: "2026-01-01",
      release_year: 2026,
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
    warnings: full ? [] : ["metadata_enrichment_pending"]
  });
  const resolveInputs = [];
  const trackCatalogService = {
    resolve: async (input) => {
      resolveInputs.push(input);
      return {
        resolution: { status: "exact" },
        profile: profile(Boolean(input.recording_id))
      };
    },
    bind: () => ({ status: "observed" })
  };
  const builder = new PlaylistBuildService(
    playlistService,
    media,
    undefined,
    "streaming_first",
    undefined,
    trackCatalogService
  );

  const result = await builder.build({
    name: "Background enrichment",
    tracks: [{ title: "Background Song", artist_credit: "Background Artist" }]
  });

  assert.deepEqual(result.performance.metadata_enrichment, {
    mode: "background",
    queued_tracks: 1
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const stored = playlistService.getPlaylist(result.playlist.playlist_id).tracks[0];
  assert.equal(resolveInputs.length, 2);
  assert.equal(resolveInputs[0].metadata_depth, "identity");
  assert.equal(resolveInputs[1].metadata_depth, "full");
  assert.equal(resolveInputs[1].recording_id, "background-recording");
  assert.equal(stored.audio_metadata.composer, "Background Composer");
  assert.equal(stored.audio_metadata.genre, "electronic");
});

test("playlist preflight can reject ambiguous MusicBrainz identity after speculative Roon discovery", async () => {
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
  assert.equal(media.searches.length, 1);
});

test("playlist build enforces the MusicBrainz first-publication year range", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia((request) =>
    request.query.includes("Recent Song")
      ? [mediaTrack("recent", "Recent Song", "Recent Artist")]
      : []
  );
  const builder = new PlaylistBuildService(
    playlistService,
    media,
    undefined,
    "streaming_first",
    undefined,
    {
      resolve: async (input) => ({
        profile: {
          status: "exact",
          reason: "unique_compatible_recording",
          recording: {
            musicbrainz_id: input.title === "Old Song" ? "mb-old" : "mb-recent",
            title: input.title,
            artist_credit: [{
              musicbrainz_id: input.title === "Old Song" ? "artist-old" : "artist-recent",
              name: input.artist,
              join_phrase: ""
            }],
            duration_seconds: null,
            isrcs: []
          },
          work: null,
          credits: [],
          composers: [],
          lyricists: [],
          genres: [],
          release_group: {
            musicbrainz_id: input.title === "Old Song" ? "group-old" : "group-recent",
            title: input.title === "Old Song" ? "Old Album" : "Recent Album",
            artist_credit: [],
            first_release_date: input.title === "Old Song" ? "2001-01-01" : "2025-01-01",
            release_year: input.title === "Old Song" ? 2001 : 2025,
            primary_type: "Album",
            secondary_types: [],
            disambiguation: null,
            selection_reason: "earliest_official_album"
          },
          release: null,
          cover_art: null,
          roon_binding: null,
          provenance: { canonical_metadata: "musicbrainz", cover_art: null, playback: null },
          warnings: []
        }
      }),
      bind: () => ({ status: "observed" })
    }
  );

  const result = await builder.build({
    name: "Recent only",
    desired_count: 1,
    release_year_from: 2020,
    tracks: [
      { title: "Old Song", artist_credit: "Old Artist" },
      { title: "Recent Song", artist_credit: "Recent Artist", role: "reserve" }
    ]
  });

  assert.equal(result.phase, "finalized");
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected[0].reason, "musicbrainz_release_year_outside_requested_range");
  assert.equal(result.rejection_summary.by_reason.musicbrainz_release_year_outside_requested_range, 1);
  assert.equal(media.searches.length, 2);
});

test("playlist build keeps complete rejection counts with a bounded MCP payload", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const media = fakeMedia((request) =>
    request.query.includes("Available")
      ? [mediaTrack("available", "Available", "Known Artist")]
      : []
  );
  const builder = new PlaylistBuildService(playlistService, media);
  const tracks = Array.from({ length: 30 }, (_, index) => ({
    title: `Unavailable ${index + 1}`,
    artist_credit: `Unknown ${index + 1}`
  }));
  tracks.unshift({ title: "Available", artist_credit: "Known Artist" });

  const result = await builder.build({
    name: "Bounded failures",
    desired_count: 2,
    diagnostics: true,
    tracks
  });

  assert.equal(result.phase, "finalized");
  assert.equal(result.rejection_summary.total, 30);
  assert.equal(result.rejection_summary.returned_candidates, 25);
  assert.equal(result.rejected.length, 25);
  assert.equal(result.diagnostics.rejected_candidates.length, 30);
  assert.equal(result.diagnostics.candidate_metrics.length, 31);
});
