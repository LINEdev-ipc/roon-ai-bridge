const crypto = require("node:crypto");
const dns = require("node:dns");
const fs = require("node:fs");
const path = require("node:path");

dns.setDefaultResultOrder("ipv4first");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

function writeJsonl(file, values) {
  fs.writeFileSync(
    file,
    values.length ? `${values.map((value) => JSON.stringify(value)).join("\n")}\n` : "",
    "utf8"
  );
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

function compatibleText(expected, observed) {
  const wanted = normalize(expected);
  const actual = normalize(observed);
  return Boolean(wanted && actual) && (
    actual === wanted ||
    actual.includes(wanted) ||
    wanted.includes(actual)
  );
}

function artistNames(credits) {
  return Array.isArray(credits)
    ? credits.flatMap((credit) => [
      credit?.name,
      credit?.artist?.name
    ]).filter((name) => typeof name === "string")
    : [];
}

function referenceMbid(row) {
  if (row.effective_outcome === "exact") return row.recording_id || null;
  if (row.combined_outcome === "exact" && row.album_first?.status === "exact") {
    return row.album_first.recordings?.[0]?.recording_id || null;
  }
  return null;
}

function priorCandidateMbids(row) {
  const values = row.attempts.flatMap((attempt) =>
    (attempt.candidates || []).map((candidate) => candidate.recording_id)
  );
  if (row.album_first) {
    values.push(...(row.album_first.recordings || []).map((recording) => recording.recording_id));
  }
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueRows(rows) {
  return Array.from(new Map(
    rows
      .filter((row) => row?.recording_mbid)
      .map((row) => [row.recording_mbid, row])
  ).values());
}

function cachedRequester(cacheDir, minimumIntervalMs = 0) {
  let lastRequestAt = 0;
  let providerRequests = 0;
  let cacheHits = 0;

  async function request(url) {
    const href = String(url);
    const key = crypto.createHash("sha256").update(href).digest("hex");
    const file = path.join(cacheDir, `${key}.json`);
    if (fs.existsSync(file)) {
      cacheHits += 1;
      const cached = readJson(file);
      return { body: cached.body, cache_hit: true, elapsed_ms: 0 };
    }

    const waitMs = Math.max(0, minimumIntervalMs - (Date.now() - lastRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));

    const started = Date.now();
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        providerRequests += 1;
        const response = await fetch(href, {
          signal: AbortSignal.timeout(15000),
          headers: {
            Accept: "application/json",
            "User-Agent": "RoonAI-Bridge-playlist-validation/0.20.0 (https://github.com/LINEdev-ipc/roon-ai-bridge)"
          }
        });
        lastRequestAt = Date.now();
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`${new URL(href).hostname} returned HTTP ${response.status}`);
        }
        if (!response.ok) {
          throw new Error(`${new URL(href).hostname} returned HTTP ${response.status}`);
        }
        const body = await response.json();
        writeJson(file, {
          url: href,
          fetched_at: new Date().toISOString(),
          status: 200,
          headers: { "content-type": "application/json" },
          body
        });
        return { body, cache_hit: false, elapsed_ms: Date.now() - started };
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
      }
    }
    throw lastError || new Error("Provider request failed");
  }

  return {
    request,
    stats: () => ({ provider_requests: providerRequests, cache_hits: cacheHits })
  };
}

function listenBrainzUrl(dataset, candidate) {
  const url = new URL(`https://labs.api.listenbrainz.org/${dataset}/json`);
  url.searchParams.set("artist_credit_name", candidate.primary_artist);
  url.searchParams.set("recording_name", candidate.title);
  if (dataset === "acrr-lookup") {
    url.searchParams.set("release_name", candidate.album);
  }
  return url;
}

function musicBrainzUrl(mbid) {
  const url = new URL(`https://musicbrainz.org/ws/2/recording/${mbid}`);
  url.searchParams.set("inc", "artist-credits+releases+release-groups");
  url.searchParams.set("fmt", "json");
  return url;
}

