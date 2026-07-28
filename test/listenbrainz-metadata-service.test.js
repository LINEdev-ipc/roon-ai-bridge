const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ListenBrainzMetadataService
} = require("../dist/services/listenBrainzMetadataService");

test("ListenBrainz runs artist-recording and artist-recording-release lookups together and merges MBIDs", async () => {
  let active = 0;
  let maximumActive = 0;
  const calls = [];
  const service = new ListenBrainzMetadataService(async (url) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    calls.push(url.pathname);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    const source = url.pathname.includes("acrr-lookup") ? "release" : "recording";
    return new Response(JSON.stringify([{
      recording_mbid: "recording-1",
      release_mbid: source === "release" ? "release-1" : null,
      recording_name: "Example",
      release_name: "Example Album",
      artist_credit_name: "Example Artist",
      artist_mbids: ["artist-1"]
    }]), { status: 200 });
  });

  const result = await service.lookup({
    title: "Example",
    artist: "Example Artist",
    album: "Example Album"
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(calls.sort(), [
    "/acr-lookup/json",
    "/acrr-lookup/json"
  ]);
  assert.deepEqual(result.acr_mbids, ["recording-1"]);
  assert.deepEqual(result.acrr_mbids, ["recording-1"]);
  assert.deepEqual(result.candidates[0].sources.sort(), ["acr", "acrr"]);
  assert.equal(result.provider_requests, 2);

  const cached = await service.lookup({
    title: "Example",
    artist: "Example Artist",
    album: "Example Album"
  });
  assert.equal(cached.provider_requests, 0);
  assert.equal(cached.cache_hits, 2);
});

test("ListenBrainz failure remains advisory and never prevents MusicBrainz resolution", async () => {
  const service = new ListenBrainzMetadataService(async () =>
    new Response("unavailable", { status: 503 })
  );
  const result = await service.lookup({
    title: "Example",
    artist: "Example Artist"
  });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.warnings.length, 1);
});
