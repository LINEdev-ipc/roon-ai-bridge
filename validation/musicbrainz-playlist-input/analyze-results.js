const fs = require("node:fs");
const path = require("node:path");

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
  const body = values.map((value) => JSON.stringify(value)).join("\n");
  fs.writeFileSync(file, body ? `${body}\n` : "", "utf8");
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

function countBy(values, key) {
  return Object.fromEntries(Array.from(values.reduce((counts, value) => {
    const item = typeof key === "function" ? key(value) : value[key];
    counts.set(item || "none", (counts.get(item || "none") || 0) + 1);
    return counts;
  }, new Map())).sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
}

function percentage(part, total) {
  return Math.round(10000 * part / Math.max(1, total)) / 100;
}

function effectiveResult(result) {
  if (result.outcome === "exact") {
    return {
      outcome: "exact",
      reason: result.final_reason,
      bestAttempt: result.attempts.find((attempt) => attempt.status === "exact")
    };
  }
  const conflicts = result.attempts.filter((attempt) => attempt.status === "conflict");
  if (conflicts.length) {
    const albumConflict = conflicts.find((attempt) => attempt.strategy.includes("album"));
    const best = albumConflict || conflicts[conflicts.length - 1];
    return { outcome: "conflict", reason: best.reason, bestAttempt: best };
  }
  const provider = result.attempts.find((attempt) => attempt.status === "provider_error");
  if (provider) {
    return { outcome: "provider_error", reason: provider.reason, bestAttempt: provider };
  }
  const best = result.attempts[result.attempts.length - 1] || null;
  return { outcome: "not_found", reason: best?.reason || "no_attempt", bestAttempt: best };
}

function albumFirstCanonical(result) {
  if (!result || result.status !== "exact") return null;
  const recording = result.recordings[0];
  const releaseGroup = result.compatible_release_groups.find(
    (candidate) => candidate.release_group_id === recording?.release_group_id
  ) || result.compatible_release_groups[0];
  return {
    recording_mbid: recording?.recording_id || null,
    title: recording?.title || result.proposal.title,
    album: releaseGroup?.title || result.proposal.album,
    original_release_date: releaseGroup?.first_release_date || null,
    original_release_year: Number(String(releaseGroup?.first_release_date || "").slice(0, 4)) || null
  };
}

function markdownTable(rows) {
  const header = "| ID | Canción | Artista | Resultado | Estrategia |";
  const divider = "|---|---|---|---|---|";
  return [
    header,
    divider,
    ...rows.map((row) =>
      `| ${row.candidate_id} | ${row.proposal.title.replace(/\|/g, "\\|")} | ${row.proposal.primary_artist.replace(/\|/g, "\\|")} | ${row.combined_outcome} | ${row.combined_exact_strategy || "—"} |`
    )
  ].join("\n");
}

const inputPath = path.resolve(process.argv[2] || "");
if (!inputPath || !fs.existsSync(inputPath)) {
  throw new Error("Pass an existing input.json path.");
}

const roundDir = path.dirname(inputPath);
const input = readJson(inputPath);
const rawResults = readJsonl(path.join(roundDir, "results.jsonl"));
const albumFirstResults = readJsonl(path.join(roundDir, "album-first-results.jsonl"));
const executions = readJsonl(path.join(roundDir, "executions.jsonl"));
const latestById = new Map(rawResults.map((result) => [result.candidate_id, result]));
const albumFirstById = new Map(albumFirstResults.map((result) => [result.candidate_id, result]));

const evaluated = Array.from(latestById.values())
  .map((result) => {
    const effective = effectiveResult(result);
    const albumFirst = albumFirstById.get(result.candidate_id) || null;
    const recoveredByAlbumFirst = effective.outcome !== "exact" && albumFirst?.status === "exact";
    const canonical = recoveredByAlbumFirst ? albumFirstCanonical(albumFirst) : result.canonical;
    const proposedYear = Number(result.proposal.year) || null;
    const canonicalYear = Number(canonical?.original_release_year) || null;
    return {
      ...result,
      effective_outcome: effective.outcome,
      effective_reason: effective.reason,
      best_failure_strategy: effective.outcome === "exact" ? null : effective.bestAttempt?.strategy || null,
      compatible_candidates: effective.bestAttempt?.trace?.candidate_counts?.accepted ?? null,
      album_first: albumFirst,
      combined_outcome: recoveredByAlbumFirst ? "exact" : effective.outcome,
      combined_reason: recoveredByAlbumFirst
        ? albumFirst.reason
        : effective.reason,
      combined_exact_strategy: recoveredByAlbumFirst
        ? "album_first_release_group"
        : result.exact_strategy || null,
      combined_canonical: canonical || null,
      proposal_audit: {
        album_matches_canonical: canonical
          ? normalize(result.proposal.album) === normalize(canonical.album)
          : null,
        year_matches_canonical: canonicalYear === null ? null : proposedYear === canonicalYear,
        year_distance: canonicalYear === null || proposedYear === null ? null : proposedYear - canonicalYear
      }
    };
  })
  .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));