function compactVerification(mbid, body, candidate) {
  const releases = (body.releases || []).map((release) => ({
    release_mbid: release.id,
    title: release.title,
    date: release.date || null,
    country: release.country || null,
    status: release.status || null,
    release_group_mbid: release["release-group"]?.id || null,
    release_group_title: release["release-group"]?.title || null,
    release_group_primary_type: release["release-group"]?.["primary-type"] || null,
    release_group_secondary_types: release["release-group"]?.["secondary-types"] || []
  }));
  const observedArtists = artistNames(body["artist-credit"]);
  const albumMatch = releases.some((release) =>
    compatibleText(candidate.album, release.title) ||
    compatibleText(candidate.album, release.release_group_title)
  );
  return {
    recording_mbid: mbid,
    title: body.title || null,
    disambiguation: body.disambiguation || null,
    length_ms: body.length || null,
    video: Boolean(body.video),
    artists: observedArtists,
    releases,
    checks: {
      title_compatible: compatibleText(candidate.title, body.title),
      primary_artist_compatible: observedArtists.some((artist) =>
        compatibleText(candidate.primary_artist, artist)
      ),
      album_compatible: albumMatch,
      non_video: body.video !== true
    }
  };
}

function selectMapping(acrrRows, acrRows) {
  const releaseMatches = uniqueRows(acrrRows);
  const titleArtistMatches = uniqueRows(acrRows);
  const releaseMbids = releaseMatches.map((row) => row.recording_mbid);
  const titleArtistMbids = titleArtistMatches.map((row) => row.recording_mbid);

  if (releaseMbids.length === 1 && titleArtistMbids.length === 1) {
    return {
      status: releaseMbids[0] === titleArtistMbids[0] ? "agreement" : "strategy_disagreement",
      strategy: "acrr",
      recording_mbid: releaseMbids[0]
    };
  }
  if (releaseMbids.length === 1) {
    return { status: "release_only", strategy: "acrr", recording_mbid: releaseMbids[0] };
  }
  if (titleArtistMbids.length === 1) {
    return { status: "artist_recording_only", strategy: "acr", recording_mbid: titleArtistMbids[0] };
  }
  if (releaseMbids.length > 1 || titleArtistMbids.length > 1) {
    return { status: "multiple", strategy: null, recording_mbid: null };
  }
  return { status: "not_found", strategy: null, recording_mbid: null };
}

function classify(row, selected, verification) {
  const reference = referenceMbid(row);
  if (!selected.recording_mbid) {
    return selected.status === "multiple" ? "lookup_conflict" : "not_found";
  }
  if (!verification) return "provider_error";
  if (reference) {
    return selected.recording_mbid === reference
      ? "reference_agreement"
      : "reference_disagreement";
  }

  const checks = verification.checks;
  const supportedByPrior = priorCandidateMbids(row).includes(selected.recording_mbid);
  const strongMetadata = checks.title_compatible &&
    checks.primary_artist_compatible &&
    checks.non_video &&
    (checks.album_compatible || selected.strategy === "acr");

  if (supportedByPrior && strongMetadata) return "unresolved_supported_candidate";
  if (strongMetadata) return "unresolved_new_candidate";
  return "unresolved_weak_candidate";
}

const inputPath = path.resolve(process.argv[2] || "");
if (!inputPath || !fs.existsSync(inputPath)) {
  throw new Error("Pass an existing round input.json path.");
}

const roundDir = path.dirname(inputPath);
const evaluatedPath = path.join(roundDir, "combined-results.jsonl");
if (!fs.existsSync(evaluatedPath)) {
  throw new Error("Run analyze-results.js before this experiment.");
}

const evaluated = readJsonl(evaluatedPath);
const outputPath = path.join(roundDir, "listenbrainz-results.jsonl");
const summaryPath = path.join(roundDir, "listenbrainz-summary.json");
const existing = new Map(readJsonl(outputPath).map((result) => [result.candidate_id, result]));
const previousSummary = fs.existsSync(summaryPath) ? readJson(summaryPath) : null;
const retryProviderErrors = process.argv.includes("--retry-provider-errors");
const listenBrainz = cachedRequester(path.join(__dirname, "cache", "listenbrainz"));
const musicBrainz = cachedRequester(path.join(__dirname, "cache", "musicbrainz"), 1100);
const startedAt = new Date().toISOString();

