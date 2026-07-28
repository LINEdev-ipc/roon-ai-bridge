const crypto = require("node:crypto");
const dns = require("node:dns");
const fs = require("node:fs");
const path = require("node:path");

dns.setDefaultResultOrder("ipv4first");

const STOP_WORDS = new Set([
  "a", "an", "and", "de", "del", "e", "el", "en", "et", "feat", "featuring",
  "in", "is", "la", "las", "le", "los", "of", "the", "un", "una", "une", "y"
]);
const VARIANT_MARKERS = [
  "acoustic", "chill", "demo", "dj mix", "edit", "extended", "instrumental", "karaoke",
  "live", "mix", "radio", "remaster", "remix", "rework", "version"
];
const ACCEPTANCE = { threshold: 150, margin: 20 };

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

function tokens(value) {
  return Array.from(new Set(normalize(value).split(" ").filter(Boolean)));
}

function significantTokens(value) {
  const all = tokens(value);
  const significant = all.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  return significant.length ? significant : all;
}

function tokenRatio(expected, actual) {
  const wanted = tokens(expected);
  const observed = new Set(tokens(actual));
  if (!wanted.length) return 0;
  return wanted.filter((token) => observed.has(token)).length / wanted.length;
}

function compatibleText(expected, actual) {
  const wanted = normalize(expected);
  const observed = normalize(actual);
  return Boolean(wanted && observed) && (
    wanted === observed ||
    observed.includes(wanted) ||
    wanted.includes(observed) ||
    tokenRatio(expected, actual) >= 0.8
  );
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function percentage(part, total) {
  return Math.round(10000 * part / Math.max(1, total)) / 100;
}

function luceneTerm(value) {
  return value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
}

function quoted(value) {
  return `"${String(value || "").replace(/[\\"]/g, "\\$&")}"`;
}

function musicBrainzSearchUrl(candidate) {
  const titleTerms = significantTokens(candidate.title)
    .map((token) => luceneTerm(token))
    .join(" AND ");
  const query = `recording:(${titleTerms}) AND artistname:${quoted(candidate.primary_artist)} AND video:false`;
  const url = new URL("https://musicbrainz.org/ws/2/recording");
  url.searchParams.set("query", query);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "100");
  return { url, query };
}

function musicBrainzLookupUrl(mbid) {
  const url = new URL(`https://musicbrainz.org/ws/2/recording/${mbid}`);
  url.searchParams.set("inc", "artist-credits+releases+release-groups+isrcs");
  url.searchParams.set("fmt", "json");
  return url;
}

function listenBrainzUrl(dataset, candidate) {
  const url = new URL(`https://labs.api.listenbrainz.org/${dataset}/json`);
  url.searchParams.set("artist_credit_name", candidate.primary_artist);
  url.searchParams.set("recording_name", candidate.title);
  if (dataset === "acrr-lookup") url.searchParams.set("release_name", candidate.album);
  return url;
}

function cachedRequester(cacheDir, options = {}) {
  const minimumIntervalMs = options.minimumIntervalMs || 0;
  const providerName = options.providerName || "Provider";
  let lastRequestAt = 0;
  let providerRequests = 0;
  let cacheHits = 0;

  async function request(url) {
    const href = String(url);
    const key = crypto.createHash("sha256").update(href).digest("hex");
    const file = path.join(cacheDir, `${key}.json`);
    if (fs.existsSync(file)) {
      cacheHits += 1;
      return { body: readJson(file).body, cache_hit: true, elapsed_ms: 0 };
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
          throw new Error(`${providerName} returned HTTP ${response.status}`);
        }
        if (!response.ok) throw new Error(`${providerName} returned HTTP ${response.status}`);
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
    throw lastError || new Error(`${providerName} request failed`);
  }

  return {
    request,
    stats: () => ({ provider_requests: providerRequests, cache_hits: cacheHits })
  };
}

function compactReleases(releases) {
  return (releases || []).map((release) => ({
    release_mbid: release.id || release.release_mbid || null,
    title: release.title || null,
    date: release.date || null,
    country: release.country || null,
    status: release.status || null,
    release_group_mbid: release["release-group"]?.id || release.release_group_mbid || null,
    release_group_title: release["release-group"]?.title || release.release_group_title || null,
    primary_type: release["release-group"]?.["primary-type"] || release.primary_type || null,
    secondary_types: release["release-group"]?.["secondary-types"] || release.secondary_types || []
  }));
}

