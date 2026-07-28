const fs = require("node:fs");
const path = require("node:path");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function countBy(values, accessor) {
  return Object.fromEntries(Array.from(values.reduce((counts, value) => {
    const key = accessor(value) || "none";
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map())).sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
}

function percentage(part, total) {
  return Math.round(10000 * part / Math.max(1, total)) / 100;
}

function finalAssessment(result, reviews) {
  if (result.classification === "reference_agreement") {
    return {
      assessment: "reference_agreement",
      reason: "ListenBrainz returned the same recording MBID as the previous MusicBrainz resolution."
    };
  }
  if (result.classification === "not_found") {
    return {
      assessment: "no_result",
      reason: "Neither ListenBrainz lookup returned a recording MBID."
    };
  }
  if (result.classification === "provider_error") {
    return { assessment: "provider_error", reason: result.error || "Provider error." };
  }
  const review = reviews.get(result.candidate_id);
  if (!review) throw new Error(`Missing manual review for ${result.candidate_id}`);
  return {
    assessment: `manual_${review.decision}`,
    reason: review.reason,
    baseline_issue: review.baseline_issue || null
  };
}

function table(rows) {
  return [
    "| ID | Propuesta | Anterior | ListenBrainz | Revisión |",
    "|---|---|---|---|---|",
    ...rows.map((row) =>
      `| ${row.candidate_id} | ${row.proposal.title.replace(/\|/g, "\\|")} — ${row.proposal.primary_artist.replace(/\|/g, "\\|")} | ${row.previous_outcome} | ${row.selected.status} | ${row.final_assessment} |`
    )
  ].join("\n");
}

const inputPath = path.resolve(process.argv[2] || "");
if (!inputPath || !fs.existsSync(inputPath)) {
  throw new Error("Pass an existing round input.json path.");
}

const roundDir = path.dirname(inputPath);
const results = readJsonl(path.join(roundDir, "listenbrainz-results.jsonl"));
const execution = readJson(path.join(roundDir, "listenbrainz-summary.json"));
const previous = readJson(path.join(roundDir, "summary.json"));
const reviewDocument = readJson(path.join(roundDir, "listenbrainz-manual-review.json"));
const reviews = new Map(reviewDocument.decisions.map((decision) => [decision.candidate_id, decision]));

const evaluated = results.map((result) => {
  const final = finalAssessment(result, reviews);
  return {
    ...result,
    final_assessment: final.assessment,
    final_reason: final.reason,
    baseline_issue: final.baseline_issue || null
  };
});

const nonTrivialIds = evaluated
  .filter((result) => !["reference_agreement", "not_found", "provider_error"].includes(result.classification))
  .map((result) => result.candidate_id);
const unusedReviews = reviewDocument.decisions
  .filter((decision) => !nonTrivialIds.includes(decision.candidate_id))
  .map((decision) => decision.candidate_id);
if (unusedReviews.length) {
  throw new Error(`Manual reviews without a non-trivial result: ${unusedReviews.join(", ")}`);
}

const exactRows = evaluated.filter((result) => result.previous_outcome === "exact");
const conflictRows = evaluated.filter((result) => result.previous_outcome === "conflict");
const missingRows = evaluated.filter((result) => result.previous_outcome === "not_found");
const exactAgreements = exactRows.filter((result) => result.final_assessment === "reference_agreement");
const acceptedRecoveries = evaluated.filter((result) =>
  result.previous_outcome !== "exact" && result.final_assessment === "manual_accept"
);

const summary = {
  schema_version: 2,
  round_id: execution.round_id,
  candidates: evaluated.length,
  elapsed_seconds: execution.elapsed_seconds,
  speedup_vs_progressive_baseline: Math.round(
    100 * previous.elapsed_seconds_baseline / execution.elapsed_seconds
  ) / 100,
  provider_requests: {
    listenbrainz: execution.listenbrainz.provider_requests,
    musicbrainz_verification: execution.musicbrainz_verification.provider_requests,
    total: execution.listenbrainz.provider_requests + execution.musicbrainz_verification.provider_requests
  },
  mapping_status: execution.mapping_status,
  final_assessment: countBy(evaluated, (result) => result.final_assessment),
  prior_exact: {
    total: exactRows.length,
    same_mbid: exactAgreements.length,
    same_mbid_pct: percentage(exactAgreements.length, exactRows.length),
    different_mbid: exactRows.filter((result) => result.final_assessment === "manual_reject").length,
    no_result: exactRows.filter((result) => result.final_assessment === "no_result").length
  },
  prior_conflict: {
    total: conflictRows.length,
    returned_candidate: conflictRows.filter((result) => result.selected.recording_mbid).length,
    accepted_after_review: conflictRows.filter((result) => result.final_assessment === "manual_accept").length,
    requires_review: conflictRows.filter((result) => result.final_assessment === "manual_review").length,
    rejected: conflictRows.filter((result) => result.final_assessment === "manual_reject").length,
    no_result: conflictRows.filter((result) => result.final_assessment === "no_result").length
  },
  prior_not_found: {
    total: missingRows.length,
    returned_candidate: missingRows.filter((result) => result.selected.recording_mbid).length,
    accepted_after_review: missingRows.filter((result) => result.final_assessment === "manual_accept").length,
    requires_review: missingRows.filter((result) => result.final_assessment === "manual_review").length,
    rejected: missingRows.filter((result) => result.final_assessment === "manual_reject").length,
    no_result: missingRows.filter((result) => result.final_assessment === "no_result").length
  },
  accepted_recoveries: acceptedRecoveries.map((result) => ({
    candidate_id: result.candidate_id,
    title: result.proposal.title,
    artist: result.proposal.primary_artist,
    recording_mbid: result.selected.recording_mbid
  })),
  baseline_issues_discovered: evaluated
    .filter((result) => result.baseline_issue)
    .map((result) => ({
      candidate_id: result.candidate_id,
      issue: result.baseline_issue
    }))
};

writeJson(path.join(roundDir, "listenbrainz-evaluated-results.json"), evaluated);
writeJson(path.join(roundDir, "listenbrainz-summary.json"), {
  ...execution,
  evaluation: summary
});

const report = `# Round 001 — experimento ListenBrainz

## Resultado

- Corpus: ${summary.candidates} propuestas.
- Tiempo completo, incluyendo verificación de MBIDs en MusicBrainz: ${summary.elapsed_seconds} s.
- Mejora frente a la búsqueda progresiva original: ${summary.speedup_vs_progressive_baseline}×.
- Consultas: ${summary.provider_requests.listenbrainz} a ListenBrainz Labs y ${summary.provider_requests.musicbrainz_verification} verificaciones a MusicBrainz.
- ListenBrainz devolvió un MBID en ${evaluated.filter((result) => result.selected.recording_mbid).length}/${evaluated.length} casos.
- Acuerdo exacto con una identidad previa: ${summary.prior_exact.same_mbid}/${summary.prior_exact.total}.
- Recuperaciones nuevas aceptadas tras revisar MusicBrainz: ${acceptedRecoveries.length}.
- Casos que todavía requieren revisión humana o más evidencia: ${summary.final_assessment.manual_review || 0}.
- Candidatos rechazados por ser otra versión, vídeo, directo o fragmento de DJ mix: ${summary.final_assessment.manual_reject || 0}.
- Sin resultado de ListenBrainz: ${summary.final_assessment.no_result || 0}.

## Lectura por estado anterior

| Estado anterior | Total | Devuelve candidato | Aceptado | Revisión | Rechazado | Sin resultado |
|---|---:|---:|---:|---:|---:|---:|
| Exacta | ${summary.prior_exact.total} | ${summary.prior_exact.total - summary.prior_exact.no_result} | ${summary.prior_exact.same_mbid} acuerdos | 0 | ${summary.prior_exact.different_mbid} | ${summary.prior_exact.no_result} |
| Ambigua | ${summary.prior_conflict.total} | ${summary.prior_conflict.returned_candidate} | ${summary.prior_conflict.accepted_after_review} | ${summary.prior_conflict.requires_review} | ${summary.prior_conflict.rejected} | ${summary.prior_conflict.no_result} |
| No encontrada | ${summary.prior_not_found.total} | ${summary.prior_not_found.returned_candidate} | ${summary.prior_not_found.accepted_after_review} | ${summary.prior_not_found.requires_review} | ${summary.prior_not_found.rejected} | ${summary.prior_not_found.no_result} |

## Recuperaciones aceptadas

${acceptedRecoveries.map((result) =>
    `- ${result.proposal.title} — ${result.proposal.primary_artist}: \`${result.selected.recording_mbid}\`.`
  ).join("\n") || "- Ninguna."}