const baselineExact = evaluated.filter((result) => result.effective_outcome === "exact");
const combinedExact = evaluated.filter((result) => result.combined_outcome === "exact");
const prompts = input.playlists.map((playlist) => {
  const rows = evaluated.filter((result) => result.prompt_id === playlist.prompt_id);
  const duplicates = Array.from(rows.reduce((counts, row) => {
    const artist = normalize(row.proposal.primary_artist);
    counts.set(artist, (counts.get(artist) || 0) + 1);
    return counts;
  }, new Map()))
    .filter(([, count]) => count > 1)
    .map(([artist]) => artist);
  return {
    prompt_id: playlist.prompt_id,
    candidates: rows.length,
    baseline_exact: rows.filter((row) => row.effective_outcome === "exact").length,
    exact: rows.filter((row) => row.combined_outcome === "exact").length,
    conflict: rows.filter((row) => row.combined_outcome === "conflict").length,
    not_found: rows.filter((row) => row.combined_outcome === "not_found").length,
    provider_error: rows.filter((row) => row.combined_outcome === "provider_error").length,
    repeated_primary_artists: duplicates
  };
});

const yearComparable = combinedExact.filter((result) => result.proposal_audit.year_distance !== null);
const albumFirstSummaryPath = path.join(roundDir, "album-first-summary.json");
const albumFirstSummary = fs.existsSync(albumFirstSummaryPath)
  ? readJson(albumFirstSummaryPath)
  : null;
const progressiveAttempts = rawResults.flatMap((result) => result.attempts);
const progressiveProviderRequests = progressiveAttempts.reduce(
  (sum, attempt) => sum + (attempt.trace?.provider_requests || 0),
  0
);

const summary = {
  schema_version: 3,
  round_id: input.round_id,
  candidates: evaluated.length,
  recorded_attempts: rawResults.length,
  executions,
  elapsed_seconds_total: executions.reduce((sum, execution) => sum + execution.elapsed_seconds, 0),
  elapsed_seconds_baseline: executions
    .filter((execution) => execution.mode !== "album_first_recovery")
    .reduce((sum, execution) => sum + execution.elapsed_seconds, 0),
  query_activity: {
    progressive_strategy_attempts: progressiveAttempts.length,
    progressive_provider_requests: progressiveProviderRequests,
    album_first_provider_requests: albumFirstSummary?.provider_requests || 0,
    provider_requests_total: progressiveProviderRequests + (albumFirstSummary?.provider_requests || 0)
  },
  baseline: {
    outcome: countBy(evaluated, "effective_outcome"),
    exact_strategy: countBy(baselineExact, "exact_strategy"),
    exact_rate_pct: percentage(baselineExact.length, evaluated.length)
  },
  album_first_experiment: albumFirstSummary,
  combined: {
    outcome: countBy(evaluated, "combined_outcome"),
    exact_strategy: countBy(combinedExact, "combined_exact_strategy"),
    exact_rate_pct: percentage(combinedExact.length, evaluated.length),
    catalog_candidate_rate_pct: percentage(
      evaluated.filter((row) => row.combined_outcome === "exact" || row.combined_outcome === "conflict").length,
      evaluated.length
    )
  },
  proposal_accuracy_on_combined_exact: {
    album_exact: combinedExact.filter((row) => row.proposal_audit.album_matches_canonical).length,
    album_exact_pct: percentage(
      combinedExact.filter((row) => row.proposal_audit.album_matches_canonical).length,
      combinedExact.length
    ),
    year_exact: yearComparable.filter((row) => row.proposal_audit.year_distance === 0).length,
    year_exact_pct: percentage(
      yearComparable.filter((row) => row.proposal_audit.year_distance === 0).length,
      yearComparable.length
    ),
    year_within_one: yearComparable.filter((row) => Math.abs(row.proposal_audit.year_distance) <= 1).length,
    year_within_one_pct: percentage(
      yearComparable.filter((row) => Math.abs(row.proposal_audit.year_distance) <= 1).length,
      yearComparable.length
    )
  },
  llm_confidence: Object.fromEntries(["high", "medium", "low"].map((confidence) => {
    const rows = evaluated.filter((row) => row.llm_confidence === confidence);
    return [confidence, {
      total: rows.length,
      exact: rows.filter((row) => row.combined_outcome === "exact").length,
      exact_pct: percentage(
        rows.filter((row) => row.combined_outcome === "exact").length,
        rows.length
      )
    }];
  })),
  prompts
};

