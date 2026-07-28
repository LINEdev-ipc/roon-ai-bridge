const assert = require("node:assert/strict");
const test = require("node:test");

const { IntentGateway } = require("../dist/bridge-v2/intentGateway");
const { TargetResolver } = require("../dist/bridge-v2/targetResolver");
const { normalizeServiceResult } = require("../dist/bridge-v2/contracts");
const { PlaylistBuildService } = require("../dist/services/playlistBuildService");
const { PlaylistMetadataEnrichmentService } = require("../dist/services/playlistMetadataEnrichmentService");
const { PlaylistRepairService } = require("../dist/services/playlistRepairService");

function zone(id, name, state = "stopped") {
  return { zone_id: id, display_name: name, state, outputs: [] };
}

function roonClient(zones = []) {
  return {
    getZones: () => zones,
    getOutputs: () => [],
    getKnownOutputs: () => [],
    getZone: (id) => zones.find((item) => item.zone_id === id) || null,
    getOutput: () => null,
    isCoreConnected: () => true,
    getCoreName: () => "Core",
    isTransportReady: () => true,
    isBrowseReady: () => true,
    isImageReady: () => true
  };
}

function gatewayContext(client, mediaService) {
  const noop = () => {};
  const context = {
    config: {},
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    roonClient: client,
    mediaService,
    playlistService: {},
    zonePresetService: {},
    volumeLimitService: { activeSafetyLimits: () => [] }
  };
  const playlistProxy = new Proxy({}, {
    get(_target, property) {
      const value = context.playlistService[property];
      return typeof value === "function" ? value.bind(context.playlistService) : value;
    }
  });
  context.playlistMetadataEnrichmentService = new PlaylistMetadataEnrichmentService(
    playlistProxy,
    mediaService,
    context.logger
  );
  context.playlistBuildService = new PlaylistBuildService(
    playlistProxy,
    mediaService,
    context.logger,
    "streaming_first",
    context.playlistMetadataEnrichmentService
  );
  context.playlistRepairService = new PlaylistRepairService(
    playlistProxy,
    mediaService,
    context.playlistMetadataEnrichmentService,
    context.logger
  );
  return context;
}

test("v2 target resolver accepts IDs and accent-insensitive exact names", () => {
  const client = roonClient([zone("z1", "Salón"), zone("z2", "Despacho")]);
  const resolver = new TargetResolver(client);

  assert.equal(resolver.zone({ name: "salon" }).zone_id, "z1");
  assert.equal(resolver.zone({ id: "z2" }).display_name, "Despacho");
  assert.throws(() => resolver.zone({ name: "Cocina" }), /not found/i);
});

test("v2 play intent resolves a query and acts without a preliminary zone-list call", async () => {
  const client = roonClient([zone("z1", "Despacho", "playing")]);
  let searches = 0;
  let plays = 0;
  const mediaService = {
    search: async () => {
      searches += 1;
      return {
        recommended_result_id: "result-1",
        selection_required: false,
        results: [{ result_id: "result-1", media_type: "album", title: "Kid A" }]
      };
    },
    play: async (resultId, zoneId, mode) => {
      plays += 1;
      assert.deepEqual([resultId, zoneId, mode], ["result-1", "z1", "replace_queue"]);
      return { ok: true };
    }
  };
  const gateway = new IntentGateway(gatewayContext(client, mediaService));

  const result = await gateway.playMedia({
    zone: { name: "Despacho" },
    media: { query: "Kid A de Radiohead", type: "album" }
  });

  assert.equal(searches, 1);
  assert.equal(plays, 1);
  assert.equal(result.status, "completed");
  assert.equal(result.operation, "roon_play_media");
});

test("v2 play intent returns candidates and never acts on an ambiguous search", async () => {
  const client = roonClient([zone("z1", "Despacho")]);
  let plays = 0;
  const mediaService = {
    search: async () => ({
      recommended_result_id: "one",
      selection_required: true,
      results: [
        { result_id: "one", media_type: "track", title: "Song" },
        { result_id: "two", media_type: "track", title: "Song (Live)" }
      ]
    }),
    play: async () => { plays += 1; }
  };
  const gateway = new IntentGateway(gatewayContext(client, mediaService));

  const result = await gateway.playMedia({
    zone: { name: "Despacho" },
    media: { query: "Song", type: "track" }
  });

  assert.equal(result.status, "ambiguous");
  assert.equal(plays, 0);
  assert.equal(result.data.candidates.length, 2);
});