## Defecto previo descubierto

${summary.baseline_issues_discovered.map((issue) =>
    `- ${issue.candidate_id}: ${issue.issue}`
  ).join("\n") || "- Ninguno."}

## Casos revisados

${table(evaluated.filter((result) =>
    result.final_assessment.startsWith("manual_")
  ))}

## Conclusión

ListenBrainz es útil como índice rápido y como señal de ranking, pero no como
resolutor definitivo. Reduce el tiempo de esta muestra aproximadamente siete
veces y propone candidatos para casi todos los conflictos, pero no recupera
los metadatos inventados por el LLM y puede escoger una versión incorrecta con
título y artista aparentemente perfectos.

La integración recomendable es:

1. Consultar ACRR (artista+canción+álbum) y ACR (artista+canción).
2. Si discrepan, conservar el caso como ambiguo.
3. Verificar el MBID en MusicBrainz y rechazar vídeos, directos, DJ mixes y
   variantes incompatibles.
4. Validar álbum, crédito completo y nombre de versión; no basta con artista
   principal y título.
5. Usar la búsqueda progresiva actual como fallback cuando ListenBrainz no
   devuelve resultado.
`;

fs.writeFileSync(path.join(roundDir, "listenbrainz-report.md"), report, "utf8");
process.stdout.write(`${JSON.stringify({
  summary,
  report: path.join(roundDir, "listenbrainz-report.md")
})}\n`);