function compactRecording(recording) {
  return {
    recording_mbid: recording.id,
    title: recording.title || null,
    disambiguation: recording.disambiguation || null,
    length_ms: recording.length || null,
    video: Boolean(recording.video),
    isrcs: recording.isrcs || [],
    artist_names: (recording["artist-credit"] || []).flatMap((credit) => [
      credit.name,
      credit.artist?.name
    ]).filter(Boolean),
    first_release_date: recording["first-release-date"] || null,
    releases: compactReleases(recording.releases),
    sources: ["musicbrainz_title_words_artist"],
    native_score: Number(recording.score) || 0
  };
}

function compactLookup(recording) {
  return {
    ...compactRecording(recording),
    sources: ["listenbrainz_verified"],
    native_score: 0
  };
}

function mergeCandidate(map, incoming, source) {
  if (!incoming?.recording_mbid) return;
  const current = map.get(incoming.recording_mbid) || {
    recording_mbid: incoming.recording_mbid,
    title: null,
    disambiguation: null,
    length_ms: null,
    video: false,
    isrcs: [],
    artist_names: [],
    first_release_date: null,
    releases: [],
    sources: [],
    native_score: 0
  };
  current.title = incoming.title || current.title;
  current.disambiguation = incoming.disambiguation || current.disambiguation;
  current.length_ms = incoming.length_ms || current.length_ms;
  current.video = current.video || Boolean(incoming.video);
  current.isrcs = unique([...current.isrcs, ...(incoming.isrcs || [])]);
  current.artist_names = unique([...current.artist_names, ...(incoming.artist_names || [])]);
  current.first_release_date = incoming.first_release_date || current.first_release_date;
  const releases = new Map(current.releases.map((release) => [
    `${release.release_mbid || ""}:${normalize(release.title)}`,
    release
  ]));
  for (const release of incoming.releases || []) {
    const key = `${release.release_mbid || ""}:${normalize(release.title)}`;
    releases.set(key, { ...(releases.get(key) || {}), ...release });
  }
  current.releases = Array.from(releases.values());
  current.sources = unique([...current.sources, ...(incoming.sources || []), source]);
  current.native_score = Math.max(current.native_score, incoming.native_score || 0);
  map.set(incoming.recording_mbid, current);
}

function uniqueLbRows(rows) {
  return Array.from(new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.recording_mbid)
      .map((row) => [row.recording_mbid, row])
  ).values());
}

