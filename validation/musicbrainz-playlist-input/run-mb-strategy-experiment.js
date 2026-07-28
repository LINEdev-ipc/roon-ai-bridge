const crypto = require("node:crypto");
const dns = require("node:dns");
const fs = require("node:fs");
const path = require("node:path");

dns.setDefaultResultOrder("ipv4first");

const STOP_WORDS = new Set([
  "a", "an", "and", "de", "del", "e", "el", "en", "et", "feat", "featuring",
  "in", "is", "la", "las", "le", "los", "of", "the", "un", "una", "une", "y"
]);

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

function writeJsonl(file, values) {
  const body = values.map((value) => JSON.stringify(value)).join("\n");
  fs.writeFileSync(file, body ? `${body}\n` : "", "utf8");
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

function significantTokens(value) {
  const all = normalize(value).split(" ").filter(Boolean);
  const significant = all.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  return Array.from(new Set(significant.length ? significant : all));
}

function luceneTerm(value) {
  return value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
}

function quoted(value) {
  return `"${String(value || "").replace(/[\\"]/g, "\\$&")}"`;
}

function andTerms(tokens, fuzzy = false) {
  return tokens
    .map((token) => `${luceneTerm(token)}${fuzzy && token.length >= 4 ? "~0.8" : ""}`)
    .join(" AND ");
}

function strategyQueries(candidate) {
  const titleTokens = significantTokens(candidate.title);
  const albumTokens = significantTokens(candidate.album);
  const titleTerms = andTerms(titleTokens);
  const common = `artistname:${quoted(candidate.primary_artist)} AND video:false`;
  const strategies = [
    {
      name: "title_words_artist",
      query: `recording:(${titleTerms}) AND ${common}`
    },
    {
      name: "alias_words_artist",
      query: `alias:(${titleTerms}) AND ${common}`
    },
    {
      name: "title_words_artist_release",
      query: `recording:(${titleTerms}) AND release:(${andTerms(albumTokens)}) AND ${common}`
    }
  ];
  const year = Number(candidate.year);
  if (Number.isFinite(year)) {
    strategies.push({
      name: "title_words_artist_year",
      query: `recording:(${titleTerms}) AND firstreleasedate:[${year - 1} TO ${year + 1}] AND ${common}`
    });
  }
  strategies.push({
    name: "fuzzy_title_alias_artist",
    query: `(recording:(${andTerms(titleTokens, true)}) OR alias:(${andTerms(titleTokens, true)})) AND ${common}`,
    fallback: true
  });
  return strategies;
}

function cachedRequester(cacheDir) {
  let lastRequestAt = 0;
  let providerRequests = 0;
  let cacheHits = 0;
  return {
    stats: () => ({ provider_requests: providerRequests, cache_hits: cacheHits }),
    request: async (url) => {
      const href = String(url);
      const key = crypto.createHash("sha256").update(href).digest("hex");
      const file = path.join(cacheDir, `${key}.json`);
      if (fs.existsSync(file)) {
        cacheHits += 1;
        return { body: readJson(file).body, cache_hit: true, elapsed_ms: 0 };
      }
      const waitMs = Math.max(0, 1100 - (Date.now() - lastRequestAt));
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
            throw new Error(`MusicBrainz returned HTTP ${response.status}`);
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
          await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
        }
      }
      throw lastError || new Error("MusicBrainz request failed");
    }
  };
}

function compactRecording(recording) {
  return {
    recording_mbid: recording.id,
    score: Number(recording.score) || 0,
    title: recording.title || null,
    disambiguation: recording.disambiguation || null,
    length_ms: recording.length || null,
    video: Boolean(recording.video),
    isrcs: recording.isrcs || [],
    artist_credit: (recording["artist-credit"] || []).map((credit) => ({
      name: credit.name || credit.artist?.name || null,
      artist_mbid: credit.artist?.id || null,
      canonical_name: credit.artist?.name || null,
      joinphrase: credit.joinphrase || ""
    })),
    first_release_date: recording["first-release-date"] || null,
    releases: (recording.releases || []).map((release) => ({
      release_mbid: release.id,
      title: release.title || null,
      date: release.date || null,
      country: release.country || null,
      status: release.status || null,
      release_group_mbid: release["release-group"]?.id || null,
      release_group_title: release["release-group"]?.title || null,
      primary_type: release["release-group"]?.["primary-type"] || null,
      secondary_types: release["release-group"]?.["secondary-types"] || []
    }))
  };
}