test("v2 media detail forwards playlist pagination to the native Roon reader", async () => {
  let received;
  const mediaService = {
    get: () => ({ result_id: "playlist-result", media_type: "playlist", title: "Reference Mix" }),
    getPlaylistDetail: async (...args) => {
      received = args;
      return {
        playlist: { result_id: "playlist-result", title: "Reference Mix" },
        tracks: [{ playlist_position: 101, title: "Track 101" }],
        pagination: { total: 175, limit: 100, offset: 100, returned: 75, has_more: false }
      };
    }
  };
  const gateway = new IntentGateway(gatewayContext(roonClient(), mediaService));

  const result = await gateway.getMediaEntity({
    result_id: "playlist-result",
    count: 100,
    offset: 100
  });

  assert.deepEqual(received, ["playlist-result", undefined, 100, 100]);
  assert.equal(result.status, "completed");
  assert.equal(result.data.pagination.total, 175);
  assert.equal(result.data.tracks[0].playlist_position, 101);
});

test("v2 batch playlist edits require confirmation before removing tracks", async () => {
  const client = roonClient();
  let removals = 0;
  const context = gatewayContext(client, {});
  context.playlistService = {
    removeTrack: () => { removals += 1; },
    getPlaylist: () => ({ playlist_id: "p1" })
  };
  const gateway = new IntentGateway(context);

  const pending = await gateway.editPlaylistTracks({
    playlist_id: "p1",
    operations: [{ type: "remove", track_id: "t1" }]
  });
  assert.equal(pending.status, "confirmation_required");
  assert.equal(removals, 0);

  const completed = await gateway.editPlaylistTracks({
    playlist_id: "p1",
    operations: [{ type: "remove", track_id: "t1" }],
    confirm: true
  });
  assert.equal(completed.status, "completed");
  assert.equal(removals, 1);
});

test("v2 playlist additions resolve text tracks before returning", async () => {
  const media = {
    search: async (request) => {
      const track = {
        result_id: "search:teardrop",
        roon_item_key: "roon:teardrop",
        type: "track",
        media_type: "track",
        title: "Teardrop",
        artist: "Massive Attack",
        subtitle: "Massive Attack",
        artists: [{ type: "artist", title: "Massive Attack", artist: null, result_id: null }],
        album: "Mezzanine",
        version_hint: "studio",
        source: "tidal",
        playable: true,
        links: { artist: null, artists: [], album: null }
      };
      return { query: request.query, results: [track], recommended_result_id: track.result_id, selection_required: false };
    }
  };
  const context = gatewayContext(roonClient(), media);
  let savedTrack;
  context.playlistService = {
    addTrack: (_playlistId, track) => { savedTrack = track; },
    getPlaylist: () => ({ playlist_id: "p1", tracks: savedTrack ? [savedTrack] : [] })
  };
  const gateway = new IntentGateway(context);

  const result = await gateway.editPlaylistTracks({
    playlist_id: "p1",
    operations: [{ type: "add", track: { title: "Teardrop", artist: "Massive Attack" } }]
  });

  assert.equal(result.status, "completed");
  assert.equal(savedTrack.roon_item_key, "roon:teardrop");
  assert.equal(savedTrack.resolution.status, "resolved");
  assert.equal(savedTrack.resolution.roon_observation.search_result.result_id, "search:teardrop");
  assert.equal(result.data.edit_summary.omitted.length, 0);
});

test("v2 playlist additions omit recordings already present in the target", async () => {
  const context = gatewayContext(roonClient(), {});
  let additions = 0;
  context.playlistService = {
    findDuplicateTrack: () => ({ track_id: "existing-track" }),
    addTrack: () => { additions += 1; },
    getPlaylist: () => ({ playlist_id: "p1", tracks: [] })
  };
  const gateway = new IntentGateway(context);
  gateway.playlistBuildService.prepareCandidate = async () => ({
    accepted: true,
    track: { query: "Teardrop Massive Attack", title: "Teardrop", artist: "Massive Attack" },
    candidate: { title: "Teardrop", artist: "Massive Attack" }
  });

  const result = await gateway.editPlaylistTracks({
    playlist_id: "p1",
    operations: [{ type: "add", track: { title: "Teardrop", artist_credit: "Massive Attack" } }]
  });

  assert.equal(additions, 0);
  assert.equal(result.data.edit_summary.accepted.length, 0);
  assert.equal(result.data.edit_summary.omitted[0].reason, "duplicate_existing_recording");
  assert.equal(result.data.edit_summary.omitted[0].existing_track_id, "existing-track");
});

