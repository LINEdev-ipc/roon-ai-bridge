const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createServer } = require("../dist/api/server");
const { registerBridgeV2Tools } = require("../dist/bridge-v2/mcp/tools");
const { BRIDGE_V2_INSTRUCTIONS } = require("../dist/bridge-v2/mcp/server");
const { registerWidgetV2Tools } = require("../dist/bridge-v2/widgets/tools");
const { createDatabase } = require("../dist/db/database");
const { PlaylistService } = require("../dist/services/playlistService");
const { PlaylistBuildService } = require("../dist/services/playlistBuildService");
const { PlaylistMetadataEnrichmentService } = require("../dist/services/playlistMetadataEnrichmentService");
const { PlaylistRepairService } = require("../dist/services/playlistRepairService");
const { VolumeLimitService } = require("../dist/services/volumeLimitService");
const { ZonePresetService } = require("../dist/services/zonePresetService");
const { TOOL_CLASSIFICATION } = require("../dist/safety/actionSafety");

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

function createContext(config, database) {
  const noop = () => {};
  const playlistService = new PlaylistService(config, database);
  const mediaService = {
    async search(request) {
      return {
        query: request.query,
        results: [],
        recommended_result_id: null,
        selection_required: false,
        warnings: []
      };
    }
  };
  const playlistMetadataEnrichmentService = new PlaylistMetadataEnrichmentService(
    playlistService,
    mediaService
  );
  const context = {
    config,
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    roonClient: {
      getZones: () => [],
      getOutputs: () => [],
      getKnownOutputs: () => [],
      getZone: () => null,
      getOutput: () => null,
      isCoreConnected: () => false,
      getCoreName: () => null,
      isTransportReady: () => false,
      isBrowseReady: () => false,
      isImageReady: () => false
    },
    playlistService,
    mediaService,
    playlistMetadataEnrichmentService,
    playlistBuildService: new PlaylistBuildService(
      playlistService,
      mediaService,
      undefined,
      "streaming_first",
      playlistMetadataEnrichmentService
    ),
    playlistRepairService: new PlaylistRepairService(
      playlistService,
      mediaService,
      playlistMetadataEnrichmentService
    ),
    zonePresetService: new ZonePresetService(config, database),
    volumeLimitService: new VolumeLimitService(config, database),
    oauthService: {},
    apiKeyService: {},
    portalAuthService: {},
    systemManagementService: {},
    outputVolumeSettingsService: {}
  };
  return context;
}

async function readMcpJson(response) {
  const text = await response.text();
  if ((response.headers.get("content-type") || "").includes("text/event-stream")) {
    const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data: "));
    assert.ok(dataLine, `Expected SSE data line, got: ${text}`);
    return JSON.parse(dataLine.slice("data: ".length));
  }
  return JSON.parse(text);
}

test("MCP instructions make named playlists permanent and reserve temporary lists for immediate playback", () => {
  const opening = BRIDGE_V2_INSTRUCTIONS.slice(0, 512);
  assert.match(opening, /permanent visible playlist/);
  assert.match(opening, /roon_save_playlist/);
  assert.match(opening, /roon_create_temporary_playlist/);
  assert.match(opening, /roon_play_playlist/);
  assert.match(opening, /immediate-playback/);
  assert.match(BRIDGE_V2_INSTRUCTIONS, /call the creation tool once/);
  assert.match(BRIDGE_V2_INSTRUCTIONS, /Do not call roon_search_media first/);
  assert.match(BRIDGE_V2_INSTRUCTIONS, /roon_prepare_playlist_cover before image generation/);
  assert.match(BRIDGE_V2_INSTRUCTIONS, /roon_set_playlist_cover/);
  assert.match(BRIDGE_V2_INSTRUCTIONS, /image_file/);
  assert.match(BRIDGE_V2_INSTRUCTIONS, /never pass an internal sandbox path/i);
  assert.match(BRIDGE_V2_INSTRUCTIONS, /page roon_get_media_entity until pagination\.has_more=false/);
  assert.match(BRIDGE_V2_INSTRUCTIONS, /read the target with roon_get_playlist/);
});