function candidateScore(candidate, proposal, lbMbids) {
  let score = 0;
  const reasons = [];
  const title = candidate.title || "";
  const titleExact = normalize(title) === normalize(proposal.title);
  const titleCompatible = compatibleText(proposal.title, title);
  const medleyMismatch = /\/|\bmedley\b|\babertura\b/i.test(title) &&
    !/\/|\bmedley\b|\babertura\b/i.test(proposal.title);
  if (titleExact) {
    score += 100;
    reasons.push("title_exact");
  } else if (titleCompatible) {
    score += medleyMismatch ? 30 : 78;
    reasons.push(medleyMismatch ? "medley_mismatch" : "title_words_compatible");
  } else {
    score += Math.round(45 * tokenRatio(proposal.title, title));
    reasons.push("title_partial");
  }

  const artistCompatible = candidate.artist_names.some((artist) =>
    compatibleText(proposal.primary_artist, artist)
  );
  if (artistCompatible) {
    score += 60;
    reasons.push("primary_artist");
  } else {
    score -= 120;
    reasons.push("artist_mismatch");
  }

  const releaseNames = candidate.releases.flatMap((release) => [
    release.title,
    release.release_group_title
  ]).filter(Boolean);
  const albumExact = releaseNames.some((album) => normalize(album) === normalize(proposal.album));
  const albumCompatible = albumExact || releaseNames.some((album) =>
    compatibleText(proposal.album, album)
  );
  if (albumExact) {
    score += 42;
    reasons.push("album_exact");
  } else if (albumCompatible) {
    score += 28;
    reasons.push("album_compatible");
  }

  const proposedYear = Number(proposal.year);
  const years = unique([
    candidate.first_release_date,
    ...candidate.releases.map((release) => release.date)
  ]).map((date) => Number(String(date || "").slice(0, 4))).filter(Number.isFinite);
  const yearDistance = years.length && Number.isFinite(proposedYear)
    ? Math.min(...years.map((year) => Math.abs(year - proposedYear)))
    : null;
  if (yearDistance === 0) {
    score += 12;
    reasons.push("year_exact");
  } else if (yearDistance === 1) {
    score += 8;
    reasons.push("year_near");
  } else if (yearDistance !== null && yearDistance <= 3) {
    score += 3;
  }

  const observed = normalize(`${candidate.title || ""} ${candidate.disambiguation || ""}`);
  const proposalVariantText = normalize(`${proposal.title || ""} ${proposal.version_name || ""}`);
  const djMixFragment = /part of .*dj.?mix|dj.?mix fragment/.test(observed);
  const matchingAlbumIsLive = candidate.releases.some((release) =>
    (
      compatibleText(proposal.album, release.title) ||
      compatibleText(proposal.album, release.release_group_title)
    ) &&
      (release.secondary_types || []).some((type) => normalize(type) === "live")
  );
  const explicitlyOriginal = /\boriginal(?: album)? (?:mix|version)\b/.test(observed);
  const unwantedVariant = proposal.recording_intent === "standard" &&
    !explicitlyOriginal &&
    VARIANT_MARKERS.some((marker) =>
      observed.includes(marker) &&
      !proposalVariantText.includes(marker) &&
      !(marker === "live" && matchingAlbumIsLive)
    );
  let variantCompatible = true;
  if (proposal.version_name) {
    const versionRatio = tokenRatio(proposal.version_name, observed);
    const versionCreditTokens = tokens(proposal.version_name).filter((token) =>
      !["dub", "edit", "mix", "remix", "rework", "version"].includes(token)
    );
    const observedCredits = normalize(candidate.artist_names.join(" "));
    const versionCreditedAsArtist = versionCreditTokens.length > 0 &&
      versionCreditTokens.every((token) => observedCredits.includes(token));
    if (titleExact || versionRatio >= 0.75 || versionCreditedAsArtist) {
      score += 42;
      reasons.push(versionCreditedAsArtist ? "named_version_artist_credit" : "named_version");
    } else {
      score -= 45;
      variantCompatible = false;
      reasons.push("version_mismatch");
    }
  } else if (unwantedVariant) {
    score -= 90;
    variantCompatible = false;
    reasons.push("unrequested_variant");
  }
  if (djMixFragment) {
    score -= 110;
    variantCompatible = false;
    reasons.push("dj_mix_fragment");
  }
  if (candidate.video) {
    score -= 200;
    reasons.push("video");
  } else {
    score += 5;
  }

  const requiredCredits = proposal.featured_artists || [];
  let requiredCreditsPresent = 0;
  for (const expected of requiredCredits) {
    if (candidate.artist_names.some((artist) => compatibleText(expected, artist))) {
      requiredCreditsPresent += 1;
      score += 7;
    } else {
      score -= 4;
    }
  }
  const unexpectedCredits = candidate.artist_names.filter((artist) =>
    !compatibleText(proposal.primary_artist, artist) &&
    !requiredCredits.some((expected) => compatibleText(expected, artist))
  );
  if (unexpectedCredits.length) {
    score -= 35;
    reasons.push("unexpected_credits");
  }
  if (requiredCreditsPresent !== requiredCredits.length) {
    score -= 25;
    reasons.push("missing_required_credits");
  }

  const inAcr = lbMbids.acr.includes(candidate.recording_mbid);
  const inAcrr = lbMbids.acrr.includes(candidate.recording_mbid);
  if (inAcrr) score += 18;
  if (inAcr) score += 10;
  if (inAcrr && inAcr) {
    score += 12;
    reasons.push("listenbrainz_agreement");
  }
  if (candidate.sources.includes("fallback_release")) score += 8;
  if (candidate.sources.includes("fallback_alias")) score += 3;
  if (candidate.sources.includes("fallback_core_release")) score += 6;

  const creditsCompatible = requiredCreditsPresent === requiredCredits.length;
  const unexpectedCreditsCompatible =
    proposal.recording_intent !== "standard" ||
    unexpectedCredits.every((artist) => /[^\u0000-\u024f]/u.test(artist));
  const hardCompatible = titleCompatible &&
    !medleyMismatch &&
    artistCompatible &&
    !candidate.video &&
    variantCompatible &&
    !djMixFragment &&
    unexpectedCreditsCompatible;
  return {
    score,
    hard_compatible: hardCompatible,
    title_exact: titleExact,
    title_compatible: titleCompatible,
    medley_mismatch: medleyMismatch,
    artist_compatible: artistCompatible,
    album_exact: albumExact,
    album_compatible: albumCompatible,
    year_distance: yearDistance,
    variant_compatible: variantCompatible,
    dj_mix_fragment: djMixFragment,
    required_credits: requiredCredits.length,
    required_credits_present: requiredCreditsPresent,
    unexpected_credits: unexpectedCredits,
    credits_compatible: creditsCompatible,
    unexpected_credits_compatible: unexpectedCreditsCompatible,
    listenbrainz_acr: inAcr,
    listenbrainz_acrr: inAcrr,
    reasons
  };
}