test("v2 playlist additions omit an unresolved candidate without writing it", async () => {
  const context = gatewayContext(roonClient(), {
    search: async (request) => ({ query: request.query, results: [], recommended_result_id: null, selection_required: false })
  });
  let additions = 0;
  context.playlistService = {
    addTrack: () => { additions += 1; },
    getPlaylist: () => ({ playlist_id: "p1", tracks: [] })
  };

  const result = await new IntentGateway(context).editPlaylistTracks({
    playlist_id: "p1",
    operations: [{ type: "add", track: { title: "Unknown Song", artist_credit: "Unknown Artist" } }]
  });

  assert.equal(result.status, "completed");
  assert.equal(additions, 0);
  assert.equal(result.data.edit_summary.accepted.length, 0);
  assert.equal(result.data.edit_summary.omitted.length, 1);
  assert.match(result.warnings[0], /omitted/i);
});

test("v2 playlist creation validates model candidates and never trusts result_id alone", async () => {
  let searches = 0;
  const media = {
    search: async (request) => {
      searches += 1;
      const track = {
        result_id: "search:teardrop",
        roon_item_key: "roon:teardrop",
        type: "track",
        media_type: "track",
        title: "Teardrop",
        artist: "Massive Attack",
        subtitle: "Massive Attack",
        artists: [{ type: "artist", title: "Massive Attack", artist: null, result_id: null }],
        album: "Mezzanine",
        album_artist: "Massive Attack",
        version_hint: "studio",
        source: "tidal",
        playable: true,
        match_score: 100,
        confidence: "high",
        links: { artist: null, artists: [], album: null }
      };
      return {
        query: request.query,
        results: [track],
        recommended_result_id: track.result_id,
        selection_required: false,
        warnings: []
      };
    }
  };
  const context = gatewayContext(roonClient(), media);
  context.playlistService = {
    savePreparedPlaylist: (input) => ({ playlist_id: "p1", ...input })
  };
  const gateway = new IntentGateway(context);

  const result = await gateway.savePlaylist({
    name: "Trip hop",
    tracks: [{
      result_id: "model:untrusted",
      title: "Teardrop",
      artist_credit: "Massive Attack",
      album_hint: "Mezzanine"
    }]
  });

  const track = result.data.tracks[0];
  assert.equal(searches, 2);
  assert.equal(track.roon_item_key, "roon:teardrop");
  assert.equal(track.resolution.status, "resolved");
  assert.equal(track.resolution.selected_result_id, "search:teardrop");
  assert.equal(track.resolution.selection_origin, "automatic");
  assert.equal(result.data.build_summary.complete, true);
});

test("v2 playlist save never persists an unresolved candidate or an incomplete playlist", async () => {
  const context = gatewayContext(roonClient(), {
    search: async (request) => ({
      query: request.query,
      results: [],
      recommended_result_id: null,
      selection_required: false,
      warnings: []
    })
  });
  let saves = 0;
  context.playlistService = {
    savePreparedPlaylist: (input) => {
      saves += 1;
      return { playlist_id: "p1", ...input };
    }
  };
  const gateway = new IntentGateway(context);

  const initial = await gateway.savePlaylist({
    name: "Needs review",
    desired_count: 1,
    tracks: [{ title: "Angel", artist_credit: "Massive Attack" }]
  });
  assert.equal(initial.status, "needs_input");
  assert.equal(saves, 0);

  const roundOne = await gateway.savePlaylist({
    build_id: initial.data.build_id,
    tracks: [{ title: "Still missing", artist_credit: "Unknown Artist" }]
  });
  assert.equal(roundOne.status, "needs_input");
  assert.equal(saves, 0);

  const roundTwo = await gateway.savePlaylist({
    build_id: initial.data.build_id,
    tracks: [{ title: "Also missing", artist_credit: "Unknown Artist Two" }]
  });
  assert.equal(roundTwo.status, "needs_input");
  assert.equal(saves, 0);
  await assert.rejects(
    gateway.savePlaylist({
      build_id: initial.data.build_id,
      tracks: [{ title: "Still unavailable", artist_credit: "Unknown Artist Three" }]
    }),
    (error) => error.code === "PLAYLIST_BUILD_INCOMPLETE"
  );
  assert.equal(saves, 0);
});

