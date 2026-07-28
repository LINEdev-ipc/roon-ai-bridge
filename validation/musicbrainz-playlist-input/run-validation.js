const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const { RecordingMetadataService } = require(path.join(root, "dist", "services", "recordingMetadataService"));

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

function cachedFetch(cacheDir) {
  return async (url, options = {}) => {
    const href = String(url);
    const key = crypto.createHash("sha256").update(href).digest("hex");
    const file = path.join(cacheDir, `${key}.json`);
    if (fs.existsSync(file)) {
      const cached = readJson(file);
      return new Response(JSON.stringify(cached.body), {
        status: cached.status,
        headers: cached.headers
      });
    }
    const response = await fetch(href, options);
    if (!response.ok) return response;
    const body = await response.json();
    const stored = {
      url: href,
      fetched_at: new Date().toISOString(),
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json"
      },
      body
    };
    writeJson(file, stored);
    return new Response(JSON.stringify(body), {
      status: stored.status,
      headers: stored.headers
    });
  };
}

function variantHint(candidate) {
  if (candidate.version_name) return candidate.version_name;
  return candidate.recording_intent === "standard" ? "studio" : candidate.recording_intent;
}

function compactResolution(strategy, input, resolution, elapsedMs) {
  const metadata = resolution.metadata;
  const matchingRelease = metadata?.release_candidates?.find((release) =>
    normalize(release.title) === normalize(input.album)
  ) || null;
  return {
    strategy,
    input,
    status: resolution.status,
    reason: resolution.reason,
    elapsed_ms: elapsedMs,
    recording_id: metadata?.recording_id || null,
    canonical: metadata ? {
      title: metadata.title,
      artist: metadata.artist,
      artists: metadata.artists,
      album: metadata.album,
      release_year: metadata.release_year,
      original_release_year: metadata.original_release_year,
      disambiguation: metadata.disambiguation,
      video: Boolean(metadata.video)
    } : null,
    proposed_release_match: matchingRelease ? {
      release_id: matchingRelease.release_id,
      release_group_id: matchingRelease.release_group_id,
      title: matchingRelease.title,
      album_artist: matchingRelease.album_artist,
      year: matchingRelease.release_year,
      country: matchingRelease.country
    } : null,
    candidates: resolution.candidates,
    trace: resolution.trace
  };
}

function strategyInputs(candidate) {
  const common = {
    title: candidate.title,
    version_hint: variantHint(candidate)
  };
  const values = [
    {
      name: "title_primary_artist",
      input: { ...common, artist: candidate.primary_artist }
    },
    {
      name: "title_primary_artist_album",
      input: { ...common, artist: candidate.primary_artist, album: candidate.album }
    }
  ];
  if (normalize(candidate.album_artist) !== normalize(candidate.primary_artist)) {
    values.push({
      name: "title_album_artist_album",
      input: { ...common, artist: candidate.album_artist, album: candidate.album }
    });
  }
  if (normalize(candidate.track_artist_credit) !== normalize(candidate.primary_artist)) {
    values.push({
      name: "title_full_credit_album",
      input: { ...common, artist: candidate.track_artist_credit, album: candidate.album }
    });
  }
  return values;
}

function aggregate(input, results, startedAt, finishedAt) {
  const byId = new Map(results.map((result) => [result.candidate_id, result]));
  const latestResults = Array.from(byId.values());
  const promptRows = input.playlists.map((playlist) => {
    const rows = playlist.candidates.map((candidate) => byId.get(candidate.candidate_id)).filter(Boolean);
    return {
      prompt_id: playlist.prompt_id,
      candidates: playlist.candidates.length,
      completed: rows.length,
      exact: rows.filter((row) => row.outcome === "exact").length,
      conflict: rows.filter((row) => row.outcome === "conflict").length,
      not_found: rows.filter((row) => row.outcome === "not_found").length,
      provider_error: rows.filter((row) => row.outcome === "provider_error").length
    };
  });
  const counts = (key) => Object.fromEntries(
    Array.from(latestResults.reduce((map, result) => {
      const value = result[key] || "none";
      map.set(value, (map.get(value) || 0) + 1);
      return map;
    }, new Map())).sort((left, right) => String(left[0]).localeCompare(String(right[0])))
  );
  const totalProviderRequests = results.reduce((sum, result) =>
    sum + result.attempts.reduce((attemptSum, attempt) =>
      attemptSum + Number(attempt.trace?.provider_requests || 0), 0), 0);
  return {
    schema_version: 1,
    round_id: input.round_id,
    started_at: startedAt,
    finished_at: finishedAt,
    elapsed_seconds: Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 10) / 100,
    candidates: latestResults.length,
    recorded_attempts: results.length,
    outcome: counts("outcome"),
    exact_strategy: counts("exact_strategy"),
    final_reason: counts("final_reason"),
    llm_confidence: Object.fromEntries(["high", "medium", "low"].map((confidence) => {
      const rows = latestResults.filter((result) => result.llm_confidence === confidence);
      return [confidence, {
        total: rows.length,
        exact: rows.filter((row) => row.outcome === "exact").length,
        failed: rows.filter((row) => row.outcome !== "exact").length
      }];
    })),
    provider_requests: totalProviderRequests,
    raw_cache_entries: fs.existsSync(cacheDirectory)
      ? fs.readdirSync(cacheDirectory).filter((name) => name.endsWith(".json")).length
      : 0,
    prompts: promptRows
  };
}

