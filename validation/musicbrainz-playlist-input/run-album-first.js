const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function lucene(value) {
  return String(value || "").replace(/[\\"]/g, "\\$&");
}

function artistNames(value) {
  return Array.isArray(value)
    ? value.flatMap((credit) => {
      const artist = credit?.artist;
      return [credit?.name, artist?.name].filter((name) => typeof name === "string");
    })
    : [];
}

function compatibleArtist(expected, observed) {
  const wanted = normalize(expected);
  return observed.some((name) => {
    const actual = normalize(name);
    return actual === wanted || actual.includes(wanted) || wanted.includes(actual);
  });
}

function groupScore(group, candidate) {
  const expectedAlbum = normalize(candidate.album);
  const actualAlbum = normalize(group.title);
  let score = actualAlbum === expectedAlbum ? 100 : actualAlbum.includes(expectedAlbum) || expectedAlbum.includes(actualAlbum) ? 70 : 0;
  if (compatibleArtist(candidate.album_artist, artistNames(group["artist-credit"]))) score += 50;
  const actualYear = Number(String(group["first-release-date"] || "").slice(0, 4)) || null;
  if (actualYear && candidate.year) {
    const distance = Math.abs(actualYear - candidate.year);
    if (distance === 0) score += 20;
    else if (distance === 1) score += 12;
    else if (distance <= 3) score += 4;
  }
  return score;
}

function effectiveCurrent(result) {
  if (result.effective_outcome) return result.effective_outcome;
  if (result.outcome === "exact") return "exact";
  return result.attempts?.some((attempt) => attempt.status === "conflict") ? "conflict" : result.outcome;
}

function cachedRequester(cacheDir) {
  let lastRequestAt = 0;
  return async (url) => {
    const href = String(url);
    const key = crypto.createHash("sha256").update(href).digest("hex");
    const file = path.join(cacheDir, `${key}.json`);
    if (fs.existsSync(file)) return { body: readJson(file).body, cache_hit: true, elapsed_ms: 0 };
    const waitMs = Math.max(0, 1100 - (Date.now() - lastRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const started = Date.now();
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(href, {
          headers: {
            Accept: "application/json",
            "User-Agent": "RoonAI-Bridge-playlist-validation/0.20.0 (https://github.com/LINEdev-ipc/roon-ai-bridge)"
          }
        });
        lastRequestAt = Date.now();
        if (response.status === 429 || response.status === 503) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt)));
          continue;
        }
        if (!response.ok) throw new Error(`MusicBrainz returned HTTP ${response.status}`);
        const body = await response.json();
        writeJson(file, {
          url: href,
          fetched_at: new Date().toISOString(),
          status: response.status,
          headers: { "content-type": response.headers.get("content-type") || "application/json" },
          body
        });
        return { body, cache_hit: false, elapsed_ms: Date.now() - started };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("MusicBrainz request failed");
  };
}

