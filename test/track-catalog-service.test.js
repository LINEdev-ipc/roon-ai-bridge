const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createDatabase } = require("../dist/db/database");
const { MetadataProviderCacheService } = require("../dist/services/metadataProviderCacheService");
const { TrackCatalogService } = require("../dist/services/trackCatalogService");

function config(dataDir) {
  return {
    dataDir,
    publicBaseUrl: "https://example.test",
    enableAuth: false,
    apiToken: null
  };
}

function trace() {
  return {
    cache_hit: false,
    cache_layer: null,
    elapsed_ms: 3,
    provider_requests: 2,
    search_attempts: [],
    candidate_counts: { returned: 1, accepted: 1, rejected: 0 },
    rejected_candidates: [],
    accepted_warnings: []
  };
}

function catalogMetadata() {
  return {
    recording_id: "recording-1",
    title: "Everything in Its Right Place",
    artist: "Radiohead",
    artists: ["Radiohead"],
    artist_credit: [{
      musicbrainz_id: "artist-1",
      name: "Radiohead",
      join_phrase: ""
    }],
    artist_entities: [{
      musicbrainz_id: "artist-1",
      name: "Radiohead",
      sort_name: "Radiohead",
      disambiguation: null,
      type: "Group",
      country: "GB",
      credited_name: "Radiohead",
      join_phrase: ""
    }],
    album: "Kid A",
    disambiguation: "original studio recording",
    video: false,
    duration_seconds: 251,
    release_year: 2000,
    original_release_year: 2000,
    isrc: "GBAYE0000812",
    isrcs: ["GBAYE0000812"],
    composers: ["Thom Yorke"],
    lyricists: ["Thom Yorke"],
    genres: ["alternative rock", "electronic"],
    genre_details: [
      { name: "alternative rock", count: 8, entity: "recording" },
      { name: "electronic", count: 3, entity: "work" }
    ],
    work: {
      musicbrainz_id: "work-1",
      title: "Everything in Its Right Place",
      type: "Song",
      language: "eng",
      iswcs: ["T-010.123.456-7"],
      disambiguation: null,
      relation_type: "performance",
      relation_attributes: []
    },
    credits: [{
      musicbrainz_id: "writer-1",
      name: "Thom Yorke",
      credited_name: null,
      role: "composer",
      attributes: []
    }, {
      musicbrainz_id: "writer-1",
      name: "Thom Yorke",
      credited_name: null,
      role: "lyricist",
      attributes: []
    }],
    release_candidates: [{
      release_id: "release-1",
      release_group_id: "release-group-1",
      title: "Kid A",
      album_artist: "Radiohead",
      date: "2000-10-02",
      release_year: 2000,
      country: "GB",
      status: "Official",
      primary_type: "Album",
      secondary_types: [],
      medium_position: 1,
      track_position: 1,
      track_count: 10,
      cover_art_archive: { artwork: true, front: true, back: true }
    }],
    release_groups: [{
      musicbrainz_id: "release-group-1",
      title: "Kid A",
      first_release_date: "2000-10-02",
      primary_type: "Album",
      secondary_types: [],
      disambiguation: null
    }],
    confidence: "high"
  };
}

function media() {
  return {
    result_id: "roon-result-1",
    roon_item_key: "roon-item-1",
    type: "track",
    media_type: "track",
    title: "Everything in Its Right Place",
    artist: "Radiohead",
    artists: [{ type: "artist", title: "Radiohead", artist: null, result_id: null }],
    album: "Kid A",
    album_artist: "Radiohead",
    version_hint: "studio",
    subtitle: "Radiohead",
    image_key: "roon-cover",
    source: "qobuz",
    source_confidence: "high",
    quality: { label: "24-bit / 96 kHz", bit_depth: 24, sample_rate_hz: 96000, format: "FLAC" },
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
    release_year: 2000,
    duration_seconds: 251,
    track_number: 1,
    disc_number: 1,
    release_type: "album",
    release_type_source: "roon_metadata",
    release_section: null,
    roon_rank: 1,
    direct_match: true,
    direct_match_score: 100,
    data_origin: "roon_search_session",
    completeness: "complete",
    ordered: true,
    identity_verified: true,
    links: { artist: null, artists: [], album: null }
  };
}

