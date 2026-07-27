const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createServer } = require("../dist/api/server");
const { createDatabase } = require("../dist/db/database");
const { PlaylistService } = require("../dist/services/playlistService");
const { VolumeLimitService } = require("../dist/services/volumeLimitService");
const { ActionLogService } = require("../dist/services/actionLogService");
const { TechnicalLogService } = require("../dist/services/technicalLogService");
const { ExtensionManagerService } = require("../dist/services/extensionManagerService");
const { DiagnosticsService } = require("../dist/services/diagnosticsService");

function createConfig(dataDir) {
  return {
    port: 3000,
    portalPort: 3001,
    enablePortal: false,
    nodeEnv: "test",
    logLevel: "error",
    roonExtensionName: "Test",
    roonExtensionId: "test",
    dataDir,
    enableBrowse: true,
    enableMcp: true,
    enableAuth: false,
    apiToken: null,
    portalAdminToken: null,
    publicBaseUrl: "https://example.test",
    oauthIssuer: "https://example.test",
    oauthApprovalPin: null,
    roonStreamingSource: "tidal"
  };
}

function createContext(dataDir) {
  const config = createConfig(dataDir);
  const database = createDatabase(config);
  const actionLogService = new ActionLogService(database);
  const technicalLogService = new TechnicalLogService(database);
  const extensionManagerService = new ExtensionManagerService(config, technicalLogService);
  const noop = () => {};
  const roonClient = {
    getZones: () => [],
    isCoreConnected: () => false,
    getCoreName: () => null,
    isTransportReady: () => false,
    isBrowseReady: () => false,
    isImageReady: () => false,
    getOutputs: () => []
  };
  const context = {
    config,
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    roonClient,
    playlistService: new PlaylistService(config, database),
    oauthService: {},
    mediaService: {},
    apiKeyService: {},
    portalAuthService: {},
    systemManagementService: {},
    zonePresetService: {},
    outputVolumeSettingsService: {},
    volumeLimitService: new VolumeLimitService(config, database),
    actionLogService,
    technicalLogService,
    extensionManagerService
  };
  context.diagnosticsService = new DiagnosticsService(
    config,
    database,
    roonClient,
    actionLogService,
    technicalLogService,
    extensionManagerService,
    context
  );
  return { context, database };
}

test("observability endpoints expose safe diagnostics, manifest and extension status", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-observability-"));
  const { context, database } = createContext(dataDir);
  context.technicalLogService.record("http", "error", "API_TOKEN=super-secret failed", {
    authorization: "Bearer top-secret"
  });

  const server = createServer(context).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "healthy");

    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json()).checks.database, true);

    const manifest = await (await fetch(`${baseUrl}/tools/manifest`)).json();
    const names = new Set(manifest.tools.map((tool) => tool.name));
    assert.ok(names.has("roon_run_diagnostics"));
    assert.ok(names.has("roon_play_media"));
    assert.equal(names.has("roon_status"), false);
    assert.equal(names.has("roon_extension_manager_status"), false);
    assert.ok(manifest.tools.every((tool) => tool.schema_hash));

    const extensions = await (await fetch(`${baseUrl}/extensions`)).json();
    assert.equal(extensions.extensions[0].extension_id, "roonia");

    const restart = await fetch(`${baseUrl}/extensions/roonia/restart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal((await restart.json()).requires_confirmation, true);

    const bundle = await (await fetch(`${baseUrl}/diagnostics/bundle`)).json();
    const serialized = JSON.stringify(bundle);
    assert.match(serialized, /REDACTED/);
    assert.doesNotMatch(serialized, /super-secret|top-secret/);
    assert.equal(bundle.app.version, "0.20.0-beta.6");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("action log sanitizes arguments and clear requires confirmation", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-actions-"));
  const config = createConfig(dataDir);
  const database = createDatabase(config);
  const actions = new ActionLogService(database);

  try {
    const entry = actions.record({
      source: "mcp",
      toolOrEndpoint: "roon_status",
      arguments: { api_token: "secret-token", pin: "approval-pin", harmless: "visible" },
      result: { ok: true },
      durationMs: 4
    });
    const fetched = actions.get(entry.action_id);
    assert.equal(fetched.arguments_sanitized.api_token, "[REDACTED]");
    assert.equal(fetched.arguments_sanitized.pin, "[REDACTED]");
    assert.equal(fetched.arguments_sanitized.harmless, "visible");
    assert.equal(actions.clear(false).requires_confirmation, true);
    assert.equal(actions.clear(true).ok, true);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