test("v2 playlist save reports a verified partial target as a completed mutation", async () => {
  const context = gatewayContext(roonClient(), {});
  context.playlistBuildService = {
    build: async () => ({
      phase: "finalized",
      build_id: null,
      round: 3,
      next_round: null,
      rounds_remaining: 0,
      desired_count: 20,
      added_count: 13,
      missing_count: 7,
      complete: false,
      playlist: {
        playlist_id: "partial",
        name: "Partial",
        tracks: [],
        tracks_count: 13
      },
      accepted: [],
      rejected: [],
      not_selected: [],
      unused_reserves: 0,
      search_summary: { proposals_seen: 40, valid_recordings: 13, rejected: 27 },
      rejection_summary: {
        total: 27,
        returned_candidates: 25,
        by_status: { missing: 27 },
        by_reason: { musicbrainz_not_found: 27 },
        recovery_actions: []
      }
    })
  };
  context.playlistService = {
    validatePlaylist: () => ({
      summary: { ready: 13, unresolved: 0 },
      issues: []
    })
  };
  const result = await new IntentGateway(context).savePlaylist({
    name: "Partial",
    desired_count: 20,
    tracks: []
  });

  assert.equal(result.status, "completed");
  assert.equal(result.verified, true);
  assert.equal(result.data.build_summary.complete, false);
  assert.equal(result.data.build_summary.added_count, 13);
  assert.equal(result.data.build_summary.missing_count, 7);
  assert.match(result.summary, /13 verified tracks; 7 are missing/);
});