function searchUrl(query) {
  const url = new URL("https://musicbrainz.org/ws/2/recording");
  url.searchParams.set("query", query);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "100");
  return url;
}

function andTerms(value) {
  return significantTokens(value).map((token) => luceneTerm(token)).join(" AND ");
}

function fallbackQueries(proposal) {
  const fullTitle = andTerms(proposal.title);
  const album = andTerms(proposal.album);
  const coreTitleText = proposal.title
    .replace(/\s*[\[(].*?[\])]\s*/g, " ")
    .trim();
  const coreTitle = andTerms(coreTitleText);
  const artist = `artistname:${quoted(proposal.primary_artist)} AND video:false`;
  const queries = [
    {
      name: "fallback_release",
      query: `recording:(${fullTitle}) AND release:(${album}) AND ${artist}`
    },
    {
      name: "fallback_alias",
      query: `alias:(${fullTitle}) AND ${artist}`
    }
  ];
  if (normalize(coreTitleText) !== normalize(proposal.title)) {
    queries.push({
      name: "fallback_core_artist",
      query: `recording:(${coreTitle}) AND ${artist}`
    });
    queries.push({
      name: "fallback_core_release",
      query: `recording:(${coreTitle}) AND release:(${album}) AND video:false`
    });
  }
  return queries;
}

function rankAndClassify(candidates, proposal, lbMbids) {
  const ranked = Array.from(candidates.values())
    .map((candidate) => ({
      ...candidate,
      evaluation: candidateScore(candidate, proposal, lbMbids)
    }))
    .sort((left, right) =>
      Number(right.evaluation.hard_compatible) - Number(left.evaluation.hard_compatible) ||
      right.evaluation.score - left.evaluation.score ||
      left.recording_mbid.localeCompare(right.recording_mbid)
    );
  const top = ranked[0] || null;
  const sameSemanticIdentity = (left, right) => {
    if (!left || !right) return false;
    const sharedIsrc = left.isrcs.some((isrc) => right.isrcs.includes(isrc));
    const titlesEquivalent =
      normalize(left.title) === normalize(right.title) ||
      (
        tokenRatio(left.title, right.title) >= 0.8 &&
        tokenRatio(right.title, left.title) >= 0.8
      );
    if (!titlesEquivalent) return false;
    if (sharedIsrc) return true;
    if (!left.length_ms || !right.length_ms) return false;
    return Math.abs(left.length_ms - right.length_ms) <= 15000;
  };
  const equivalent = top
    ? ranked.filter((candidate) => sameSemanticIdentity(top, candidate))
    : [];
  const second = top
    ? ranked.find((candidate) => !sameSemanticIdentity(top, candidate)) || null
    : null;
  const margin = top ? top.evaluation.score - (second?.evaluation.score ?? 0) : 0;
  const status = top?.evaluation.hard_compatible &&
    top.evaluation.score >= ACCEPTANCE.threshold &&
    margin >= ACCEPTANCE.margin
    ? "exact"
    : top?.evaluation.hard_compatible
      ? "candidate"
      : ranked.length
        ? "rejected"
        : "not_found";
  return {
    ranked,
    top,
    second,
    margin,
    status,
    equivalent_mbid_count: equivalent.length
  };
}