test("stores canonical MusicBrainz entities separately from the observed Roon binding", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-track-catalog-"));
  const database = createDatabase(config(dataDir));
  try {
    const recordingMetadata = {
      lookup: async () => ({
        status: "exact",
        reason: "unique_compatible_recording",
        metadata: catalogMetadata(),
        candidates: [],
        trace: trace()
      }),
      lookupReleaseTrack: async () => ({
        status: "exact",
        reason: "unique_recording_track_on_release",
        metadata: {
          release_id: "release-1",
          release_group_id: "release-group-1",
          title: "Kid A",
          album_artist: "Radiohead",
          date: "2000-10-02",
          release_year: 2000,
          country: "GB",
          status: "Official",
          primary_type: "Album",
          secondary_types: [],
          medium_position: 1,
          track_position: 1,
          track_number: "1",
          track_title: "Everything in Its Right Place",
          duration_seconds: 251.2,
          cover_art_archive: { artwork: true, front: true, back: true },
          barcode: "724352775326",
          packaging: "Jewel Case",
          labels: [{ musicbrainz_id: "label-1", name: "Parlophone", catalog_number: "5277532" }],
          media_format: "CD"
        },
        trace: trace()
      })
    };
    const mediaService = { getTrackMetadata: async () => media() };
    const coverFetch = async (url) => {
      assert.match(String(url), /coverartarchive\.org\/release\/release-1$/);
      return new Response(JSON.stringify({
        images: [{
          id: 44,
          image: "https://archive.org/original.jpg",
          front: true,
          back: false,
          approved: true,
          thumbnails: {
            250: "https://archive.org/250.jpg",
            500: "https://archive.org/500.jpg",
            1200: "https://archive.org/1200.jpg"
          }
        }]
      }), { status: 200 });
    };
    const service = new TrackCatalogService(
      database,
      recordingMetadata,
      mediaService,
      new MetadataProviderCacheService(database),
      undefined,
      coverFetch
    );

    const profile = await service.describeRoonTrack(media());

    assert.equal(profile.status, "exact");
    assert.equal(profile.recording.musicbrainz_id, "recording-1");
    assert.equal(profile.work.musicbrainz_id, "work-1");
    assert.equal(profile.release_group.musicbrainz_id, "release-group-1");
    assert.equal(profile.release.release_id, "release-1");
    assert.equal(profile.release.duration_seconds, 251.2);
    assert.equal(profile.cover_art.thumbnail_500_url, "https://archive.org/500.jpg");
    assert.equal(profile.roon_binding.reusable, false);
    assert.equal(profile.roon_binding.status, "observed");

    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM catalog_recordings").get().count, 1);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM catalog_artists").get().count, 2);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM catalog_works").get().count, 1);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM catalog_credits").get().count, 2);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM catalog_release_groups").get().count, 1);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM catalog_releases").get().count, 1);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM catalog_release_tracks").get().count, 1);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM catalog_cover_art").get().count, 1);
    const binding = database.db.prepare(
      "SELECT recording_id, source, canonical_query, reusable, status FROM roon_recording_bindings"
    ).get();
    assert.deepEqual({ ...binding }, {
      recording_id: "recording-1",
      source: "qobuz",
      canonical_query: "Everything in Its Right Place Radiohead",
      reusable: 0,
      status: "observed"
    });
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("keeps an ambiguous MusicBrainz result out of the canonical database", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-track-catalog-"));
  const database = createDatabase(config(dataDir));
  try {
    const service = new TrackCatalogService(database, {
      lookup: async () => ({
        status: "conflict",
        reason: "multiple_compatible_recordings",
        metadata: null,
        candidates: [{ recording_id: "a" }, { recording_id: "b" }],
        trace: trace()
      })
    });
    const { profile } = await service.resolve({
      title: "Ambiguous Song",
      artist: "Same Artist"
    });
    assert.equal(profile.status, "ambiguous");
    assert.equal(profile.recording, null);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM catalog_recordings").get().count, 0);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM roon_recording_bindings").get().count, 0);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("preserves failed MusicBrainz request counts in catalog diagnostics", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-track-catalog-"));
  const database = createDatabase(config(dataDir));
  try {
    const service = new TrackCatalogService(database, {
      lookup: async () => {
        const error = new Error("network unavailable");
        error.musicbrainz_provider_requests = 2;
        throw error;
      }
    });
    const { resolution, profile } = await service.resolve({
      title: "Unavailable Song",
      artist: "Unavailable Artist",
      metadata_depth: "identity"
    });

    assert.equal(profile.reason, "musicbrainz_provider_error");
    assert.equal(resolution.trace.provider_requests, 2);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("identity-only lookups never replace previously persisted full catalog metadata", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-track-catalog-"));
  const database = createDatabase(config(dataDir));
  let calls = 0;
  try {
    const service = new TrackCatalogService(database, {
      lookup: async () => {
        calls += 1;
        const metadata = catalogMetadata();
        if (calls > 1) {
          metadata.work = null;
          metadata.credits = [];
          metadata.composers = [];
          metadata.lyricists = [];
          metadata.genres = [];
          metadata.genre_details = [];
        }
        const providerTrace = trace();
        if (calls > 1) providerTrace.accepted_warnings = ["metadata_enrichment_pending"];
        return {
          status: "exact",
          reason: calls > 1
            ? "unique_compatible_recording_identity_only"
            : "unique_compatible_recording",
          metadata,
          candidates: [],
          trace: providerTrace
        };
      }
    });

    const full = await service.resolve({
      title: "Everything in Its Right Place",
      artist: "Radiohead"
    });
    const identity = await service.resolve({
      title: "Everything in Its Right Place",
      artist: "Radiohead",
      metadata_depth: "identity"
    });

    assert.deepEqual(full.profile.composers, ["Thom Yorke"]);
    assert.deepEqual(identity.profile.composers, ["Thom Yorke"]);
    assert.equal(identity.profile.work.musicbrainz_id, "work-1");
    assert.ok(!identity.profile.warnings.includes("metadata_enrichment_pending"));
    assert.deepEqual(service.get("recording-1").composers, ["Thom Yorke"]);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("normalizes an album to its release group without guessing a country edition", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-track-catalog-"));
  const database = createDatabase(config(dataDir));
  try {
    let releaseTrackLookups = 0;
    const service = new TrackCatalogService(database, {
      lookup: async () => ({
        status: "exact",
        reason: "unique_compatible_recording",
        metadata: catalogMetadata(),
        candidates: [],
        trace: trace()
      }),
      lookupReleaseTrack: async () => {
        releaseTrackLookups += 1;
        throw new Error("an edition must not be selected without edition evidence");
      }
    });

    const { profile } = await service.resolve({
      title: "Everything in Its Right Place",
      artist: "Radiohead",
      album: "Kid A"
    });

    assert.equal(profile.status, "exact");
    assert.equal(profile.release_group.musicbrainz_id, "release-group-1");
    assert.equal(profile.release, null);
    assert.equal(releaseTrackLookups, 0);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM catalog_release_groups").get().count, 1);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM catalog_releases").get().count, 0);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("does not substitute an unrelated release group for an observed album", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-track-catalog-"));
  const database = createDatabase(config(dataDir));
  try {
    const metadata = catalogMetadata();
    metadata.release_candidates = metadata.release_candidates.map((release) => ({
      ...release,
      release_id: "compilation-release",
      release_group_id: "compilation-group",
      title: "Kid A / Amnesiac",
      date: "2001-11-12",
      release_year: 2001
    }));
    metadata.release_groups = [{
      musicbrainz_id: "compilation-group",
      title: "Kid A / Amnesiac",
      first_release_date: "2001-11-12",
      primary_type: "Album",
      secondary_types: ["Compilation"],
      disambiguation: null
    }];
    const service = new TrackCatalogService(database, {
      lookup: async () => ({
        status: "exact",
        reason: "unique_compatible_recording",
        metadata,
        candidates: [],
        trace: trace()
      }),
      lookupReleaseTrack: async () => {
        throw new Error("an unrelated release must never be selected");
      }
    });

    const { profile } = await service.resolve({
      title: "Everything in Its Right Place",
      artist: "Radiohead",
      album_observation: "Kid A",
      metadata_depth: "identity"
    });

    assert.equal(profile.status, "exact");
    assert.equal(profile.release_group, null);
    assert.equal(profile.release, null);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
