const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { PlaylistRepairService } = require("../dist/services/playlistRepairService");
const { PlaylistService } = require("../dist/services/playlistService");

function tempConfig() {
  return {
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "roonia-playlist-rebuild-")),
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

function playableTrack(id, title, artist, album, duration) {
  return {
    result_id: id,
    roon_item_key: `roon:${id}`,
    type: "track",
    media_type: "track",
    title,
    artist,
    artists: [{ type: "artist", title: artist, artist: null, result_id: null }],
    subtitle: artist,
    album,
    album_artist: artist,
    version_hint: "studio",
    version_penalties: [],
    source: "tidal",
    source_confidence: "high",
    quality: null,
    image_key: "cover",
    is_library: false,
    playable: true,
    is_best_match: true,
    selection_required: false,
    match_score: 100,
    confidence: "high",
    match_reasons: [],
    match_penalties: [],
    warnings: [],
    duration_seconds: duration,
    release_year: 2011,
    track_number: 2,
    disc_number: 1,
    expires_at: new Date(Date.now() + 60_000).toISOString()
  };
}

function catalogProfile() {
  return {
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
    genres: [{ name: "ambient", count: 2, entity: "recording" }],
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
}

test("playlist reconstruction migrates legacy identity while preserving order and user data", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const playlist = playlistService.createPlaylist({
    name: "Legacy dinner",
    tracks: [{
      query: "Hours Tycho",
      roon_item_key: "stale:hours",
      title: "Hours",
      artist: "Tycho, Zac Brown",
      user_metadata: {
        note: "Keep this note",
        llm_hints: { album: "Dive" }
      },
      audio_metadata: {
        title: "Hours",
        artist: "Tycho, Zac Brown",
        source: "tidal",
        metadata_status: "partial"
      },
      resolution: {
        status: "resolved",
        selected_result_id: "old:hours",
        selected_candidate: { title: "Hours", artist: "Tycho, Zac Brown" }
      }
    }]
  });
  let catalogLookups = 0;
  let refreshTrackIds = null;
  const mediaService = {
    async search(request) {
      const result = playableTrack("fresh-hours", "Hours", "Tycho, Zac Brown", "Dive", 344);
      return {
        query: request.query,
        results: [result],
        recommended_result_id: result.result_id,
        selection_required: false,
        warnings: []
      };
    }
  };
  const metadataService = {
    async refreshPlaylist(playlistId, options) {
      refreshTrackIds = options.trackIds;
      return {
        playlist_id: playlistId,
        attempted: 0,
        completed: 0,
        partial: 0,
        skipped: 0,
        failed: 0,
        conflict: 0,
        unverified: 0,
        tracks: [],
        playlist: playlistService.getPlaylist(playlistId)
      };
    }
  };
  const repair = new PlaylistRepairService(
    playlistService,
    mediaService,
    metadataService,
    undefined,
    {
      async resolve(input) {
        catalogLookups += 1;
        assert.equal(input.title, "Hours");
        return { resolution: { status: "exact" }, profile: catalogProfile() };
      }
    }
  );

  const started = repair.startRebuild({
    playlistId: playlist.playlist_id,
    scope: "all"
  });
  const duplicateStart = repair.startRebuild({
    playlistId: playlist.playlist_id,
    scope: "all"
  });
  assert.equal(duplicateStart.job_id, started.job_id);
  assert.equal(started.status, "queued");
  assert.equal(started.progress.total_tracks, 1);
  const result = await waitForRebuild(repair, started);
  const track = result.playlist.tracks[0];

  assert.equal(catalogLookups, 1);
  assert.equal(refreshTrackIds, null);
  assert.equal(result.playlist.name, "Legacy dinner");
  assert.equal(track.position, 1);
  assert.equal(track.title, "Hours");
  assert.equal(track.artist, "Tycho");
  assert.equal(track.album, "Dive");
  assert.equal(track.audio_metadata.duration_seconds, 344);
  assert.equal(track.audio_metadata.metadata_status, "exact");
  assert.equal(track.identity.recording_id, "mb-hours");
  assert.equal(track.resolution.status, "resolved");
  assert.equal(track.resolution.selected_result_id, "fresh-hours");
  assert.equal(track.user_metadata.note, "Keep this note");
  assert.deepEqual(track.user_metadata.llm_hints, { album: "Dive" });
  assert.equal(result.report.migrated, 1);
  assert.equal(result.report.complete, true);
});

test("playlist reconstruction reuses an existing exact MusicBrainz identity", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const profile = catalogProfile();
  const playlist = playlistService.createPlaylist({
    name: "Current",
    tracks: [{
      query: "Hours Tycho",
      title: "Hours",
      artist: "Tycho",
      album: "Dive",
      roon_item_key: "old-hours",
      audio_metadata: {
        title: "Hours",
        artist: "Tycho",
        album: "Dive",
        duration_seconds: 344,
        source: "tidal",
        metadata_status: "exact",
        catalog: profile
      },
      resolution: { status: "manual", selected_result_id: "manual-hours" }
    }]
  });
  let catalogLookups = 0;
  const repair = new PlaylistRepairService(
    playlistService,
    { search: async () => { throw new Error("manual bindings must not be replaced"); } },
    {
      async refreshPlaylist(playlistId, options) {
        assert.deepEqual(options.trackIds, []);
        return { playlist_id: playlistId, tracks: [], playlist: playlistService.getPlaylist(playlistId) };
      }
    },
    undefined,
    { resolve: async () => { catalogLookups += 1; } }
  );

  const result = await waitForRebuild(repair, repair.startRebuild({
    playlistId: playlist.playlist_id,
    scope: "all"
  }));

  assert.equal(catalogLookups, 0);
  assert.equal(result.report.preserved, 1);
  assert.equal(result.playlist.tracks[0].resolution.status, "manual");
  assert.equal(result.playlist.tracks[0].resolution.selected_result_id, "manual-hours");
});
async function waitForRebuild(service, started) {
  let job = started;
  for (let attempt = 0; attempt < 100 && !["completed", "failed"].includes(job.status); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    job = service.getRebuild(job.job_id, job.playlist_id);
  }
  assert.equal(job.status, "completed", job.error?.message);
  return job.result;
}