test("v2 playlist reconstruction starts the consolidated asynchronous service", async () => {
  const context = gatewayContext(roonClient(), {});
  let options;
  const gateway = new IntentGateway(context);
  gateway.playlistRepairService = {
    startRebuild: (received) => {
      options = received;
      return {
        job_id: "11111111-1111-4111-8111-111111111111",
        playlist_id: "p1",
        status: "completed",
        phase: "completed",
        scope: "selected",
        progress: { processed_tracks: 1, total_tracks: 1, message: "done" },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error: null,
        result: {
          playlist: { playlist_id: "p1", name: "Legacy", tracks: [], tracks_count: 0 },
          resolution: [{ track_id: "t2", status: "resolved" }],
          enrichment: { completed: 1 },
          report: { complete: true, migrated: 1 }
        }
      };
    }
  };

  const result = await gateway.rebuildPlaylist({
    playlist_id: "p1",
    track_ids: ["t2"],
    scope: "selected"
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(options.trackIds, ["t2"]);
  assert.equal(options.scope, "selected");
  assert.equal(result.operation, "roon_rebuild_playlist");
  assert.equal(result.data.reconstruction.migrated, 1);
});

test("v2 playlist analysis can add read-only identity V2 shadow diagnostics", async () => {
  const context = gatewayContext(roonClient(), {});
  context.playlistService = {
    validatePlaylist: () => ({ valid: true }),
    deduplicatePlaylist: () => ({ duplicates: [] })
  };
  let received;
  context.playlistCatalogDiagnosticsService = {
    analyze: async (playlistId, trackIds) => {
      received = { playlistId, trackIds };
      return {
        mode: "shadow",
        mutates_playlist: false,
        identity_contract_version: 2,
        inspected_track_count: trackIds.length,
        statuses: { exact_recording: trackIds.length },
        tracks: []
      };
    }
  };
  const gateway = new IntentGateway(context);

  const result = await gateway.analyzePlaylist({
    playlist_id: "p1",
    catalog_track_ids: ["t1", "t2"]
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(received, { playlistId: "p1", trackIds: ["t1", "t2"] });
  assert.equal(result.data.catalog_diagnostics.mode, "shadow");
  assert.equal(result.data.catalog_diagnostics.mutates_playlist, false);
});

test("v2 playlist update can repair one track with an exact search result", async () => {
  const media = {
    get: () => ({
      result_id: "result:fixed",
      media_type: "track",
      title: "Angel",
      artist: "Massive Attack",
      roon_item_key: "roon:angel",
      playable: true
    })
  };
  const context = gatewayContext(roonClient(), media);
  let matched;
  let automaticResolutions = 0;
  context.playlistService = {
    setTrackMatch: (playlistId, trackId, resultId, options) => {
      matched = { playlistId, trackId, resultId, options };
    },
    resolveVirtualPlaylistItems: async () => { automaticResolutions += 1; },
    getPlaylist: () => ({ playlist_id: "p1", tracks: [{ track_id: "t1", resolution: { status: "manual" } }] })
  };
  const gateway = new IntentGateway(context);

  const result = await gateway.editPlaylistTracks({
    playlist_id: "p1",
    operations: [{ type: "update", track_id: "t1", changes: { result_id: "result:fixed" } }]
  });

  assert.equal(result.status, "completed");
  assert.equal(matched.resultId, "result:fixed");
  assert.equal(matched.options.selectionReason, "selected_search_result");
  assert.equal(automaticResolutions, 0);
});

test("v2 exposes custom playlist cover storage through the gateway", async () => {
  const context = gatewayContext(roonClient(), {});
  let stored;
  context.playlistService = {
    setCustomCover: (playlistId, input) => {
      stored = { playlistId, input };
      return { playlist_id: playlistId, cover_image_key: "custom:cover.png" };
    }
  };
  const gateway = new IntentGateway(context);

  const result = await gateway.setPlaylistCover({
    playlist_id: "p1",
    image_base64: "aW1hZ2U=",
    content_type: "image/png"
  });

  assert.equal(result.status, "completed");
  assert.equal(result.data.cover_image_key, "custom:cover.png");
  assert.deepEqual(stored, {
    playlistId: "p1",
    input: { data_url: undefined, image_base64: "aW1hZ2U=", content_type: "image/png" }
  });
  assert.equal(result.data.upload_source, "inline_base64");
  assert.deepEqual(result.data.cover_verification, { cover_image_key: "custom:cover.png" });
});

test("v2 prepares playlist-specific artwork requirements before generation", () => {
  const context = gatewayContext(roonClient(), {});
  context.playlistService = {
    getPlaylistByReference: (reference) => {
      assert.deepEqual(reference, { name: "Focus" });
      return {
        playlist_id: "p1",
        name: "Focus",
        description: "Deep work without distractions",
        cover_image_key: null,
        track_count: 2,
        tracks: [
          { position: 0, title: "Everything In Its Right Place", artist: "Radiohead", album: "Kid A", query: "radiohead" },
          { position: 1, title: "Avril 14th", artist: "Aphex Twin", album: "Drukqs", query: "aphex twin" }
        ]
      };
    }
  };
  const gateway = new IntentGateway(context);

  const result = gateway.preparePlaylistCover({ playlist: { name: "Focus" } });

  assert.equal(result.status, "completed");
  assert.equal(result.verified, true);
  assert.equal(result.data.playlist.playlist_id, "p1");
  assert.equal(result.data.artwork_requirements.recommended_width, 1024);
  assert.equal(result.data.artwork_requirements.minimum_width, 768);
  assert.equal(result.data.generation_context.tracks.length, 2);
  assert.match(result.summary, /Generate the image now/);
});

test("v2 downloads an authorized ChatGPT file before saving and verifies the result", async () => {
  const context = gatewayContext(roonClient(), {});
  const file = {
    download_url: "https://files.example.test/cover.png",
    file_id: "file_cover",
    mime_type: "image/png",
    file_name: "cover.png"
  };
  context.downloadToolImage = async (received) => {
    assert.deepEqual(received, file);
    return {
      bytes: Buffer.from("png-bytes"),
      contentType: "image/png",
      fileId: file.file_id,
      fileName: file.file_name
    };
  };
  let stored;
  context.playlistService = {
    setCustomCover: (playlistId, input) => {
      stored = { playlistId, input };
      return { playlist_id: playlistId, cover_image_key: "custom:cover.webp" };
    },
    inspectCustomCover: async () => ({
      cover_image_key: "custom:cover.webp",
      width: 1024,
      height: 1024,
      bytes: 120000
    })
  };
  const gateway = new IntentGateway(context);

  const result = await gateway.setPlaylistCover({ playlist_id: "p1", image_file: file });

  assert.deepEqual(stored, {
    playlistId: "p1",
    input: {
      data_url: undefined,
      image_base64: Buffer.from("png-bytes").toString("base64"),
      content_type: "image/png"
    }
  });
  assert.equal(result.data.upload_source, "authorized_file");
  assert.deepEqual(result.data.source_file, { file_id: "file_cover", file_name: "cover.png" });
  assert.equal(result.data.cover_verification.width, 1024);
});

test("v2 never upgrades an explicitly unverified SDK result", () => {
  const result = normalizeServiceResult(
    "roon_set_volume",
    "Volume accepted.",
    { ok: true, state_verified: false },
    true
  );
  assert.equal(result.status, "completed");
  assert.equal(result.verified, false);
});
