const fs = require("node:fs");
const path = require("node:path");

const { createApplication } = require("../../dist/app/createApplication");
const { loadConfig } = require("../../dist/config/env");
const {
  RecordingMetadataService
} = require("../../dist/services/recordingMetadataService");
const {
  ListenBrainzMetadataService
} = require("../../dist/services/listenBrainzMetadataService");

const ROOT = __dirname;
const CASES = path.join(ROOT, "cases");
const RUNTIME_DATA = path.join(
  ROOT,
  "artifacts",
  "runtime",
  "local-roonia-data"
);
const OUTPUT = path.join(ROOT, "artifacts", "runtime");

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requiresExactCatalogRelease(candidate) {
  if (!candidate.album_hint || candidate.recording_intent === "cover") return false;
  if (["live", "acoustic"].includes(candidate.recording_intent)) return true;
  if ((candidate.recording_intent || "standard") === "standard") return false;
  return !/\b(?:live|concert|en vivo|directo|remix|mix|rework|refix|dub|acoustic|unplugged|edit|alternate|version)\b/iu
    .test(candidate.title || "");
}

async function waitForRoon(client, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (
      client.isCoreConnected() &&
      client.isTransportReady() &&
      client.isBrowseReady()
    ) {
      return;
    }
    await wait(2000);
  }
  throw new Error("The isolated Roon validation extension is not ready");
}

function compact(result, elapsedMs) {
  return {
    phase: result.phase,
    desired_count: result.desired_count,
    added_count: result.added_count,
    missing_count: result.missing_count,
    complete: result.complete,
    elapsed_ms: elapsedMs,
    search_summary: result.search_summary,
    rejection_summary: result.rejection_summary,
    performance: result.performance,
    accepted: result.accepted.map((entry) => ({
      candidate_id: entry.candidate_id,
      title: entry.title,
      album: entry.album,
      metadata_status: entry.metadata_status,
      resolution_reason: entry.resolution_reason
    })),
    rejected: result.rejected
  };
}

async function runMusicBrainzOnly(document, candidateIds = []) {
  const listenBrainz = new ListenBrainzMetadataService(fetch);
  const service = new RecordingMetadataService(fetch, {
    minRequestIntervalMs: 1100,
    listenBrainz
  });
  const selectedIds = new Set(candidateIds);
  const tracks = selectedIds.size
    ? document.arguments.tracks.filter((track) => selectedIds.has(track.candidate_id))
    : document.arguments.tracks;
  const results = new Array(tracks.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < tracks.length) {
      const index = nextIndex;
      nextIndex += 1;
      const candidate = tracks[index];
      const startedAt = Date.now();
      try {
        const artist = candidate.required_credits?.find((credit) =>
          credit.role === "primary"
        )?.name || candidate.artist_credit;
        const listenBrainzResult = await listenBrainz.lookup({
          title: candidate.title,
          artist,
          album: candidate.album_hint || null
        });
        const resolution = await service.lookup({
          title: candidate.title,
          artist,
          album_observation: candidate.album_hint || null,
          require_release_match: requiresExactCatalogRelease(candidate),
          release_year_observation: candidate.release_year_hint || null,
          version_hint: candidate.recording_intent || "standard",
          metadata_depth: "identity",
          prefer_release_tracklist: Boolean(candidate.album_hint)
        });
        results[index] = {
          candidate_id: candidate.candidate_id,
          title: candidate.title,
          album_hint: candidate.album_hint || null,
          status: resolution.status,
          reason: resolution.reason,
          recording_id: resolution.metadata?.recording_id || null,
          duration_seconds: resolution.metadata?.duration_seconds || null,
          video: resolution.metadata?.video === true,
          elapsed_ms: Date.now() - startedAt,
          provider_requests: resolution.trace.provider_requests,
          cache_hit: resolution.trace.cache_hit,
          warnings: resolution.trace.accepted_warnings,
          listenbrainz: resolution.trace.listenbrainz || null,
          listenbrainz_candidates: listenBrainzResult.candidates,
          rejected_candidates: resolution.trace.rejected_candidates,
          candidates: resolution.candidates
        };
      } catch (error) {
        results[index] = {
          candidate_id: candidate.candidate_id,
          title: candidate.title,
          album_hint: candidate.album_hint || null,
          status: "provider_error",
          reason: error instanceof Error ? error.message : String(error),
          recording_id: null,
          duration_seconds: null,
          elapsed_ms: Date.now() - startedAt,
          provider_requests: Number(error?.musicbrainz_provider_requests || 0),
          cache_hit: false,
          warnings: []
        };
      }
    }
  };
  const startedAt = Date.now();
  await Promise.all(Array.from({ length: 8 }, worker));
  return {
    phase: "musicbrainz_only",
    elapsed_ms: Date.now() - startedAt,
    candidates: results.length,
    exact: results.filter((entry) => entry.status === "exact").length,
    conflict: results.filter((entry) => entry.status === "conflict").length,
    not_found: results.filter((entry) => entry.status === "not_found").length,
    provider_error: results.filter((entry) => entry.status === "provider_error").length,
    provider_requests: results.reduce((sum, entry) =>
      sum + Number(entry.provider_requests || 0), 0),
    release_tracklist_resolutions: results.filter((entry) =>
      entry.warnings.includes("recording_recovered_from_release_tracklist")
    ).length,
    release_tracklist_cache_hits: results.filter((entry) =>
      entry.warnings.some((warning) =>
        warning === "release_tracklist_memory_cache_hit" ||
        warning === "release_tracklist_inflight_cache_hit"
      )
    ).length,
    results
  };
}