async function resolveAlbumFirst(request, candidate) {
  const started = Date.now();
  const groupUrl = new URL("https://musicbrainz.org/ws/2/release-group");
  groupUrl.searchParams.set("query", `releasegroup:"${lucene(candidate.album)}" AND artist:"${lucene(candidate.album_artist)}"`);
  groupUrl.searchParams.set("fmt", "json");
  groupUrl.searchParams.set("limit", "50");
  const groupResponse = await request(groupUrl);
  const scoredGroups = (groupResponse.body["release-groups"] || [])
    .map((group) => ({ group, score: groupScore(group, candidate) }))
    .filter((entry) => entry.score >= 120)
    .sort((left, right) => right.score - left.score);
  if (!scoredGroups.length) {
    return {
      status: "not_found",
      reason: "release_group_not_found",
      elapsed_ms: Date.now() - started,
      release_groups_returned: (groupResponse.body["release-groups"] || []).length,
      compatible_release_groups: [],
      recordings: [],
      provider_requests: groupResponse.cache_hit ? 0 : 1
    };
  }
  const strongestScore = scoredGroups[0].score;
  const selectedGroups = scoredGroups.filter((entry) => entry.score === strongestScore).slice(0, 3);
  const recordings = [];
  let providerRequests = groupResponse.cache_hit ? 0 : 1;
  for (const { group, score } of selectedGroups) {
    const recordingUrl = new URL("https://musicbrainz.org/ws/2/recording");
    recordingUrl.searchParams.set("query", `recording:"${lucene(candidate.title)}" AND rgid:${group.id}`);
    recordingUrl.searchParams.set("fmt", "json");
    recordingUrl.searchParams.set("limit", "100");
    const recordingResponse = await request(recordingUrl);
    if (!recordingResponse.cache_hit) providerRequests += 1;
    for (const recording of recordingResponse.body.recordings || []) {
      if (normalize(recording.title) !== normalize(candidate.title)) continue;
      if (!compatibleArtist(candidate.primary_artist, artistNames(recording["artist-credit"]))) continue;
      if (recording.video === true) continue;
      recordings.push({
        recording_id: recording.id,
        title: recording.title,
        disambiguation: recording.disambiguation || null,
        length_ms: recording.length || null,
        video: Boolean(recording.video),
        artists: artistNames(recording["artist-credit"]),
        release_group_id: group.id,
        release_group_title: group.title,
        release_group_first_release_date: group["first-release-date"] || null,
        release_group_primary_type: group["primary-type"] || null,
        release_group_secondary_types: group["secondary-types"] || [],
        release_group_score: score,
        search_score: Number(recording.score) || 0
      });
    }
  }
  const unique = Array.from(new Map(recordings.map((recording) => [recording.recording_id, recording])).values());
  return {
    status: unique.length === 1 ? "exact" : unique.length > 1 ? "conflict" : "not_found",
    reason: unique.length === 1
      ? "unique_recording_within_verified_release_group"
      : unique.length > 1
        ? "multiple_recordings_within_verified_release_group"
        : "track_not_found_in_verified_release_group",
    elapsed_ms: Date.now() - started,
    release_groups_returned: (groupResponse.body["release-groups"] || []).length,
    compatible_release_groups: selectedGroups.map(({ group, score }) => ({
      release_group_id: group.id,
      title: group.title,
      first_release_date: group["first-release-date"] || null,
      primary_type: group["primary-type"] || null,
      secondary_types: group["secondary-types"] || [],
      score
    })),
    recordings: unique,
    provider_requests: providerRequests
  };
}

const inputPath = path.resolve(process.argv[2] || "");
if (!inputPath || !fs.existsSync(inputPath)) throw new Error("Pass an existing input.json path.");
const roundDir = path.dirname(inputPath);
const evaluated = readJsonl(path.join(roundDir, "evaluated-results.jsonl"));
const outputPath = path.join(roundDir, "album-first-results.jsonl");
const existing = new Map(readJsonl(outputPath).map((result) => [result.candidate_id, result]));
const request = cachedRequester(path.join(__dirname, "cache", "musicbrainz"));
const targets = evaluated.filter((result) => effectiveCurrent(result) !== "exact");
const startedAt = new Date().toISOString();

(async () => {
  let completed = existing.size;
  for (const row of targets) {
    if (existing.has(row.candidate_id)) continue;
    let result;
    try {
      result = await resolveAlbumFirst(request, row.proposal);
    } catch (error) {
      result = {
        status: "provider_error",
        reason: error instanceof Error ? error.message : String(error),
        elapsed_ms: 0,
        release_groups_returned: 0,
        compatible_release_groups: [],
        recordings: [],
        provider_requests: 0
      };
    }
    const stored = {
      schema_version: 1,
      round_id: row.round_id,
      prompt_id: row.prompt_id,
      candidate_id: row.candidate_id,
      previous_outcome: row.effective_outcome,
      proposal: row.proposal,
      ...result
    };
    appendJsonl(outputPath, stored);
    existing.set(row.candidate_id, stored);
    completed += 1;
    process.stdout.write(`${JSON.stringify({
      candidate_id: row.candidate_id,
      completed,
      total: targets.length,
      previous_outcome: row.effective_outcome,
      album_first_status: result.status,
      reason: result.reason,
      elapsed_ms: result.elapsed_ms
    })}\n`);
  }
  const results = Array.from(existing.values());
  const finishedAt = new Date().toISOString();
  const summary = {
    schema_version: 1,
    round_id: evaluated[0]?.round_id || null,
    started_at: startedAt,
    finished_at: finishedAt,
    elapsed_seconds: Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 10) / 100,
    targets: targets.length,
    status: Object.fromEntries(Array.from(results.reduce((counts, result) => {
      counts.set(result.status, (counts.get(result.status) || 0) + 1);
      return counts;
    }, new Map())).sort()),
    recovered_exact: results.filter((result) => result.status === "exact").length,
    remaining_conflict: results.filter((result) => result.status === "conflict").length,
    remaining_not_found: results.filter((result) => result.status === "not_found").length,
    provider_error: results.filter((result) => result.status === "provider_error").length,
    provider_requests: results.reduce((sum, result) => sum + result.provider_requests, 0)
  };
  writeJson(path.join(roundDir, "album-first-summary.json"), summary);
  process.stdout.write(`${JSON.stringify({phase:"complete", summary})}\n`);
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
