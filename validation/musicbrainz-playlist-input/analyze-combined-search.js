const fs = require("node:fs");
const path = require("node:path");

const VARIANT_MARKERS = [
  "acoustic", "chill", "demo", "dj mix", "edit", "extended", "instrumental", "karaoke",
  "live", "mix", "radio", "remaster", "remix", "rework", "version"
];

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
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function tokens(value) {
  return Array.from(new Set(normalize(value).split(" ").filter(Boolean)));
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

function percentage(part, total) {
  return Math.round(10000 * part / Math.max(1, total)) / 100;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function referenceMbid(row) {
  if (row.effective_outcome === "exact") return row.recording_id || null;
  if (row.combined_outcome === "exact" && row.album_first?.status === "exact") {
    return row.album_first.recordings?.[0]?.recording_id || null;
  }
  return null;
}

function emptyCandidate(mbid) {
  return {
    recording_mbid: mbid,
    title: null,
    disambiguation: null,
    length_ms: null,
    video: false,
    isrcs: [],
    artist_names: [],
    releases: [],
    sources: []
  };
}

function addCandidate(map, value, source) {
  if (!value?.recording_mbid) return;
  const current = map.get(value.recording_mbid) || emptyCandidate(value.recording_mbid);
  current.title = value.title || current.title;
  current.disambiguation = value.disambiguation || current.disambiguation;
  current.length_ms = value.length_ms || current.length_ms;
  current.video = current.video || Boolean(value.video);
  current.isrcs = unique([...current.isrcs, ...(value.isrcs || [])]);
  current.artist_names = unique([
    ...current.artist_names,
    ...(value.artist_names || []),
    ...(value.artist_credit || []).flatMap((credit) => [credit.name, credit.canonical_name])
  ]);
  const releases = value.releases || [];
  const byRelease = new Map(current.releases.map((release) => [
    `${release.release_mbid || ""}:${normalize(release.title)}`,
    release
  ]));
  for (const release of releases) {
    const key = `${release.release_mbid || ""}:${normalize(release.title)}`;
    byRelease.set(key, { ...(byRelease.get(key) || {}), ...release });
  }
  current.releases = Array.from(byRelease.values());
  current.first_release_date = value.first_release_date || current.first_release_date || null;
  current.sources = unique([...current.sources, source]);
  map.set(value.recording_mbid, current);
}

function fromOldCandidate(candidate) {
  return {
    recording_mbid: candidate.recording_id,
    title: candidate.title,
    disambiguation: candidate.disambiguation,
    length_ms: candidate.duration_seconds ? candidate.duration_seconds * 1000 : null,
    video: false,
    isrcs: candidate.isrcs || [],
    artist_names: [],
    releases: (candidate.releases || []).map((title) => ({ title }))
  };
}

function fromAlbumFirst(recording) {
  return {
    recording_mbid: recording.recording_id,
    title: recording.title,
    disambiguation: recording.disambiguation,
    length_ms: recording.length_ms,
    video: recording.video,
    artist_names: recording.artists || [],
    releases: [{
      release_group_mbid: recording.release_group_id,
      release_group_title: recording.release_group_title,
      title: recording.release_group_title,
      date: recording.release_group_first_release_date,
      primary_type: recording.release_group_primary_type,
      secondary_types: recording.release_group_secondary_types
    }]
  };
}

function fromListenBrainzVerification(verification) {
  return {
    recording_mbid: verification.recording_mbid,
    title: verification.title,
    disambiguation: verification.disambiguation,
    length_ms: verification.length_ms,
    video: verification.video,
    artist_names: verification.artists || [],
    releases: verification.releases || []
  };
}

function candidateScore(candidate, proposal, lbResult) {
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

  const acrrMbids = unique(lbResult?.lookups?.acrr?.rows?.map((row) => row.recording_mbid) || []);
  const acrMbids = unique(lbResult?.lookups?.acr?.rows?.map((row) => row.recording_mbid) || []);
  const inAcrr = acrrMbids.includes(candidate.recording_mbid);
  const inAcr = acrMbids.includes(candidate.recording_mbid);
  if (inAcrr) score += 18;
  if (inAcr) score += 10;
  if (inAcrr && inAcr) {
    score += 12;
    reasons.push("listenbrainz_agreement");
  }
  if (candidate.sources.includes("title_words_artist_release")) score += 8;
  if (candidate.sources.includes("title_words_artist_year")) score += 5;
  if (candidate.sources.includes("alias_words_artist")) score += 3;
  if (candidate.sources.includes("album_first")) score += 10;

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

function buildReferenceSet(combined, listenBrainz) {
  const references = [];
  for (const row of combined) {
    if (row.combined_outcome !== "exact" || row.candidate_id === "PLI-003-006") continue;
    references.push({
      candidate_id: row.candidate_id,
      recording_mbid: referenceMbid(row),
      source: "musicbrainz_previous_exact"
    });
  }
  for (const row of listenBrainz.filter((result) => result.final_assessment === "manual_accept")) {
    references.push({
      candidate_id: row.candidate_id,
      recording_mbid: row.selected.recording_mbid,
      source: "listenbrainz_manual_accept"
    });
  }
  return references.sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
}

function strategyMetrics(strategyName, mbResults, references) {
  const referenceMap = new Map(references.map((reference) => [
    reference.candidate_id,
    reference.recording_mbid
  ]));
  let covered = 0;
  let searchTop = 0;
  for (const row of mbResults) {
    const reference = referenceMap.get(row.candidate_id);
    if (!reference) continue;
    const strategy = row.strategies.find((entry) => entry.name === strategyName);
    if (!strategy || strategy.skipped) continue;
    const ids = strategy.recordings.map((recording) => recording.recording_mbid);
    if (ids.includes(reference)) covered += 1;
    if (ids[0] === reference) searchTop += 1;
  }
  return {
    strategy: strategyName,
    references: references.length,
    covered,
    covered_pct: percentage(covered, references.length),
    search_top: searchTop,
    search_top_pct: percentage(searchTop, references.length)
  };
}

function thresholdGrid(evaluated, references) {
  const referenceMap = new Map(references.map((reference) => [
    reference.candidate_id,
    reference.recording_mbid
  ]));
  const grid = [];
  for (const threshold of [150, 170, 190, 210, 230]) {
    for (const margin of [0, 10, 20, 30]) {
      const accepted = evaluated.filter((row) =>
        referenceMap.has(row.candidate_id) &&
        row.top_candidate?.evaluation.hard_compatible &&
        row.top_candidate.evaluation.score >= threshold &&
        row.margin >= margin
      );
      const correct = accepted.filter((row) =>
        row.top_candidate.recording_mbid === referenceMap.get(row.candidate_id)
      ).length;
      grid.push({
        threshold,
        margin,
        accepted: accepted.length,
        correct,
        precision_pct: percentage(correct, accepted.length),
        recall_pct: percentage(correct, references.length)
      });
    }
  }
  return grid;
}

const inputPath = path.resolve(process.argv[2] || "");
if (!inputPath || !fs.existsSync(inputPath)) {
  throw new Error("Pass an existing round input.json path.");
}
const roundDir = path.dirname(inputPath);
const combined = readJsonl(path.join(roundDir, "combined-results.jsonl"));
const mbResults = readJsonl(path.join(roundDir, "mb-strategy-results.jsonl"));
const listenBrainz = readJson(path.join(roundDir, "listenbrainz-evaluated-results.json"));
const manualReview = readJson(path.join(roundDir, "combined-strategy-manual-review.json"));
const executions = readJsonl(path.join(roundDir, "mb-strategy-executions.jsonl"));
const listenBrainzSummary = readJson(path.join(roundDir, "listenbrainz-summary.json"));
const lbById = new Map(listenBrainz.map((result) => [result.candidate_id, result]));
const mbById = new Map(mbResults.map((result) => [result.candidate_id, result]));
const references = buildReferenceSet(combined, listenBrainz);
const referenceById = new Map(references.map((reference) => [
  reference.candidate_id,
  reference.recording_mbid
]));

const evaluated = combined.map((row) => {
  const candidates = new Map();
  for (const attempt of row.attempts || []) {
    for (const candidate of attempt.candidates || []) {
      addCandidate(candidates, fromOldCandidate(candidate), `legacy_${attempt.strategy}`);
    }
  }
  for (const recording of row.album_first?.recordings || []) {
    addCandidate(candidates, fromAlbumFirst(recording), "album_first");
  }
  const lbResult = lbById.get(row.candidate_id);
  for (const verification of lbResult?.verifications || []) {
    addCandidate(candidates, fromListenBrainzVerification(verification), "listenbrainz_verified");
  }
  const mbResult = mbById.get(row.candidate_id);
  for (const strategy of mbResult?.strategies || []) {
    for (const recording of strategy.recordings || []) {
      addCandidate(candidates, recording, strategy.name);
    }
  }
  const ranked = Array.from(candidates.values())
    .map((candidate) => ({
      ...candidate,
      evaluation: candidateScore(candidate, row.proposal, lbResult)
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
  const reference = referenceById.get(row.candidate_id) || null;
  return {
    candidate_id: row.candidate_id,
    prompt_id: row.prompt_id,
    previous_outcome: row.combined_outcome,
    proposal: row.proposal,
    reference_recording_mbid: reference,
    candidate_count: ranked.length,
    top_candidate: top,
    second_candidate: second,
    equivalent_mbid_count: equivalent.length,
    margin: top ? top.evaluation.score - (second?.evaluation.score ?? 0) : 0,
    reference_rank: reference
      ? ranked.findIndex((candidate) => candidate.recording_mbid === reference) + 1 || null
      : null,
    ranked_candidates: ranked.slice(0, 20)
  };
});

const strategyNames = [
  "title_words_artist",
  "alias_words_artist",
  "title_words_artist_release",
  "title_words_artist_year",
  "fuzzy_title_alias_artist"
];
const grid = thresholdGrid(evaluated, references);
const perfectPrecision = grid
  .filter((entry) => entry.precision_pct === 100 && entry.margin >= 20)
  .sort((left, right) => right.correct - left.correct || left.threshold - right.threshold || left.margin - right.margin);
const recommended = perfectPrecision[0] || grid
  .slice()
  .sort((left, right) => right.precision_pct - left.precision_pct || right.correct - left.correct)[0];

for (const row of evaluated) {
  row.recommended_status = row.top_candidate?.evaluation.hard_compatible &&
    row.top_candidate.evaluation.score >= recommended.threshold &&
    row.margin >= recommended.margin
    ? "exact"
    : row.top_candidate?.evaluation.hard_compatible
      ? "candidate"
      : row.candidate_count
        ? "rejected"
        : "not_found";
}

const referenceRows = evaluated.filter((row) => row.reference_recording_mbid);
const topCorrect = referenceRows.filter((row) =>
  row.top_candidate?.recording_mbid === row.reference_recording_mbid
);
const accepted = evaluated.filter((row) => row.recommended_status === "exact");
const acceptedReference = accepted.filter((row) => row.reference_recording_mbid);
const acceptedCorrect = acceptedReference.filter((row) =>
  row.top_candidate.recording_mbid === row.reference_recording_mbid
);
const summary = {
  schema_version: 1,
  round_id: combined[0]?.round_id || null,
  candidates: evaluated.length,
  references,
  strategy_metrics: strategyNames.map((strategy) =>
    strategyMetrics(strategy, mbResults, references)
  ),
  combined_ranking: {
    references: references.length,
    reference_covered: referenceRows.filter((row) => row.reference_rank).length,
    reference_top_1: topCorrect.length,
    reference_top_1_pct: percentage(topCorrect.length, references.length),
    reference_mean_rank: Math.round(100 * referenceRows.reduce(
      (sum, row) => sum + (row.reference_rank || 21),
      0
    ) / Math.max(1, referenceRows.length)) / 100
  },
  threshold_grid: grid,
  recommended_rule: recommended,
  recommended_outcome: {
    exact: accepted.length,
    candidate: evaluated.filter((row) => row.recommended_status === "candidate").length,
    rejected: evaluated.filter((row) => row.recommended_status === "rejected").length,
    not_found: evaluated.filter((row) => row.recommended_status === "not_found").length,
    reference_accepted: acceptedReference.length,
    reference_correct: acceptedCorrect.length,
    reference_precision_pct: percentage(acceptedCorrect.length, acceptedReference.length),
    reference_recall_pct: percentage(acceptedCorrect.length, references.length),
    new_exact_without_reference: accepted.filter((row) => !row.reference_recording_mbid).map((row) => ({
      candidate_id: row.candidate_id,
      title: row.proposal.title,
      artist: row.proposal.primary_artist,
      selected_mbid: row.top_candidate.recording_mbid,
      score: row.top_candidate.evaluation.score,
      margin: row.margin
    }))
  },
  experiment_cost: {
    musicbrainz_strategy_seconds: Math.round(100 * executions.reduce(
      (sum, execution) => sum + execution.elapsed_seconds,
      0
    )) / 100,
    musicbrainz_strategy_requests: executions.reduce(
      (sum, execution) => sum + execution.provider_requests,
      0
    ),
    listenbrainz_seconds: listenBrainzSummary.elapsed_seconds,
    listenbrainz_requests: listenBrainzSummary.listenbrainz.provider_requests,
    musicbrainz_listenbrainz_verification_requests:
      listenBrainzSummary.musicbrainz_verification.provider_requests
  }
};

const newExactById = new Map(summary.recommended_outcome.new_exact_without_reference.map(
  (result) => [result.candidate_id, result]
));
for (const decision of manualReview.decisions) {
  const result = newExactById.get(decision.candidate_id);
  if (!result) throw new Error(`Manual decision is not a new exact result: ${decision.candidate_id}`);
  if (decision.recording_mbid !== result.selected_mbid) {
    throw new Error(`Manual MBID mismatch for ${decision.candidate_id}`);
  }
}
const acceptedNew = manualReview.decisions.filter((decision) => decision.decision === "accept");
const referenceSetV2 = [
  ...references,
  ...acceptedNew.map((decision) => ({
    candidate_id: decision.candidate_id,
    recording_mbid: decision.recording_mbid,
    source: "combined_strategy_manual_accept"
  }))
].sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
summary.manual_review = {
  reviewed: manualReview.decisions.length,
  accepted: acceptedNew.length,
  rejected: manualReview.decisions.filter((decision) => decision.decision === "reject").length
};
summary.verified_reference_set_v2 = {
  recordings: referenceSetV2.length,
  corpus_pct: percentage(referenceSetV2.length, evaluated.length),
  entries: referenceSetV2
};

writeJsonl(path.join(roundDir, "combined-strategy-evaluated.jsonl"), evaluated);
writeJson(path.join(roundDir, "combined-strategy-summary.json"), summary);
writeJson(path.join(roundDir, "combined-strategy-reference-v2.json"), {
  schema_version: 2,
  round_id: summary.round_id,
  recordings: referenceSetV2
});

const report = `# Round 001 — estrategias combinadas MusicBrainz + ListenBrainz

## Resultado

- Corpus: ${evaluated.length} propuestas.
- Referencias verificadas antes de esta prueba: ${references.length}.
- La búsqueda MusicBrainz por palabras recuperó ${summary.strategy_metrics[0].covered}/${references.length} MBIDs de referencia.
- El ranking combinado colocó el MBID correcto primero en ${summary.combined_ranking.reference_top_1}/${references.length} referencias.
- Regla conservadora: score ≥ ${recommended.threshold} y margen ≥ ${recommended.margin}.
- Precisión observada de la aceptación automática sobre referencias: ${summary.recommended_outcome.reference_precision_pct} %.
- Recall automático sobre referencias: ${summary.recommended_outcome.reference_recall_pct} %.
- Recuperaciones nuevas revisadas y aceptadas: ${acceptedNew.length}.
- Nuevo conjunto verificado: ${referenceSetV2.length}/${evaluated.length} (${summary.verified_reference_set_v2.corpus_pct} %).

## Estrategias de consulta MusicBrainz

| Estrategia | Cobertura del MBID correcto | Primer resultado nativo correcto |
|---|---:|---:|
${summary.strategy_metrics.map((metric) =>
    `| ${metric.strategy} | ${metric.covered}/${metric.references} (${metric.covered_pct} %) | ${metric.search_top}/${metric.references} (${metric.search_top_pct} %) |`
  ).join("\n")}

La búsqueda flexible aporta cobertura, pero el primer resultado nativo de
MusicBrainz no es una decisión fiable. El ranking debe comprobar título,
artista, álbum, año, versión, créditos, vídeo, disambiguación, duración,
tipo de release y evidencia de ListenBrainz.

## Recuperaciones nuevas

${acceptedNew.map((decision) =>
    `- ${decision.candidate_id}: \`${decision.recording_mbid}\` — ${decision.reason}`
  ).join("\n")}

## Estrategia recomendada

1. Pedir al LLM título, artista principal, crédito completo, invitados, álbum,
   año, intención de grabación y nombre exacto de versión.
2. Consultar en paralelo ACR y ACRR de ListenBrainz como candidatos rápidos.
3. Consultar MusicBrainz con todas las palabras significativas del título,
   artista principal y \`video:false\`.
4. Buscar alias solo como ampliación. Usar álbum y año para puntuar, no como
   filtros obligatorios.
5. Agrupar por recording MBID y puntuar título, créditos, release, fecha,
   versión, duración, disambiguación y señales de ListenBrainz.
6. Rechazar vídeos, fragmentos de DJ mix, medleys y variantes incompatibles.
7. Aceptar automáticamente solo con score ≥ ${recommended.threshold}, margen
   ≥ ${recommended.margin} y compatibilidad dura.
8. En los demás casos, navegar por release group o conservar el resultado como
   ambiguo; nunca escoger el primero por score nativo.

## Coste de la investigación

- Búsquedas alternativas MusicBrainz: ${summary.experiment_cost.musicbrainz_strategy_requests} peticiones en ${summary.experiment_cost.musicbrainz_strategy_seconds} s.
- ListenBrainz: ${summary.experiment_cost.listenbrainz_requests} peticiones en ${summary.experiment_cost.listenbrainz_seconds} s, más ${summary.experiment_cost.musicbrainz_listenbrainz_verification_requests} verificaciones MusicBrainz.

Este coste prueba varias estrategias por canción. La cascada recomendada no
debe ejecutar todas: una consulta MusicBrainz por palabras, ACR/ACRR y
fallbacks solo para casos de bajo margen.
`;
fs.writeFileSync(path.join(roundDir, "combined-strategy-report.md"), report, "utf8");
process.stdout.write(`${JSON.stringify({
  strategy_metrics: summary.strategy_metrics,
  combined_ranking: summary.combined_ranking,
  recommended_rule: summary.recommended_rule,
  recommended_outcome: summary.recommended_outcome,
  verified_reference_set_v2: summary.verified_reference_set_v2.recordings
})}\n`);