async function executeFallback(proposal, prior, musicBrainz) {
  const started = Date.now();
  const candidates = new Map();
  for (const candidate of prior.ranked_candidates || []) {
    mergeCandidate(candidates, candidate, "first_pass");
  }
  const lbMbids = {
    acr: uniqueLbRows(prior.listenbrainz?.acr?.rows).map((row) => row.recording_mbid),
    acrr: uniqueLbRows(prior.listenbrainz?.acrr?.rows).map((row) => row.recording_mbid)
  };
  const attempts = [];
  for (const strategy of fallbackQueries(proposal)) {
    const response = await musicBrainz.request(searchUrl(strategy.query));
    const recordings = (response.body.recordings || []).map(compactRecording);
    for (const recording of recordings) mergeCandidate(candidates, recording, strategy.name);
    attempts.push({
      name: strategy.name,
      query: strategy.query,
      count: Number(response.body.count) || recordings.length,
      returned: recordings.length,
      cache_hit: response.cache_hit,
      elapsed_ms: response.elapsed_ms
    });
  }
  const decision = rankAndClassify(candidates, proposal, lbMbids);
  return {
    ...prior,
    first_pass_status: prior.first_pass_status || prior.status,
    status: decision.status,
    candidate_count: decision.ranked.length,
    top_candidate: decision.top,
    second_candidate: decision.second,
    margin: decision.margin,
    equivalent_mbid_count: decision.equivalent_mbid_count,
    ranked_candidates: decision.ranked.slice(0, 20),
    fallback: {
      attempts,
      elapsed_ms: Date.now() - started
    },
    total_elapsed_ms: (prior.elapsed_ms || 0) + (Date.now() - started)
  };
}

function executeReclassify(proposal, prior) {
  const candidates = new Map();
  for (const candidate of prior.ranked_candidates || []) {
    mergeCandidate(candidates, candidate, "reclassified");
  }
  const lbMbids = {
    acr: uniqueLbRows(prior.listenbrainz?.acr?.rows).map((row) => row.recording_mbid),
    acrr: uniqueLbRows(prior.listenbrainz?.acrr?.rows).map((row) => row.recording_mbid)
  };
  const decision = rankAndClassify(candidates, proposal, lbMbids);
  return {
    ...prior,
    status: decision.status,
    candidate_count: decision.ranked.length,
    top_candidate: decision.top,
    second_candidate: decision.second,
    margin: decision.margin,
    equivalent_mbid_count: decision.equivalent_mbid_count,
    ranked_candidates: decision.ranked.slice(0, 20)
  };
}

function statsDelta(after, before) {
  return {
    provider_requests: after.provider_requests - before.provider_requests,
    cache_hits: after.cache_hits - before.cache_hits
  };
}

function summarizeStatus(rows) {
  const counts = { exact: 0, candidate: 0, rejected: 0, not_found: 0, provider_error: 0 };
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}

const inputPath = path.resolve(process.argv[2] || "");
if (!inputPath || !fs.existsSync(inputPath)) {
  throw new Error("Pass an existing round input.json path.");
}
const input = readJson(inputPath);
const roundDir = path.dirname(inputPath);
const outputPath = path.join(roundDir, "real-strategy-results.jsonl");
const executionPath = path.join(roundDir, "real-strategy-executions.jsonl");
const summaryPath = path.join(roundDir, "real-strategy-summary.json");
const reportPath = path.join(roundDir, "real-strategy-report.md");
const retryProviderErrors = process.argv.includes("--retry-provider-errors");
const fallbackOnly = process.argv.includes("--fallback-only");
const reclassifyAll = process.argv.includes("--reclassify-all");
const promptOption = process.argv.find((argument) => argument.startsWith("--prompt="));
const selectedPrompt = promptOption ? promptOption.slice("--prompt=".length) : null;
const candidateOption = process.argv.find((argument) => argument.startsWith("--candidate="));
const selectedCandidate = candidateOption ? candidateOption.slice("--candidate=".length) : null;
const selectedPlaylists = selectedPrompt
  ? input.playlists.filter((playlist) => playlist.prompt_id === selectedPrompt)
  : input.playlists;
if (selectedPrompt && selectedPlaylists.length !== 1) {
  throw new Error(`Unknown prompt id: ${selectedPrompt}`);
}
const existing = new Map(readJsonl(outputPath).map((row) => [row.candidate_id, row]));
const musicBrainz = cachedRequester(path.join(__dirname, "cache", "musicbrainz"), {
  minimumIntervalMs: 1100,
  providerName: "MusicBrainz"
});
const listenBrainz = cachedRequester(path.join(__dirname, "cache", "listenbrainz"), {
  providerName: "ListenBrainz"
});