(async () => {
  let completed = existing.size;
  let processedThisRun = 0;
  for (const row of evaluated) {
    const existingResult = existing.get(row.candidate_id);
    if (existingResult && !(retryProviderErrors && existingResult.classification === "provider_error")) {
      continue;
    }
    const candidateStarted = Date.now();
    let stored;
    try {
      const acrrResponse = await listenBrainz.request(listenBrainzUrl("acrr-lookup", row.proposal));
      const acrResponse = await listenBrainz.request(listenBrainzUrl("acr-lookup", row.proposal));
      const acrrRows = Array.isArray(acrrResponse.body) ? acrrResponse.body : [];
      const acrRows = Array.isArray(acrResponse.body) ? acrResponse.body : [];
      const selected = selectMapping(acrrRows, acrRows);
      const returnedMbids = Array.from(new Set([
        ...uniqueRows(acrrRows).map((entry) => entry.recording_mbid),
        ...uniqueRows(acrRows).map((entry) => entry.recording_mbid)
      ]));
      const verifications = [];
      for (const mbid of returnedMbids) {
        const response = await musicBrainz.request(musicBrainzUrl(mbid));
        verifications.push(compactVerification(mbid, response.body, row.proposal));
      }
      const selectedVerification = verifications.find(
        (verification) => verification.recording_mbid === selected.recording_mbid
      ) || null;
      stored = {
        schema_version: 1,
        round_id: row.round_id,
        prompt_id: row.prompt_id,
        candidate_id: row.candidate_id,
        previous_outcome: row.combined_outcome,
        reference_recording_mbid: referenceMbid(row),
        proposal: row.proposal,
        lookups: {
          acrr: {
            input: {
              artist_credit_name: row.proposal.primary_artist,
              recording_name: row.proposal.title,
              release_name: row.proposal.album
            },
            rows: acrrRows,
            cache_hit: acrrResponse.cache_hit,
            elapsed_ms: acrrResponse.elapsed_ms
          },
          acr: {
            input: {
              artist_credit_name: row.proposal.primary_artist,
              recording_name: row.proposal.title
            },
            rows: acrRows,
            cache_hit: acrResponse.cache_hit,
            elapsed_ms: acrResponse.elapsed_ms
          }
        },
        selected,
        verifications,
        supported_by_prior_candidates: selected.recording_mbid
          ? priorCandidateMbids(row).includes(selected.recording_mbid)
          : false,
        classification: classify(row, selected, selectedVerification),
        elapsed_ms: Date.now() - candidateStarted
      };
    } catch (error) {
      stored = {
        schema_version: 1,
        round_id: row.round_id,
        prompt_id: row.prompt_id,
        candidate_id: row.candidate_id,
        previous_outcome: row.combined_outcome,
        reference_recording_mbid: referenceMbid(row),
        proposal: row.proposal,
        lookups: null,
        selected: { status: "provider_error", strategy: null, recording_mbid: null },
        verifications: [],
        supported_by_prior_candidates: false,
        classification: "provider_error",
        error: error instanceof Error ? error.message : String(error),
        elapsed_ms: Date.now() - candidateStarted
      };
    }
    appendJsonl(outputPath, stored);
    existing.set(row.candidate_id, stored);
    processedThisRun += 1;
    if (!existingResult) completed += 1;
    process.stdout.write(`${JSON.stringify({
      candidate_id: row.candidate_id,
      completed,
      total: evaluated.length,
      previous_outcome: row.combined_outcome,
      mapping_status: stored.selected.status,
      classification: stored.classification,
      elapsed_ms: stored.elapsed_ms
    })}\n`);
  }

  const results = Array.from(existing.values())
    .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
  writeJsonl(outputPath, results);
  if (processedThisRun === 0 && previousSummary) {
    process.stdout.write(`${JSON.stringify({
      phase: "complete",
      resumed_without_new_requests: true,
      summary: previousSummary
    })}\n`);
    return;
  }
  const finishedAt = new Date().toISOString();
  const counts = (key) => Object.fromEntries(Array.from(results.reduce((map, result) => {
    const value = (typeof key === "function" ? key(result) : result[key]) || "none";
    map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map())).sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
  const summary = {
    schema_version: 1,
    round_id: evaluated[0]?.round_id || null,
    started_at: startedAt,
    finished_at: finishedAt,
    elapsed_seconds: Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 10) / 100,
    candidates: results.length,
    previous_outcome: counts("previous_outcome"),
    mapping_status: counts((result) => result.selected.status),
    classification: counts("classification"),
    listenbrainz: listenBrainz.stats(),
    musicbrainz_verification: musicBrainz.stats(),
    raw_cache_entries: {
      listenbrainz: fs.readdirSync(path.join(__dirname, "cache", "listenbrainz"))
        .filter((name) => name.endsWith(".json")).length,
      musicbrainz: fs.readdirSync(path.join(__dirname, "cache", "musicbrainz"))
        .filter((name) => name.endsWith(".json")).length
    }
  };
  writeJson(summaryPath, summary);
  process.stdout.write(`${JSON.stringify({ phase: "complete", summary })}\n`);
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