async function main() {
  const caseFile = argument("case", "R01-rolling-stones.json");
  const label = argument("label", `${path.basename(caseFile, ".json")}-${Date.now()}`);
  const dataDir = path.resolve(argument("data-dir", RUNTIME_DATA));
  const timeoutMs = Number(argument("roon-timeout-ms", "180000"));
  const document = JSON.parse(fs.readFileSync(path.join(CASES, caseFile), "utf8"));
  const trackIndexes = String(argument("track-indexes", ""))
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1);
  if (trackIndexes.length) {
    document.arguments.tracks = trackIndexes.map((index) => {
      const track = document.arguments.tracks[index - 1];
      if (!track) throw new Error(`Track index ${index} is outside ${caseFile}`);
      return track;
    });
    document.arguments.desired_count = document.arguments.tracks.length;
  }
  if (document.status !== "frozen_before_execution") {
    throw new Error(`Validation case ${document.case_id} is not frozen`);
  }
  if (process.argv.includes("--musicbrainz-only")) {
    const candidateIds = String(argument("candidate-ids", ""))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const result = await runMusicBrainzOnly(document, candidateIds);
    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT, `${label}.json`),
      `${JSON.stringify({
        case_id: document.case_id,
        label,
        input_file: caseFile,
        completed_at: new Date().toISOString(),
        result
      }, null, 2)}\n`,
      "utf8"
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  const base = loadConfig();
  const runtime = createApplication({
    ...base,
    dataDir,
    enablePortal: false,
    enableMcp: false,
    enableBrowse: true,
    enableAuth: false,
    apiToken: null,
    portalAdminToken: null,
    automaticUpdateChecks: false,
    roonExtensionId: "com.local.roon-ai-bridge.validation",
    roonExtensionName: "RoonIA Local Validation"
  });
  try {
    runtime.context.roonClient.start();
    await waitForRoon(runtime.context.roonClient, timeoutMs);
    const startedAt = Date.now();
    let result;
    try {
      result = await runtime.context.playlistBuildService.build({
        ...document.arguments,
        diagnostics: true
      });
    } catch (error) {
      if (!process.argv.includes("--allow-empty")) throw error;
      const failure = {
        case_id: document.case_id,
        label,
        input_file: caseFile,
        started_at: new Date(startedAt).toISOString(),
        completed_at: new Date().toISOString(),
        error: {
          code: error?.code || "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
          details: error?.details || {}
        }
      };
      fs.mkdirSync(OUTPUT, { recursive: true });
      fs.writeFileSync(
        path.join(OUTPUT, `${label}.json`),
        `${JSON.stringify(failure, null, 2)}\n`,
        "utf8"
      );
      process.stdout.write(`${JSON.stringify(failure.error)}\n`);
      return;
    }
    const record = {
      case_id: document.case_id,
      label,
      input_file: caseFile,
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date().toISOString(),
      result
    };
    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT, `${label}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8"
    );
    process.stdout.write(`${JSON.stringify(compact(result, Date.now() - startedAt))}\n`);
  } finally {
    runtime.shutdown();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