const inputPath = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(inputPath)) {
  throw new Error("Pass an existing round input.json path.");
}
const input = readJson(inputPath);
const roundDir = path.dirname(inputPath);
const resultsPath = path.join(roundDir, "results.jsonl");
const summaryPath = path.join(roundDir, "summary.json");
const cacheDirectory = path.join(__dirname, "cache", "musicbrainz");
const existing = readJsonl(resultsPath);
const retryProviderErrors = process.argv.includes("--retry-provider-errors");
const latestById = new Map(existing.map((result) => [result.candidate_id, result]));
const completedIds = new Set(Array.from(latestById.entries())
  .filter(([, result]) => !retryProviderErrors || result.outcome !== "provider_error")
  .map(([candidateId]) => candidateId));
const candidates = input.playlists.flatMap((playlist) =>
  playlist.candidates.map((candidate) => ({ ...candidate, prompt_id: playlist.prompt_id }))
);
const service = new RecordingMetadataService(cachedFetch(cacheDirectory), {
  minRequestIntervalMs: 1100,
  maxRetries: 2,
  retryBaseMs: 1000
});
const startedAt = new Date().toISOString();

(async () => {
  let completed = completedIds.size;
  for (const candidate of candidates) {
    if (completedIds.has(candidate.candidate_id)) continue;
    const attempts = [];
    let exact = null;
    let providerError = null;
    for (const strategy of strategyInputs(candidate)) {
      const attemptStarted = Date.now();
      try {
        const resolution = await service.lookup(strategy.input);
        const compact = compactResolution(
          strategy.name,
          strategy.input,
          resolution,
          Date.now() - attemptStarted
        );
        attempts.push(compact);
        if (resolution.status === "exact") {
          exact = compact;
          break;
        }
      } catch (error) {
        providerError = error instanceof Error ? error.message : String(error);
        attempts.push({
          strategy: strategy.name,
          input: strategy.input,
          status: "provider_error",
          reason: providerError,
          elapsed_ms: Date.now() - attemptStarted,
          recording_id: null,
          canonical: null,
          proposed_release_match: null,
          candidates: [],
          trace: null
        });
        break;
      }
    }
    const last = attempts[attempts.length - 1];
    const result = {
      schema_version: 1,
      round_id: input.round_id,
      prompt_id: candidate.prompt_id,
      candidate_id: candidate.candidate_id,
      proposal: candidate,
      attempt_number: (existing.filter((entry) => entry.candidate_id === candidate.candidate_id).length || 0) + 1,
      llm_confidence: candidate.llm_confidence,
      outcome: providerError ? "provider_error" : exact ? "exact" : last?.status || "not_found",
      exact_strategy: exact?.strategy || null,
      final_reason: exact?.reason || last?.reason || providerError || "no_attempt",
      recording_id: exact?.recording_id || null,
      canonical: exact?.canonical || null,
      proposed_release_match: exact?.proposed_release_match || null,
      attempts
    };
    appendJsonl(resultsPath, result);
    existing.push(result);
    completed += 1;
    process.stdout.write(`${JSON.stringify({
      candidate_id: candidate.candidate_id,
      completed,
      total: candidates.length,
      outcome: result.outcome,
      strategy: result.exact_strategy,
      reason: result.final_reason,
      elapsed_ms: attempts.reduce((sum, attempt) => sum + attempt.elapsed_ms, 0)
    })}\n`);
  }
  const finishedAt = new Date().toISOString();
  writeJson(summaryPath, aggregate(input, existing, startedAt, finishedAt));
  process.stdout.write(`${JSON.stringify({
    phase: "complete",
    round_id: input.round_id,
    results: resultsPath,
    summary: summaryPath
  })}\n`);
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