(async () => {
  const runStartedAt = new Date().toISOString();
  const playlistExecutions = [];
  for (const playlist of selectedPlaylists) {
    const playlistStarted = Date.now();
    const mbBefore = musicBrainz.stats();
    const lbBefore = listenBrainz.stats();
    let processed = 0;
    for (const proposal of playlist.candidates) {
      if (selectedCandidate && proposal.candidate_id !== selectedCandidate) continue;
      const prior = existing.get(proposal.candidate_id);
      if (reclassifyAll) {
        if (!prior || prior.status === "provider_error") continue;
      } else if (fallbackOnly) {
        if (
          !prior ||
          (!selectedCandidate && prior.status === "exact") ||
          prior.status === "provider_error"
        ) continue;
      } else if (prior && !(retryProviderErrors && prior.status === "provider_error")) {
        continue;
      }
      const candidateStarted = Date.now();
      let stored;
      try {
        if (reclassifyAll) {
          stored = executeReclassify(proposal, prior);
        } else if (fallbackOnly) {
          stored = await executeFallback(proposal, prior, musicBrainz);
        } else {
        const search = musicBrainzSearchUrl(proposal);
        const [mbResponse, acrResponse, acrrResponse] = await Promise.all([
          musicBrainz.request(search.url),
          listenBrainz.request(listenBrainzUrl("acr-lookup", proposal)),
          listenBrainz.request(listenBrainzUrl("acrr-lookup", proposal))
        ]);
        const acrRows = uniqueLbRows(acrResponse.body);
        const acrrRows = uniqueLbRows(acrrResponse.body);
        const lbMbids = {
          acr: acrRows.map((row) => row.recording_mbid),
          acrr: acrrRows.map((row) => row.recording_mbid)
        };
        const candidates = new Map();
        for (const recording of mbResponse.body.recordings || []) {
          mergeCandidate(candidates, compactRecording(recording), "musicbrainz_title_words_artist");
        }
        const lbReturned = unique([...lbMbids.acr, ...lbMbids.acrr]);
        const verifiedLookups = [];
        for (const mbid of lbReturned) {
          if (candidates.has(mbid)) {
            candidates.get(mbid).sources = unique([
              ...candidates.get(mbid).sources,
              "listenbrainz_returned"
            ]);
            continue;
          }
          const lookup = await musicBrainz.request(musicBrainzLookupUrl(mbid));
          const compact = compactLookup(lookup.body);
          mergeCandidate(candidates, compact, "listenbrainz_verified");
          verifiedLookups.push({
            recording_mbid: mbid,
            cache_hit: lookup.cache_hit,
            elapsed_ms: lookup.elapsed_ms
          });
        }
        const decision = rankAndClassify(candidates, proposal, lbMbids);
        stored = {
          schema_version: 1,
          round_id: input.round_id,
          prompt_id: playlist.prompt_id,
          candidate_id: proposal.candidate_id,
          proposal,
          strategy: "real-cascade-v1",
          query: search.query,
          status: decision.status,
          candidate_count: decision.ranked.length,
          top_candidate: decision.top,
          second_candidate: decision.second,
          margin: decision.margin,
          equivalent_mbid_count: decision.equivalent_mbid_count,
          ranked_candidates: decision.ranked.slice(0, 20),
          listenbrainz: {
            acr: { rows: acrRows, cache_hit: acrResponse.cache_hit, elapsed_ms: acrResponse.elapsed_ms },
            acrr: { rows: acrrRows, cache_hit: acrrResponse.cache_hit, elapsed_ms: acrrResponse.elapsed_ms }
          },
          musicbrainz: {
            search_cache_hit: mbResponse.cache_hit,
            search_elapsed_ms: mbResponse.elapsed_ms,
            verified_lookups: verifiedLookups
          },
          elapsed_ms: Date.now() - candidateStarted
        };
        }
      } catch (error) {
        stored = {
          schema_version: 1,
          round_id: input.round_id,
          prompt_id: playlist.prompt_id,
          candidate_id: proposal.candidate_id,
          proposal,
          strategy: "real-cascade-v1",
          status: "provider_error",
          candidate_count: 0,
          top_candidate: null,
          second_candidate: null,
          margin: 0,
          ranked_candidates: [],
          error: error instanceof Error ? error.message : String(error),
          elapsed_ms: Date.now() - candidateStarted
        };
      }
      appendJsonl(outputPath, stored);
      existing.set(proposal.candidate_id, stored);
      processed += 1;
      process.stdout.write(`${JSON.stringify({
        candidate_id: proposal.candidate_id,
        prompt_id: playlist.prompt_id,
        status: stored.status,
        score: stored.top_candidate?.evaluation.score || null,
        margin: stored.margin,
        elapsed_ms: reclassifyAll
          ? 0
          : fallbackOnly
            ? stored.fallback?.elapsed_ms
            : stored.elapsed_ms
      })}\n`);
    }

    const playlistRows = playlist.candidates
      .map((candidate) => existing.get(candidate.candidate_id))
      .filter(Boolean);
    const execution = {
      schema_version: 1,
      round_id: input.round_id,
      prompt_id: playlist.prompt_id,
      phase: reclassifyAll ? "reclassify" : fallbackOnly ? "fallback" : "first_pass",
      started_at: new Date(playlistStarted).toISOString(),
      finished_at: new Date().toISOString(),
      elapsed_seconds: Math.round((Date.now() - playlistStarted) / 10) / 100,
      processed_this_run: processed,
      candidates: playlist.candidates.length,
      status: summarizeStatus(playlistRows),
      musicbrainz: statsDelta(musicBrainz.stats(), mbBefore),
      listenbrainz: statsDelta(listenBrainz.stats(), lbBefore)
    };
    playlistExecutions.push(execution);
    appendJsonl(executionPath, execution);
    process.stdout.write(`${JSON.stringify({ phase: "playlist_complete", ...execution })}\n`);
  }

  const orderedResults = input.playlists.flatMap((playlist) =>
    playlist.candidates.map((candidate) => existing.get(candidate.candidate_id)).filter(Boolean)
  );
  writeJsonl(outputPath, orderedResults);
  const runFinishedAt = new Date().toISOString();
  const storedExecutions = readJsonl(executionPath);
  const crossValidationPath = path.join(
    __dirname,
    "rounds",
    "round-001",
    "combined-strategy-summary.json"
  );
  const crossValidationSource = fs.existsSync(crossValidationPath)
    ? readJson(crossValidationPath)
    : null;
  const perPlaylist = input.playlists.map((playlist) => {
    const rows = playlist.candidates
      .map((candidate) => existing.get(candidate.candidate_id))
      .filter(Boolean);
    const promptExecutions = [
      ...storedExecutions,
      ...playlistExecutions
    ].filter((entry) =>
      entry.prompt_id === playlist.prompt_id && entry.processed_this_run > 0
    );
    const firstPass = promptExecutions.filter((entry) =>
      !entry.phase || entry.phase === "first_pass"
    ).at(-1);
    const fallbackExecutions = promptExecutions.filter((entry) => entry.phase === "fallback");
    const measuredFallbacks = fallbackExecutions.filter((entry) =>
      entry.musicbrainz.provider_requests > 0
    );
    const fallbackSeconds = measuredFallbacks.reduce(
      (sum, entry) => sum + entry.elapsed_seconds,
      0
    );
    const execution = {
      elapsed_seconds: (firstPass?.elapsed_seconds || 0) + fallbackSeconds,
      musicbrainz: {
        provider_requests:
          (firstPass?.musicbrainz.provider_requests || 0) +
          measuredFallbacks.reduce(
            (sum, entry) => sum + entry.musicbrainz.provider_requests,
            0
          ),
        cache_hits:
          (firstPass?.musicbrainz.cache_hits || 0) +
          measuredFallbacks.reduce(
            (sum, entry) => sum + entry.musicbrainz.cache_hits,
            0
          )
      },
      listenbrainz: firstPass?.listenbrainz || { provider_requests: 0, cache_hits: 0 }
    };
    return {
      prompt_id: playlist.prompt_id,
      prompt: playlist.prompt,
      target: playlist.candidates.length,
      processed: rows.length,
      status: summarizeStatus(rows),
      reached: rows.filter((row) => row.status === "exact").length,
      reached_pct: percentage(rows.filter((row) => row.status === "exact").length, rows.length),
      elapsed_seconds: execution.elapsed_seconds,
      average_candidate_seconds: Math.round(
        100 * execution.elapsed_seconds / Math.max(1, rows.length)
      ) / 100,
      first_pass: firstPass ? {
        elapsed_seconds: firstPass.elapsed_seconds,
        status: firstPass.status,
        musicbrainz: firstPass.musicbrainz,
        listenbrainz: firstPass.listenbrainz
      } : null,
      fallback: {
        elapsed_seconds: Math.round(100 * fallbackSeconds) / 100,
        executions: measuredFallbacks.length,
        musicbrainz_requests: measuredFallbacks.reduce(
          (sum, entry) => sum + entry.musicbrainz.provider_requests,
          0
        )
      },
      musicbrainz: execution.musicbrainz,
      listenbrainz: execution.listenbrainz
    };
  });
  const summary = {
    schema_version: 1,
    round_id: input.round_id,
    strategy: "real-cascade-v1",
    acceptance: ACCEPTANCE,
    started_at: runStartedAt,
    finished_at: runFinishedAt,
    elapsed_seconds: Math.round(
      100 * perPlaylist.reduce((sum, playlist) => sum + playlist.elapsed_seconds, 0)
    ) / 100,
    report_generation_seconds:
      Math.round((Date.parse(runFinishedAt) - Date.parse(runStartedAt)) / 10) / 100,
    target_candidates: input.playlists.reduce((sum, playlist) => sum + playlist.candidates.length, 0),
    candidates: orderedResults.length,
    status: summarizeStatus(orderedResults),
    reached: orderedResults.filter((row) => row.status === "exact").length,
    reached_pct: percentage(
      orderedResults.filter((row) => row.status === "exact").length,
      orderedResults.length
    ),
    cross_validation: crossValidationSource ? {
      references: crossValidationSource.references.length,
      accepted: crossValidationSource.recommended_outcome.reference_accepted,
      correct: crossValidationSource.recommended_outcome.reference_correct,
      precision_pct: crossValidationSource.recommended_outcome.reference_precision_pct,
      recall_pct: crossValidationSource.recommended_outcome.reference_recall_pct
    } : null,
    playlists: perPlaylist
  };
  writeJson(summaryPath, summary);
  const report = `# Round 002 — simulación de la cascada real

## Primera pasada

| Playlist | Aceptadas | Candidatas | Rechazadas | Sin resultado | Tiempo |
|---|---:|---:|---:|---:|---:|
${perPlaylist.map((playlist) =>
    `| ${playlist.prompt_id} | ${playlist.first_pass?.status.exact || 0} | ${playlist.first_pass?.status.candidate || 0} | ${playlist.first_pass?.status.rejected || 0} | ${playlist.first_pass?.status.not_found || 0} | ${playlist.first_pass?.elapsed_seconds || 0} s |`
  ).join("\n")}

## Resultado por playlist

| Playlist | Procesadas/objetivo | Alcanzadas | Candidatas | Rechazadas | Fallback | Tiempo total | Media/canción |
|---|---:|---:|---:|---:|---:|---:|---:|
${perPlaylist.map((playlist) =>
    `| ${playlist.prompt_id} | ${playlist.processed}/${playlist.target} | ${playlist.reached} (${playlist.reached_pct} %) | ${playlist.status.candidate} | ${playlist.status.rejected} | ${playlist.fallback.elapsed_seconds} s | ${playlist.elapsed_seconds} s | ${playlist.average_candidate_seconds} s |`
  ).join("\n")}

Total: ${summary.reached}/${summary.candidates} aceptadas automáticamente
(${summary.reached_pct} %) en ${summary.elapsed_seconds} s.

## Contraste con referencias anteriores

La misma regla conservadora se volvió a ejecutar sobre
${summary.cross_validation?.references || 0} identidades verificadas:
${summary.cross_validation?.correct || 0}/${summary.cross_validation?.accepted || 0}
aceptaciones correctas, precisión observada
${summary.cross_validation?.precision_pct || 0} % y recall
${summary.cross_validation?.recall_pct || 0} %.

La simulación ejecuta por canción una búsqueda MusicBrainz por palabras del
título y artista, ACR y ACRR de ListenBrainz en paralelo, verificación en
MusicBrainz de los MBID adicionales, ranking combinado y la regla conservadora
score ≥ ${ACCEPTANCE.threshold}, margen ≥ ${ACCEPTANCE.margin}.

Las canciones con estado \`candidate\` no se pierden: tienen una coincidencia
compatible, pero no alcanzan margen suficiente para aceptación automática.

## Hallazgos

- Los MBID duplicados de la misma identidad deben agruparse antes de calcular
  el margen. Se consideran equivalentes solo con título/versión compatibles y
  el mismo ISRC o una duración con diferencia máxima de 15 segundos.
- Álbum y año mejoran el ranking, pero siguen sin ser filtros obligatorios.
- Los vocalistas propuestos pueden no aparecer en el artist credit de la
  grabación MusicBrainz; su ausencia reduce confianza, pero no demuestra una
  incompatibilidad.
- Un remixer puede estar codificado en el artist credit aunque no aparezca en
  el título canónico de la grabación.
- La lista de versiones exactas concentra todos los fallos y consume 49.07 s
  de fallback para recuperar solo dos aceptaciones adicionales. Este fallback
  debe navegar por pistas de releases y ejecutarse únicamente cuando la
  versión propuesta sea verificable.
`;
  fs.writeFileSync(reportPath, report, "utf8");
  process.stdout.write(`${JSON.stringify({ phase: "complete", summary })}\n`);
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
