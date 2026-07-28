const test = require("node:test");
const assert = require("node:assert/strict");
const { TrackResolutionService } = require("../dist/services/trackResolutionService");

function candidate(id, overrides = {}) {
  return {
    result_id: id,
    roon_item_key: `key:${id}`,
    type: "track",
    media_type: "track",
    title: "London Calling",
    artist: "The Clash",
    artists: [],
    album: "London Calling",
    album_artist: "The Clash",
    version_hint: "studio",
    subtitle: "The Clash",
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
    version_penalties: [],
    warnings: [],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    roon_rank: 0,
    direct_match: false,
    direct_match_score: 0,
    links: { artist: null, artists: [], album: null },
    release_type: null,
    release_type_source: null,
    ...overrides
  };
}

test("strict track resolution prefers an equivalent TIDAL lossless candidate over local MP3", async () => {
  let request;
  const mediaService = {
    async search(received) {
      request = received;
      return {
        results: [
          candidate("local", {
            source: "library",
            source_confidence: "high",
            is_library: true,
            quality: { label: "MP3", bit_depth: null, sample_rate_hz: null, format: "MP3" }
          }),
          candidate("tidal", {
            source: "tidal",
            source_confidence: "high",
            is_library: false,
            quality: { label: "24-bit / 96 kHz / FLAC", bit_depth: 24, sample_rate_hz: 96_000, format: "FLAC" }
          })
        ],
        warnings: []
      };
    }
  };

  const resolved = await new TrackResolutionService(mediaService).resolve({
    query: "London Calling The Clash",
    title: "London Calling",
    artist: "The Clash"
  });

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.selected.result.result_id, "tidal");
  assert.deepEqual(request.types, ["track"]);
  assert.equal(request.sourcePreference, "streaming_first");
});

test("source and quality never outweigh the correct artist and studio version", async () => {
  const mediaService = {
    async search() {
      return {
        results: [
          candidate("wrong-tidal", {
            artist: "Cooltrane Quartet",
            subtitle: "Cooltrane Quartet",
            album_artist: "Cooltrane Quartet",
            source: "tidal",
            quality: { label: "24-bit / 192 kHz / FLAC", bit_depth: 24, sample_rate_hz: 192_000, format: "FLAC" }
          }),
          candidate("live-tidal", {
            title: "London Calling (Live)",
            version_hint: "live",
            source: "tidal",
            quality: { label: "24-bit / 96 kHz / FLAC", bit_depth: 24, sample_rate_hz: 96_000, format: "FLAC" }
          }),
          candidate("correct-local", {
            source: "library",
            quality: { label: "MP3", bit_depth: null, sample_rate_hz: null, format: "MP3" }
          })
        ],
        warnings: []
      };
    }
  };

  const resolved = await new TrackResolutionService(mediaService).resolve({
    query: "London Calling The Clash",
    title: "London Calling",
    artist: "The Clash"
  });

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.selected.result.result_id, "correct-local");
});

test("unknown version discovery keeps live and alternate acoustic candidates eligible", async () => {
  let strategy;
  const mediaService = {
    async search(request) {
      strategy = request.strategy;
      return {
        results: [
          candidate("unplugged-live", {
            title: "Inevitable (En Vivo)",
            artist: "Shakira",
            subtitle: "Shakira",
            album: null,
            version_hint: "live"
          }),
          candidate("unplugged-alternate", {
            title: "Inevitable (MTV Unplugged Version)",
            artist: "Shakira",
            subtitle: "Shakira",
            album: null,
            version_hint: "alternate"
          })
        ],
        warnings: []
      };
    }
  };

  const resolved = await new TrackResolutionService(mediaService).resolve({
    query: "Inevitable Shakira MTV Unplugged",
    title: "Inevitable",
    artist: "Shakira",
    album: "MTV Unplugged",
    versionHint: "unknown"
  });

  assert.notEqual(resolved.reason, "no_results");
  assert.equal(strategy.avoid_live, false);
  assert.equal(strategy.avoid_remix, false);
});

test("a fresh exact Roon result is reused without repeating the catalog search", async () => {
  let searches = 0;
  const preferred = candidate("fresh-roon-result", {
    source: "tidal",
    source_confidence: "high",
    album: "London Calling"
  });
  const mediaService = {
    get(resultId) {
      assert.equal(resultId, preferred.result_id);
      return preferred;
    },
    async search() {
      searches += 1;
      throw new Error("an exact fresh result must not trigger another Roon search");
    }
  };

  const resolved = await new TrackResolutionService(mediaService).resolve({
    preferredResultId: preferred.result_id,
    query: "London Calling The Clash",
    title: "London Calling",
    artist: "The Clash",
    album: "London Calling"
  });

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.reason, "selected_supplied_result");
  assert.equal(resolved.selected.result.result_id, preferred.result_id);
  assert.equal(searches, 0);
});

test("title-only requests remain ambiguous across different artists", async () => {
  const mediaService = {
    async search() {
      return {
        results: [
          candidate("massive", { title: "Angel", artist: "Massive Attack", subtitle: "Massive Attack", album: null }),
          candidate("sarah", { title: "Angel", artist: "Sarah McLachlan", subtitle: "Sarah McLachlan", album: null })
        ],
        warnings: []
      };
    }
  };

  const resolved = await new TrackResolutionService(mediaService).resolve({ query: "Angel", title: "Angel" });

  assert.equal(resolved.status, "ambiguous");
  assert.equal(resolved.selected, null);
});