writeJsonl(path.join(roundDir, "evaluated-results.jsonl"), evaluated);
writeJsonl(path.join(roundDir, "combined-results.jsonl"), evaluated);
writeJson(path.join(roundDir, "summary.json"), summary);

const report = `# Round 001 — LLM → MusicBrainz

## Resultado

- Propuestas: ${summary.candidates}.
- Identidad exacta con la búsqueda progresiva: ${summary.baseline.outcome.exact || 0} (${summary.baseline.exact_rate_pct} %).
- Identidades adicionales recuperadas navegando primero por álbum: ${summary.album_first_experiment?.recovered_exact || 0}.
- Identidad exacta combinada: ${summary.combined.outcome.exact || 0} (${summary.combined.exact_rate_pct} %).
- Varias grabaciones compatibles sin resolver: ${summary.combined.outcome.conflict || 0}.
- Sin candidato compatible: ${summary.combined.outcome.not_found || 0}.
- Errores de proveedor después de la repetición dirigida: ${summary.combined.outcome.provider_error || 0}.
- Tiempo de la búsqueda progresiva y sus reintentos: ${summary.elapsed_seconds_baseline.toFixed(2)} s.
- Tiempo del experimento adicional por álbum: ${(summary.album_first_experiment?.elapsed_seconds || 0).toFixed(2)} s.
- Tiempo total de investigación: ${summary.elapsed_seconds_total.toFixed(2)} s.
- Consultas efectivas al proveedor: ${summary.query_activity.provider_requests_total} (${summary.query_activity.progressive_provider_requests} progresivas y ${summary.query_activity.album_first_provider_requests} del experimento por álbum).

MusicBrainz contiene al menos un candidato compatible para el ${summary.combined.catalog_candidate_rate_pct} % de las propuestas, pero el sistema solo demuestra una identidad única en el ${summary.combined.exact_rate_pct} %. El resultado todavía no es suficiente para producción.

## Aportación de los campos y estrategias

- Título + artista principal bastaron en ${summary.combined.exact_strategy.title_primary_artist || 0} casos.
- Añadir álbum a la búsqueda progresiva resolvió otros ${summary.combined.exact_strategy.title_primary_artist_album || 0} casos.
- Navegar primero por un release group de álbum verificado recuperó ${summary.combined.exact_strategy.album_first_release_group || 0} conflictos adicionales.
- El crédito completo con «feat.» no recuperó ningún caso adicional.
- Entre las identidades exactas combinadas, el álbum propuesto coincidió con el canónico en ${summary.proposal_accuracy_on_combined_exact.album_exact}/${combinedExact.length} casos (${summary.proposal_accuracy_on_combined_exact.album_exact_pct} %).
- El año propuesto fue exacto en ${summary.proposal_accuracy_on_combined_exact.year_exact}/${yearComparable.length} casos comparables y quedó a ±1 año en ${summary.proposal_accuracy_on_combined_exact.year_within_one}/${yearComparable.length}.

## Resultado por prompt

| Prompt | Exactas iniciales | Exactas combinadas | Ambiguas | No encontradas | Artistas principales repetidos |
|---|---:|---:|---:|---:|---|
${prompts.map((prompt) => `| ${prompt.prompt_id} | ${prompt.baseline_exact} | ${prompt.exact} | ${prompt.conflict} | ${prompt.not_found} | ${prompt.repeated_primary_artists.join(", ") || "ninguno"} |`).join("\n")}

## Casos

${input.playlists.map((playlist) => `### ${playlist.prompt_id}

${markdownTable(evaluated.filter((result) => result.prompt_id === playlist.prompt_id))}
`).join("\n")}

## Conclusiones

1. El álbum es evidencia decisiva, pero no debe ser un filtro obligatorio: ayuda cuando el LLM lo acierta y bloquea la recuperación cuando lo inventa o elige otra edición.
2. El año debe utilizarse como señal de ranking tolerante, no como verdad ni filtro exacto.
3. Para consultar MusicBrainz funciona mejor el artista principal. Los invitados deben validarse después sobre el crédito canónico.
4. Los conflictos contienen candidatos reales y deben resolverse navegando por release group, tipo de release, vídeo, año y pista.
5. Los timeouts deben reintentarse: los ocho fallos transitorios desaparecieron en una repetición dirigida.
6. El backend debe validar las restricciones editoriales: PLI-002 prohibía repetir artista y el LLM repitió Radiohead y Bicep.
7. La siguiente versión del contrato debe admitir título alternativo, título nativo y tipo de lanzamiento. Son necesarios para alias, transliteraciones y versiones concretas.
`;

fs.writeFileSync(path.join(roundDir, "report.md"), report, "utf8");
process.stdout.write(`${JSON.stringify({
  summary,
  report: path.join(roundDir, "report.md")
})}\n`);