test("registers the compact MCP v2 intent catalog", () => {
  const tools = new Map();
  const server = {
    registerTool(name, options, handler) {
      tools.set(name, { options, handler });
    }
  };
  const context = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    roonClient: {},
    volumeLimitService: {}
  };

  registerBridgeV2Tools(server, context);

  assert.equal(tools.size, 35);
  for (const [name, registration] of tools) {
    assert.match(registration.options.description, /^Use this when/);
    assert.ok(registration.options.outputSchema.status, `${name} should declare status output`);
    if (name === "roon_set_playlist_cover") {
      assert.deepEqual(registration.options._meta, { "openai/fileParams": ["image_file"] });
    } else {
      assert.equal(registration.options._meta, undefined, `${name} must not attach widget or file metadata`);
    }
  }
  for (const name of [
    "roon_get_state",
    "roon_control_playback",
    "roon_search_media",
    "roon_get_media_entity",
    "roon_play_media",
    "roon_enqueue_media",
    "roon_list_temporary_playlists",
    "roon_create_temporary_playlist",
    "roon_promote_temporary_playlist",
    "roon_edit_playlist_tracks",
    "roon_prepare_playlist_cover",
    "roon_set_playlist_cover",
    "roon_play_playlist_track",
    "roon_rebuild_playlist",
    "roon_get_configuration",
    "roon_run_diagnostics"
  ]) assert.ok(tools.has(name), `${name} should be exposed`);
  assert.equal(tools.has("roon_resolve_playlist"), false);
  assert.equal(tools.has("roon_refresh_playlist_metadata"), false);
  assert.equal(tools.get("roon_edit_playlist_tracks").options.annotations.destructiveHint, true);
  assert.equal(tools.get("roon_import_playlist").options.annotations.destructiveHint, true);
  assert.match(tools.get("roon_set_playlist_cover").options.description, /1024x1024 square sRGB source/);
  assert.match(tools.get("roon_prepare_playlist_cover").options.description, /before image generation/);

  for (const legacy of ["roon_status", "roon_list_zones", "roon_play_by_query", "roon_get_now_playing_widget"])
    assert.equal(tools.has(legacy), false, `${legacy} should not be exposed`);
});

test("read-only MCP credentials expose query tools and the six read-only widgets", () => {
  const tools = new Map();
  const server = { registerTool(name, options) { tools.set(name, options); } };
  const context = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    roonClient: {},
    volumeLimitService: {},
    activeApiKey: { role: "read", tool_permissions: null }
  };

  registerBridgeV2Tools(server, context);
  registerWidgetV2Tools(server, context);

  assert.ok(tools.has("roon_get_state"));
  assert.ok(tools.has("roon_search_media"));
  assert.ok(tools.has("roon_prepare_playlist_cover"));
  assert.ok(tools.has("roon_list_temporary_playlists"));
  assert.equal(tools.has("roon_control_playback"), false);
  assert.equal(tools.has("roon_set_playlist_cover"), false);
  assert.equal(tools.has("roon_play_media"), false);
  assert.ok(tools.has("roon_show_now_playing"));
  assert.ok(tools.has("roon_show_zones"));
  assert.ok(tools.has("roon_show_queue"));
  assert.ok(tools.has("roon_show_media"));
  assert.ok(tools.has("roon_show_playlist"));
  assert.ok(tools.has("roon_show_playlist_library"));
  assert.equal(tools.has("roon_open_player"), false);
  assert.equal(tools.has("roon_ui_action"), false);
  assert.equal(tools.has("roon_ui_navigate"), false);
  for (const tool of tools.values()) assert.equal(tool.annotations.readOnlyHint, true);
});