function searchUrl(query) {
  const url = new URL("https://musicbrainz.org/ws/2/recording");
  url.searchParams.set("query", query);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "100");
  return url;
}

const inputPath = path.resolve(process.argv[2] || "");
if (!inputPath || !fs.existsSync(inputPath)) {
  throw new Error("Pass an existing round input.json path.");
}

const roundDir = path.dirname(inputPath);
const combinedPath = path.join(roundDir, "combined-results.jsonl");
if (!fs.existsSync(combinedPath)) throw new Error("Run analyze-results.js first.");
const evaluated = readJsonl(combinedPath);
const unresolvedOnly = process.argv.includes("--unresolved-only");
const retryProviderErrors = process.argv.includes("--retry-provider-errors");
const targets = unresolvedOnly
  ? evaluated.filter((row) => row.combined_outcome !== "exact")
  : evaluated;
const outputPath = path.join(roundDir, "mb-strategy-results.jsonl");
const existing = new Map(readJsonl(outputPath).map((result) => [result.candidate_id, result]));
const requester = cachedRequester(path.join(__dirname, "cache", "musicbrainz"));
const startedAt = new Date().toISOString();

(async () => {
  let processed = 0;
  for (const row of targets) {
    const previous = existing.get(row.candidate_id);
    if (previous && !(retryProviderErrors && previous.status === "provider_error")) continue;
    const started = Date.now();
    const strategies = [];
    let providerError = null;
    let strictCandidateCount = 0;
    for (const strategy of strategyQueries(row.proposal)) {
      if (strategy.fallback && strictCandidateCount > 0) {
        strategies.push({
          name: strategy.name,
          query: strategy.query,
          skipped: true,
          reason: "strict_word_or_alias_search_returned_candidates",
          count: 0,
          recordings: []
        });
        continue;
      }
      try {
        const response = await requester.request(searchUrl(strategy.query));
        const recordings = (response.body.recordings || []).map(compactRecording);
        if (strategy.name === "title_words_artist" || strategy.name === "alias_words_artist") {
          strictCandidateCount += recordings.length;
        }
        strategies.push({
          name: strategy.name,
          query: strategy.query,
          skipped: false,
          count: Number(response.body.count) || recordings.length,
          returned: recordings.length,
          cache_hit: response.cache_hit,
          elapsed_ms: response.elapsed_ms,
          recordings
        });
      } catch (error) {
        providerError = error instanceof Error ? error.message : String(error);
        strategies.push({
          name: strategy.name,
          query: strategy.query,
          skipped: false,
          count: 0,
          returned: 0,
          cache_hit: false,
          elapsed_ms: 0,
          error: providerError,
          recordings: []
        });
        break;
      }
    }
    const result = {
      schema_version: 1,
      round_id: row.round_id,
      prompt_id: row.prompt_id,
      candidate_id: row.candidate_id,
      previous_outcome: row.combined_outcome,
      proposal: row.proposal,
      status: providerError ? "provider_error" : "complete",
      error: providerError,
      elapsed_ms: Date.now() - started,
      strategies
    };
    appendJsonl(outputPath, result);
    existing.set(row.candidate_id, result);
    processed += 1;
    process.stdout.write(`${JSON.stringify({
      candidate_id: row.candidate_id,
      processed,
      target_count: targets.length,
      previous_outcome: row.combined_outcome,
      status: result.status,
      candidates: Object.fromEntries(strategies.map((strategy) => [strategy.name, strategy.returned || 0])),
      elapsed_ms: result.elapsed_ms
    })}\n`);
  }

  const results = Array.from(existing.values())
    .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
  writeJsonl(outputPath, results);
  const finishedAt = new Date().toISOString();
  const execution = {
    schema_version: 1,
    execution_id: `mb-strategy-${unresolvedOnly ? "unresolved" : "full"}-${startedAt}`,
    mode: unresolvedOnly ? "unresolved_only" : "full_incremental",
    started_at: startedAt,
    finished_at: finishedAt,
    elapsed_seconds: Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 10) / 100,
    target_candidates: targets.length,
    processed_candidates: processed,
    stored_candidates: results.length,
    status: Object.fromEntries(Array.from(results.reduce((counts, result) => {
      counts.set(result.status, (counts.get(result.status) || 0) + 1);
      return counts;
    }, new Map())).sort()),
    ...requester.stats()
  };
  appendJsonl(path.join(roundDir, "mb-strategy-executions.jsonl"), execution);
  process.stdout.write(`${JSON.stringify({ phase: "complete", execution })}\n`);
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
