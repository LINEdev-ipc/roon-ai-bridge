const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createServer } = require("../dist/api/server");
const { createDatabase } = require("../dist/db/database");
const { registerBridgeV2Tools } = require("../dist/bridge-v2/mcp/tools");
const { changeZoneVolume } = require("../dist/roon/roonVolumeService");
const { PlaylistService } = require("../dist/services/playlistService");

function tempConfig() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-safety-"));
  return {
    dataDir,
    port: 3000,
    portalPort: 3001,
    enablePortal: false,
    nodeEnv: "test",
    logLevel: "silent",
    roonExtensionName: "RoonIA",
    roonExtensionId: "test",
    enableBrowse: true,
    enableMcp: true,
    enableAuth: false,
    apiToken: null,
    portalAdminToken: null,
    publicBaseUrl: "http://localhost",
    oauthIssuer: "http://localhost",
    oauthApprovalPin: null,
    roonStreamingSource: "tidal"
  };
}

function logger() {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop, debug: noop };
}

function createVolumeClient(zone, calls) {
  return {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getZone: (zoneId) => (zoneId === zone.zone_id ? zone : null),
    getTransport: () => ({
      change_volume(output, mode, value, callback) {
        calls.push([output.output_id, mode, value]);
        if (mode === "absolute") output.volume.value = value;
        else output.volume.value += value;
        callback(false);
      }
    })
  };
}

function registerTools(context) {
  const tools = new Map();
  registerBridgeV2Tools({
    registerTool(name, options, handler) {
      tools.set(name, { options, handler });
    }
  }, context);
  return tools;
}

async function invoke(tool, args) {
  const result = await tool.handler(args);
  return result.structuredContent;
}

test("volume dry_run and safe-limit confirmation do not call Roon unless allowed", async () => {
  const zone = {
    zone_id: "salon-zone",
    display_name: "Salon",
    state: "paused",
    outputs: [
      {
        output_id: "salon-output",
        display_name: "Salon",
        volume: { type: "number", min: 0, max: 60, hard_limit_max: 60, value: 30 }
      }
    ]
  };
  const calls = [];
  const client = createVolumeClient(zone, calls);

  const dryRun = await changeZoneVolume(client, "salon-zone", "relative", -1, {
    dryRun: true
  });
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.dry_run, true);
  assert.deepEqual(calls, []);
  assert.equal(zone.outputs[0].volume.value, 30);

  const withinLimit = await changeZoneVolume(client, "salon-zone", "relative", 1);
  assert.equal(withinLimit.ok, true);
  assert.equal(withinLimit.volume_policy.requires_confirmation, false);
  assert.equal(zone.outputs[0].volume.value, 31);

  const blocked = await changeZoneVolume(client, "salon-zone", "absolute", 40);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.requires_confirmation, true);
  assert.equal(blocked.confirmation_reason, "volume_above_safe_limit");
  assert.equal(blocked.confirm_payload.arguments.confirm, true);
  assert.equal(zone.outputs[0].volume.value, 31);

  const confirmed = await changeZoneVolume(client, "salon-zone", "absolute", 40, {
    confirm: true
  });
  assert.equal(confirmed.ok, true);
  assert.equal(zone.outputs[0].volume.value, 40);

  await assert.rejects(
    () => changeZoneVolume(client, "salon-zone", "absolute", 61, { confirm: true }),
    (error) => error.code === "INVALID_VOLUME_VALUE"
  );
});

test("destructive playlist MCP v2 tools require confirmation", async () => {
  const config = tempConfig();
  const database = createDatabase(config);
  const playlistService = new PlaylistService(config, database);
  const playlist = playlistService.createPlaylist({
    playlist_id: "safety-mix",
    name: "Safety Mix",
    tracks: [{ track_id: "one", query: "one", title: "One" }]
  });
  const context = {
    logger: logger(),
    roonClient: { getZone: () => null },
    playlistService,
    mediaService: {}
  };
  const tools = registerTools(context);
  const removeBlocked = await invoke(tools.get("roon_edit_playlist_tracks"), {
    playlist_id: playlist.playlist_id,
    operations: [{ type: "remove", track_id: "one" }]
  });
  assert.equal(removeBlocked.status, "confirmation_required");
  assert.equal(playlistService.getPlaylist(playlist.playlist_id).track_count, 1);

  const removed = await invoke(tools.get("roon_edit_playlist_tracks"), {
    playlist_id: playlist.playlist_id,
    operations: [{ type: "remove", track_id: "one" }],
    confirm: true
  });
  assert.equal(removed.status, "completed");
  assert.equal(removed.verified, true);
  assert.equal(playlistService.getPlaylist(playlist.playlist_id).tracks_count, 0);

  const deleteBlocked = await invoke(tools.get("roon_delete_playlist"), {
    playlist_id: playlist.playlist_id
  });
  assert.equal(deleteBlocked.status, "confirmation_required");

  const deleted = await invoke(tools.get("roon_delete_playlist"), {
    playlist_id: playlist.playlist_id,
    confirm: true
  });
  assert.equal(deleted.status, "completed");
  assert.equal(deleted.verified, true);
  assert.throws(
    () => playlistService.getPlaylist(playlist.playlist_id),
    (error) => error.code === "PLAYLIST_NOT_FOUND"
  );

  database.close();
});

test("/safety/policy exposes portal-consumable classifications and volume limits", async () => {
  const config = tempConfig();
  const database = createDatabase(config);
  const context = {
    config,
    logger: logger(),
    roonClient: {
      getZones: () => [],
      isCoreConnected: () => false,
      getCoreName: () => null,
      isTransportReady: () => false,
      isBrowseReady: () => false,
      isImageReady: () => false,
      getOutputs: () => []
    },
    playlistService: new PlaylistService(config, database),
    oauthService: {},
    mediaService: {},
    apiKeyService: {},
    portalAuthService: {},
    systemManagementService: {},
    zonePresetService: {},
    outputVolumeSettingsService: {}
  };
  const server = createServer(context).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/safety/policy`);
    assert.equal(response.status, 200);
    const policy = await response.json();
    assert.equal(policy.version, 1);
    assert.equal(policy.confirmation_policy.playback_requires_confirmation, false);
    assert.equal(
      policy.tool_classification.roon_delete_playlist.requires_confirmation_by_default,
      true
    );
    assert.equal(policy.tool_classification.roon_resolve_virtual_playlist, undefined);
    assert.equal(policy.tool_classification.roon_play_media.destructive, false);
    assert.ok(policy.volume_limits.some((limit) => limit.zone_name === "Cocina"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
  }
});