test("HTTP MCP tools/list exposes v2 intents plus six focused read-only render tools", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-mcp-v2-"));
  const config = createConfig(dataDir);
  const database = createDatabase(config);
  const context = createContext(config, database);
  const server = createServer(context).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });
    assert.equal(response.status, 200);
    const payload = await readMcpJson(response);
    const tools = new Map(payload.result.tools.map((tool) => [tool.name, tool]));

    assert.equal(tools.size, 41);
    assert.deepEqual(
      Object.keys(TOOL_CLASSIFICATION).sort(),
      [...tools.keys()].sort(),
      "the safety catalog must contain only the active MCP tools"
    );
    assert.ok(tools.get("roon_get_state").inputSchema.properties.scope);
    assert.ok(tools.get("roon_play_media").inputSchema.properties.zone);
    assert.ok(tools.get("roon_play_media").inputSchema.properties.media);
    assert.ok(tools.get("roon_get_media_entity").outputSchema.properties.status);
    assert.ok(tools.get("roon_get_media_entity").inputSchema.properties.offset);
    assert.match(tools.get("roon_get_media_entity").description, /pagination\.has_more=false/);
    assert.ok(tools.get("roon_set_playlist_cover").inputSchema.properties.image_base64);
    const coverTool = tools.get("roon_set_playlist_cover");
    assert.deepEqual(coverTool._meta["openai/fileParams"], ["image_file"]);
    assert.deepEqual(coverTool.inputSchema.properties.image_file.required, ["download_url", "file_id"]);
    assert.ok(coverTool.inputSchema.properties.image_file.properties.mime_type);
    assert.ok(coverTool.inputSchema.properties.image_file.properties.file_name);
    assert.ok(tools.get("roon_prepare_playlist_cover").inputSchema.properties.playlist);
    const savePlaylist = tools.get("roon_save_playlist");
    const temporaryPlaylist = tools.get("roon_create_temporary_playlist");
    assert.ok(temporaryPlaylist.inputSchema.properties.intent);
    assert.ok(temporaryPlaylist.inputSchema.properties.desired_count);
    assert.match(temporaryPlaylist.description, /activity, mood or occasion/i);
    assert.equal(savePlaylist.inputSchema.properties.build_id, undefined);
    assert.ok(savePlaylist.inputSchema.properties.desired_count);
    assert.ok(savePlaylist.inputSchema.properties.selection_complexity);
    assert.ok(savePlaylist.inputSchema.properties.no_adjacent_same_artist);
    assert.ok(savePlaylist.inputSchema.properties.tracks.items.properties.artist_credit);
    assert.ok(savePlaylist.inputSchema.properties.tracks.items.properties.album_hint);
    assert.ok(savePlaylist.inputSchema.properties.tracks.items.properties.release_year_hint);
    assert.ok(savePlaylist.inputSchema.properties.tracks.items.properties.recording_intent);
    assert.ok(savePlaylist.inputSchema.properties.tracks.items.properties.required_credits);
    assert.match(savePlaylist.description, /call this tool once/i);
    assert.match(savePlaylist.description, /125%/);
    assert.match(savePlaylist.description, /160%/);
    assert.match(savePlaylist.description, /200%/);
    assert.match(savePlaylist.description, /video-only releases are ineligible/i);
    assert.ok(savePlaylist.inputSchema.properties.release_year_from);
    assert.ok(savePlaylist.inputSchema.properties.release_year_to);
    assert.match(
      savePlaylist.inputSchema.properties.tracks.items.properties.recording_intent.description,
      /never genre/i
    );
    const rebuildPlaylist = tools.get("roon_rebuild_playlist");
    assert.ok(rebuildPlaylist.inputSchema.properties.job_id);
    assert.ok(rebuildPlaylist.outputSchema.properties.status.enum.includes("in_progress"));
    assert.match(savePlaylist.description, /saves a verified partial playlist/i);
    assert.match(coverTool.description, /images below 768x768 are rejected/);
    assert.match(coverTool.inputSchema.properties.image_file.description, /preferred input/);
    const renderTools = [
      "roon_show_now_playing",
      "roon_show_zones",
      "roon_show_queue",
      "roon_show_media",
      "roon_show_playlist",
      "roon_show_playlist_library"
    ];
    for (const [name, tool] of tools) {
      if (renderTools.includes(name)) {
        assert.match(tool._meta["openai/outputTemplate"], /^ui:\/\/roon-ai-bridge\/v20\//);
        assert.deepEqual(tool._meta.ui.visibility, ["model", "app"]);
      } else {
        assert.equal(tool._meta?.["openai/outputTemplate"], undefined);
      }
      assert.match(tool.description, /^Use this when/);
    }
    assert.equal(tools.has("roon_status"), false);
    assert.equal(tools.has("roon_get_media_search_widget"), false);
    for (const name of renderTools) {
      assert.equal(tools.get(name).annotations.readOnlyHint, true);
      assert.equal(tools.get(name)._meta["openai/widgetAccessible"], undefined);
    }
    for (const removed of [
      "roon_open_player",
      "roon_open_media_explorer",
      "roon_open_library",
      "roon_ui_navigate",
      "roon_ui_action"
    ]) assert.equal(tools.has(removed), false);

    const callTool = async (id, args) => {
      const toolResponse = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "roon_save_playlist", arguments: args }
        })
      });
      assert.equal(toolResponse.status, 200);
      return (await readMcpJson(toolResponse)).result.structuredContent;
    };
    const finalBuild = await callTool(2, {
      name: "HTTP one-shot build",
      desired_count: 1,
      tracks: [{ title: "Unavailable One", artist_credit: "Unknown Artist" }]
    });
    assert.equal(finalBuild.status, "failed");
    assert.equal(finalBuild.error.code, "PLAYLIST_BUILD_INCOMPLETE");
    assert.equal(finalBuild.references.build_id, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
  }
});
