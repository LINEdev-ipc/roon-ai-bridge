const fs = require("node:fs");
const path = require("node:path");

const { createApplication } = require("../../dist/app/createApplication");
const { loadConfig } = require("../../dist/config/env");

const ROOT = __dirname;
const FIXTURES = path.join(ROOT, "fixtures");
const ARTIFACTS = path.join(ROOT, "artifacts");
const DATA = path.join(ARTIFACTS, "runtime");
const STATE_FILE = path.join(ARTIFACTS, "state.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function argumentsValue(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRoon(client, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = {
      core: client.isCoreConnected(),
      transport: client.isTransportReady(),
      browse: client.isBrowseReady()
    };
    process.stdout.write(`Roon validation connection ${JSON.stringify(status)}\n`);
    if (status.core && status.browse) return status;
    await wait(5000);
  }
  throw new Error(
    "The isolated RoonIA playlist validation extension was not authorized or browse did not become ready"
  );
}

function aggregate(results) {
  const completed = results.filter((entry) => entry.status === "completed");
  const sum = (field) => completed.reduce((total, entry) =>
    total + Number(entry.result?.[field] || 0), 0);
  const performanceSum = (field) => completed.reduce((total, entry) =>
    total + Number(entry.result?.performance?.[field] || 0), 0);
  return {
    playlists_total: results.length,
    playlists_completed: completed.length,
    playlists_failed: results.filter((entry) => entry.status === "failed").length,
    desired_tracks: sum("desired_count"),
    added_tracks: sum("added_count"),
    missing_tracks: sum("missing_count"),
    candidates_started: performanceSum("candidates_started"),
    musicbrainz_requests: performanceSum("musicbrainz_requests"),
    musicbrainz_cache_hits: performanceSum("musicbrainz_cache_hits"),
    listenbrainz_requests: performanceSum("listenbrainz_requests"),
    listenbrainz_cache_hits: performanceSum("listenbrainz_cache_hits"),
    roon_searches: performanceSum("roon_searches"),
    bindings_created: performanceSum("bindings_created"),
    speculative_bindings_reused: performanceSum("speculative_bindings_reused"),
    canonical_roon_fallbacks: performanceSum("canonical_roon_fallbacks"),
    elapsed_ms: completed.reduce((total, entry) => total + Number(entry.elapsed_ms || 0), 0)
  };
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.mkdirSync(DATA, { recursive: true });
  const manifest = readJson(path.join(FIXTURES, "manifest.json"));
  const only = argumentsValue("only");
  const selected = only
    ? manifest.playlists.filter((playlist) => playlist.prompt_id === only)
    : manifest.playlists;
  if (!selected.length) throw new Error(`Unknown prompt id: ${only}`);

  const state = fs.existsSync(STATE_FILE)
    ? readJson(STATE_FILE)
    : {
        version: "0.20.0-beta.10",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        extension: {
          id: "com.local.roon-ai-bridge.validation-beta9",
          name: "RoonIA Beta 9 Validation"
        },
        results: []
      };
  state.version = "0.20.0-beta.10";
  const base = loadConfig();
  const config = {
    ...base,
    dataDir: DATA,
    enablePortal: false,
    enableMcp: false,
    enableBrowse: true,
    enableAuth: false,
    apiToken: null,
    portalAdminToken: null,
    automaticUpdateChecks: false,
    roonExtensionId: state.extension.id,
    roonExtensionName: state.extension.name
  };
  const runtime = createApplication(config);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    runtime.shutdown();
  };
  process.once("SIGINT", () => {
    close();
    process.exitCode = 130;
  });
  process.once("SIGTERM", () => {
    close();
    process.exitCode = 143;
  });

  try {
    runtime.context.roonClient.start();
    const roonTimeoutMs = Number(argumentsValue("roon-timeout-ms") || 180_000);
    await waitForRoon(
      runtime.context.roonClient,
      Number.isFinite(roonTimeoutMs) && roonTimeoutMs >= 10_000
        ? roonTimeoutMs
        : 180_000
    );
    if (process.argv.includes("--probe")) {
      state.updated_at = new Date().toISOString();
      state.roon_probe = {
        completed_at: state.updated_at,
        core_name: runtime.context.roonClient.getCoreName(),
        browse_ready: runtime.context.roonClient.isBrowseReady()
      };
      writeJson(STATE_FILE, state);
      process.stdout.write("Roon validation probe completed\n");
      return;
    }

    for (const item of selected) {
      const previous = state.results.find((entry) =>
        entry.prompt_id === item.prompt_id && entry.status === "completed"
      );
      if (previous && !process.argv.includes("--force")) {
        process.stdout.write(`Skipping completed ${item.prompt_id}\n`);
        continue;
      }
      const fixture = readJson(path.join(FIXTURES, item.file));
      const startedAt = Date.now();
      state.current = {
        prompt_id: item.prompt_id,
        prompt: item.prompt,
        started_at: new Date(startedAt).toISOString()
      };
      state.updated_at = new Date().toISOString();
      writeJson(STATE_FILE, state);
      process.stdout.write(
        `Starting ${item.prompt_id}: ${item.prompt} (${item.candidate_count} candidates)\n`
      );
      try {
        const result = await runtime.context.playlistBuildService.build({
          ...fixture.arguments,
          diagnostics: true,
          enqueue_metadata_enrichment: false
        });
        const record = {
          prompt_id: item.prompt_id,
          prompt: item.prompt,
          status: "completed",
          started_at: new Date(startedAt).toISOString(),
          completed_at: new Date().toISOString(),
          elapsed_ms: Date.now() - startedAt,
          result
        };
        state.results = state.results.filter((entry) => entry.prompt_id !== item.prompt_id);
        state.results.push(record);
        writeJson(path.join(ARTIFACTS, `${item.prompt_id}-result.json`), record);
        process.stdout.write(
          `Completed ${item.prompt_id}: ${result.added_count}/${result.desired_count} ` +
          `in ${record.elapsed_ms} ms; ${result.performance.bindings_created} bindings\n`
        );
      } catch (error) {
        const record = {
          prompt_id: item.prompt_id,
          prompt: item.prompt,
          status: "failed",
          started_at: new Date(startedAt).toISOString(),
          completed_at: new Date().toISOString(),
          elapsed_ms: Date.now() - startedAt,
          error: {
            code: error?.code || "VALIDATION_ERROR",
            message: error instanceof Error ? error.message : String(error),
            details: error?.details || {}
          }
        };
        state.results = state.results.filter((entry) => entry.prompt_id !== item.prompt_id);
        state.results.push(record);
        writeJson(path.join(ARTIFACTS, `${item.prompt_id}-result.json`), record);
        process.stdout.write(`Failed ${item.prompt_id}: ${record.error.message}\n`);
      }
      delete state.current;
      state.updated_at = new Date().toISOString();
      state.summary = aggregate(state.results);
      writeJson(STATE_FILE, state);
    }
  } finally {
    close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
