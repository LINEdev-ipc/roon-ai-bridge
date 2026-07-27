import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BridgeV2Context } from "../context";
import { failed, OperationResult } from "../contracts";
import { IntentGateway } from "../intentGateway";

const readOnly = { readOnlyHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

const outputSchema = {
  status: z.enum(["completed", "needs_input", "ambiguous", "confirmation_required", "not_available", "failed"]),
  operation: z.string(),
  summary: z.string(),
  verified: z.boolean(),
  data: z.unknown(),
  references: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown())
  }).optional()
};

const targetSchema = z.object({
  id: z.string().min(1).optional().describe("Stable Roon ID when already known."),
  name: z.string().min(1).optional().describe("Exact human-readable zone or output name.")
}).refine((value) => Boolean(value.id || value.name), "id or name is required");

const mediaType = z.enum(["track", "album", "artist", "playlist"]);
const sourcePreference = z.enum(["highest_quality", "streaming_first", "library_first"]);
const openAiFile = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_name: z.string().optional()
});
const mediaSelector = z.object({
  result_id: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  type: mediaType.optional(),
  source_preference: sourcePreference.optional()
}).refine((value) => Boolean(value.result_id || value.query), "result_id or query is required");
const looseObject = z.object({}).catchall(z.unknown());
const requiredCredit = z.object({
  name: z.string().min(1),
  role: z.enum(["primary", "featured", "performer", "soloist", "conductor", "orchestra", "ensemble", "composer"]).default("primary")
});
const playlistBuildCandidate = z.object({
  candidate_id: z.string().min(1).optional(),
  role: z.enum(["primary", "reserve"]).default("primary"),
  result_id: z.string().min(1).optional().describe("Optional temporary search reference. It never bypasses title, credits or recording-version validation."),
  title: z.string().min(1),
  artist_credit: z.string().min(1),
  required_credits: z.array(requiredCredit).min(1).max(12).optional(),
  album_hint: z.string().min(1).optional().describe("Include only when confidently known and useful for identifying the recording. It is normally a ranking hint, not initial query text."),
  release_year_hint: z.number().int().min(1000).max(3000).optional().describe("Include only when confidently known. It is a validation/ranking hint, not normal initial query text."),
  recording_intent: z.enum(["standard", "live", "remix", "cover", "dub", "acoustic", "alternate"]).default("standard"),
  performance_sensitive: z.boolean().default(false).describe("Set true for jazz, classical or another selection where a particular performance matters."),
  user_metadata: looseObject.optional()
});
const playlistTrackChanges = z.object({
  result_id: z.string().min(1).optional().describe("Use a playable track result_id to repair this entry with an exact manual match."),
  query: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  artist: z.string().min(1).optional(),
  album: z.string().min(1).optional(),
  user_metadata: looseObject.optional()
}).catchall(z.unknown());
const playlistOperation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), track: playlistBuildCandidate }),
  z.object({ type: z.literal("update"), track_id: z.string().min(1), changes: playlistTrackChanges }),
  z.object({ type: z.literal("remove"), track_id: z.string().min(1) }),
  z.object({ type: z.literal("reorder"), track_ids: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal("replace"), tracks: z.array(playlistBuildCandidate).max(750) })
]);

type ToolOptions = {
  title: string;
  description: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
  annotations: Record<string, boolean>;
  _meta?: Record<string, unknown>;
};

export function registerBridgeV2Tools(server: McpServer, context: BridgeV2Context): void {
  const gateway = new IntentGateway(context);

  const register = (
    name: string,
    options: ToolOptions,
    handler: (input: any) => Promise<OperationResult> | OperationResult
  ): void => {
    if (
      !context.manifestMode &&
      context.activeApiKey?.role === "read" &&
      options.annotations.readOnlyHint !== true
    ) return;
    if (
      !context.manifestMode &&
      context.toolAccessService &&
      !context.toolAccessService.canUse(name, context.activeApiKey)
    ) return;
    server.registerTool(name, {
      ...options,
      outputSchema
    } as any, async (input: any) => {
      const started = Date.now();
      let result: OperationResult;
      try {
        context.logger.info("MCP v2 intent started", { tool: name });
        result = await handler(input || {});
      } catch (error) {
        result = failed(name, error);
        context.logger.warn("MCP v2 intent failed", { tool: name, error: result.error });
      }
      context.actionLogService?.record({
        source: "mcp",
        toolOrEndpoint: name,
        classification: {
          read_only: options.annotations.readOnlyHint === true,
          mutation: options.annotations.readOnlyHint !== true,
          destructive: options.annotations.destructiveHint === true
        },
        arguments: input,
        result,
        durationMs: Date.now() - started,
        requiresConfirmation: result.status === "confirmation_required",
        confirmed: Boolean(input?.confirm),
        warnings: result.warnings,
        errorCode: result.error?.code
      });
      return {
        structuredContent: result as any,
        content: [{ type: "text" as const, text: result.summary }],
        isError: result.status === "failed"
      };
    });
  };

  register("roon_get_state", {
    title: "Get Roon State",
    description: "Use this when programmatic Roon system, zone or output state is needed for diagnostics or follow-up reasoning. For a user-facing request asking what is playing, use roon_show_now_playing instead so the compact visual widget is shown. It accepts a zone name directly, so do not list zones first.",
    annotations: readOnly,
    inputSchema: {
      scope: z.enum(["system", "zones", "zone", "outputs"]).default("system"),
      zone: targetSchema.optional(),
      include_unavailable_outputs: z.boolean().default(false)
    }
  }, (input) => gateway.getState(input));

  register("roon_control_playback", {
    title: "Control Roon Playback",
    description: "Use this when the user wants to control an existing queue: play, pause, toggle, stop, skip, go back or seek. Do not use it to choose new music.",
    annotations: write,
    inputSchema: {
      target: z.enum(["zone", "all"]).default("zone"),
      zone: targetSchema.optional(),
      action: z.enum(["play", "pause", "toggle", "stop", "next", "previous", "seek"]),
      seek: z.object({ mode: z.enum(["absolute", "relative"]), seconds: z.number() }).optional()
    }
  }, (input) => gateway.controlPlayback(input));

  register("roon_set_volume", {
    title: "Set Roon Volume",
    description: "Use this when the user wants absolute or relative volume, mute or unmute for a named zone, named output or all outputs. Safe zone limits are enforced internally.",
    annotations: write,
    inputSchema: {
      target: z.enum(["zone", "output", "all"]).default("zone"),
      zone: targetSchema.optional(),
      output: targetSchema.optional(),
      mode: z.enum(["absolute", "relative", "relative_step", "mute", "unmute"]),
      value: z.number().optional(),
      confirm: z.boolean().optional()
    }
  }, (input) => gateway.setVolume(input));

  register("roon_control_output", {
    title: "Control Roon Output",
    description: "Use this when one physical output must receive a supported standby or convenience-switch command. Use roon_set_volume for mute and volume.",
    annotations: write,
    inputSchema: {
      output: targetSchema,
      action: z.enum(["standby", "toggle_standby", "convenience_switch"]),
      control_key: z.string().optional()
    }
  }, (input) => gateway.controlOutput(input));

  register("roon_set_playback_options", {
    title: "Set Roon Playback Options",
    description: "Use this when shuffle, automatic radio or loop behavior should change for a named zone. Do not use it for play, pause or selecting music.",
    annotations: write,
    inputSchema: {
      zone: targetSchema,
      shuffle: z.boolean().optional(),
      auto_radio: z.boolean().optional(),
      loop: z.enum(["loop", "loop_one", "disabled", "next"]).optional()
    }
  }, (input) => gateway.setPlaybackOptions(input));

  register("roon_set_grouping", {
    title: "Set Roon Zone Grouping",
    description: "Use this when zones should play synchronously or a current group should be split. Do not emulate grouping with separate playback calls.",
    annotations: write,
    inputSchema: {
      action: z.enum(["group", "ungroup"]),
      primary_zone: targetSchema,
      additional_zones: z.array(targetSchema).optional()
    }
  }, (input) => gateway.setGrouping(input));

  register("roon_transfer_playback", {
    title: "Transfer Roon Playback",
    description: "Use this when current playback and its queue should move from one named zone to another. Do not search for or rebuild the music.",
    annotations: write,
    inputSchema: { source_zone: targetSchema, target_zone: targetSchema }
  }, (input) => gateway.transfer(input));

  register("roon_search_media", {
    title: "Search Roon Media",
    description: "Use this when the user wants to explore or explicitly select music. It returns Roon's best match followed by separately ranked artists, albums, EPs, singles, tracks and playlists, and never starts playback. Pass one explicit type when the user clearly says artist, album or song. Model searches prefer TIDAL by default; the portal keeps its broader discovery policy.",
    annotations: readOnly,
    inputSchema: {
      query: z.string().min(1),
      types: z.array(mediaType).optional(),
      count: z.number().int().min(1).max(25).default(10),
      source_preference: sourcePreference.default("streaming_first")
    }
  }, (input) => gateway.searchMedia(input));

  register("roon_get_media_entity", {
    title: "Get Roon Media Entity",
    description: "Use this when a selected artist, album, track or Roon catalog playlist needs deep details. Artist results preserve Roon album versus single/EP sections and include popular tracks; album results include their track list. Playlist results return ordered tracks with pagination; keep increasing offset until pagination.has_more=false. Use roon_get_playlist instead for a saved or temporary RoonIA playlist.",
    annotations: readOnly,
    inputSchema: {
      result_id: z.string().min(1),
      zone: targetSchema.optional(),
      count: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).default(0).describe("Track offset for playlist details; ignored for other media types.")
    }
  }, (input) => gateway.getMediaEntity(input));

  register("roon_play_media", {
    title: "Play Roon Media",
    description: "Use this when the user wants new music to start now and replace the zone queue. Pass a prior result_id when available; otherwise pass the query and explicit artist, album or track type when the user stated it. Ambiguous matches are returned without playing.",
    annotations: write,
    inputSchema: { zone: targetSchema, media: mediaSelector }
  }, (input) => gateway.playMedia(input));

  register("roon_enqueue_media", {
    title: "Enqueue Roon Media",
    description: "Use this when selected or queried music should play next or be appended without replacing the current queue.",
    annotations: write,
    inputSchema: {
      zone: targetSchema,
      media: mediaSelector,
      position: z.enum(["next", "end"]).default("end")
    }
  }, (input) => gateway.enqueueMedia(input));

  register("roon_start_radio", {
    title: "Start Roon Artist Radio",
    description: "Use this when the user explicitly wants an artist radio including similar artists. Use roon_play_media for only the selected artist catalog.",
    annotations: write,
    inputSchema: { zone: targetSchema, artist: mediaSelector }
  }, (input) => gateway.startRadio(input));

  register("roon_get_queue", {
    title: "Get Roon Queue",
    description: "Use this when the current queue for a named zone must be inspected.",
    annotations: readOnly,
    inputSchema: {
      zone: targetSchema,
      count: z.number().int().min(1).max(500).default(100)
    }
  }, (input) => gateway.getQueue(input));

  register("roon_play_queue_item", {
    title: "Play Roon Queue Item",
    description: "Use this when playback should continue from a queue_item_id returned by roon_get_queue.",
    annotations: write,
    inputSchema: { zone: targetSchema, queue_item_id: z.number().int().nonnegative() }
  }, (input) => gateway.playQueueItem(input));

  register("roon_list_playlists", {
    title: "List RoonIA Playlists",
    description: "Use this when the user wants a paginated list of virtual playlists without track details.",
    annotations: readOnly,
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0)
    }
  }, (input) => gateway.listPlaylists(input));

  register("roon_list_temporary_playlists", {
    title: "List Temporary RoonIA Playlists",
    description: "Use this when the user wants to revisit active temporary playlists created for contextual listening; permanent playlists are excluded.",
    annotations: readOnly,
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0)
    }
  }, (input) => gateway.listTemporaryPlaylists(input));

  register("roon_get_playlist", {
    title: "Get RoonIA Playlist",
    description: "Use this when one virtual playlist and its paginated tracks are needed.",
    annotations: readOnly,
    inputSchema: {
      playlist_id: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0)
    }
  }, (input) => gateway.getPlaylist(input));

  register("roon_save_playlist", {
    title: "Save RoonIA Playlist",
    description: "Use this when the user explicitly wants to save a permanent playlist or replace its complete track list; use roon_create_temporary_playlist for contextual music they only want to hear now. Send title plus artist_credit for every primary and reserve. RoonIA resolves the canonical MusicBrainz recording first, then accepts only a compatible playable Roon binding; ambiguous or unavailable recordings are omitted for manual selection. For a requested size, include roughly 50-75% reserves. If status=needs_input, call this tool again with its build_id and new candidates. RoonIA allows exactly two replenishment rounds and a result_id never bypasses validation.",
    annotations: write,
    inputSchema: {
      build_id: z.string().uuid().optional().describe("Return value from a prior needs_input response. On replenishment calls, submit only build_id and new tracks."),
      playlist_id: z.string().optional(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      desired_count: z.number().int().min(1).max(500).optional(),
      no_adjacent_same_artist: z.boolean().default(true),
      tracks: z.array(playlistBuildCandidate).max(750).optional()
    }
  }, (input) => gateway.savePlaylist(input));

  register("roon_create_temporary_playlist", {
    title: "Create Temporary RoonIA Playlist",
    description: "Use this when the user asks for contextual music for an activity, mood or occasion without asking to save it permanently. Provide a short intent summary plus primary and reserve tracks with title and artist_credit. RoonIA resolves MusicBrainz identity before creating a compatible Roon playback binding. If status=needs_input, call this tool again with build_id and fresh candidates. After completion call roon_play_playlist with the returned playlist_id and the requested queue mode. Do not use this when the user explicitly asks to keep or save the playlist.",
    annotations: write,
    inputSchema: {
      build_id: z.string().uuid().optional().describe("Return value from a prior needs_input response for this temporary playlist build."),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      intent: z.string().min(1).max(500).optional().describe("Short summary of the activity, mood or listening context; do not copy the full conversation."),
      desired_count: z.number().int().min(1).max(500).default(15),
      no_adjacent_same_artist: z.boolean().default(true),
      tracks: z.array(playlistBuildCandidate).max(750).optional()
    }
  }, (input) => gateway.createTemporaryPlaylist(input));

  register("roon_promote_temporary_playlist", {
    title: "Save Temporary RoonIA Playlist",
    description: "Use this when the user likes a temporary playlist and explicitly asks to keep it permanently. It preserves the playlist and track identities while removing its expiry.",
    annotations: write,
    inputSchema: {
      playlist_id: z.string().min(1),
      name: z.string().min(1).optional(),
      description: z.string().optional()
    }
  }, (input) => gateway.promoteTemporaryPlaylist(input));

  register("roon_edit_playlist_tracks", {
    title: "Edit RoonIA Playlist Tracks",
    description: "Use this when one or more playlist track additions, updates, removals, replacements or reorderings should be applied as a single batch. Additions and replacements require title plus artist_credit and use the same MusicBrainz-first identity and Roon-binding preflight as playlist creation; unresolved, unsafe or already-present recordings are omitted rather than persisted.",
    annotations: destructive,
    inputSchema: {
      playlist_id: z.string().min(1),
      operations: z.array(playlistOperation).min(1).max(250),
      confirm: z.boolean().default(false)
    }
  }, (input) => gateway.editPlaylistTracks(input));

  register("roon_prepare_playlist_cover", {
    title: "Prepare RoonIA Playlist Cover",
    description: "Use this when the user wants ChatGPT to create or generate artwork for a virtual playlist. Call it before image generation so the exact playlist, track context, minimum resolution, preferred format, crop and edge-safe requirements are known. After generating the image, call roon_set_playlist_cover with the returned playlist_id and the generated image as image_file.",
    annotations: readOnly,
    inputSchema: {
      playlist: z.object({
        id: z.string().min(1).optional(),
        name: z.string().min(1).optional()
      }).refine((value) => Boolean(value.id || value.name), "id or name is required")
    }
  }, (input) => gateway.preparePlaylistCover(input));

  register("roon_set_playlist_cover", {
    title: "Set RoonIA Playlist Cover",
    description: "Use this when a generated or user-supplied image is ready to become a virtual playlist's custom cover. For generated artwork, call roon_prepare_playlist_cover before generation, then provide the resulting image through image_file. Prefer a 1024x1024 square sRGB source; images below 768x768 are rejected instead of being saved blurry. JPEG, PNG and WebP are accepted. RoonIA auto-rotates, center-crops, strips metadata, resizes up to 1024x1024 and compresses to a verified WebP under 750 KB. Inline Base64 remains available only for legacy clients; never pass an internal sandbox path or track artwork key.",
    annotations: write,
    _meta: { "openai/fileParams": ["image_file"] },
    inputSchema: {
      playlist_id: z.string().min(1),
      image_file: openAiFile.optional().describe("Authorized generated or user-selected image file supplied by ChatGPT. This is the preferred input."),
      image_data_url: z.string().min(1).max(8_000_000).optional().describe("Base64 data URL. Optimal generated artwork is a 768x768 square sRGB WebP under 750 KB."),
      image_base64: z.string().min(1).max(8_000_000).optional().describe("Raw base64 image bytes. For generated artwork prefer a 768x768 square WebP under 750 KB."),
      content_type: z.enum(["image/jpeg", "image/png", "image/webp"]).optional().describe("Required with image_base64; prefer image/webp for generated artwork.")
    }
  }, (input) => gateway.setPlaylistCover(input));

  register("roon_delete_playlist", {
    title: "Delete RoonIA Playlist",
    description: "Use this when the user explicitly wants a virtual playlist permanently deleted. It requires confirm=true.",
    annotations: destructive,
    inputSchema: { playlist_id: z.string().min(1), confirm: z.boolean().default(false) }
  }, (input) => gateway.deletePlaylist(input));

  register("roon_play_playlist", {
    title: "Play RoonIA Playlist",
    description: "Use this when a virtual playlist should start now, play next or be appended in a named zone.",
    annotations: write,
    inputSchema: {
      playlist_id: z.string().min(1),
      zone: targetSchema,
      mode: z.enum(["play_now", "add_next", "add_to_queue"]).default("play_now"),
      limit: z.number().int().min(1).optional()
    }
  }, (input) => gateway.playPlaylist(input));

  register("roon_play_playlist_track", {
    title: "Play RoonIA Playlist Track",
    description: "Use this when one stored track from a virtual playlist should play now, play next or be appended in a named zone.",
    annotations: write,
    inputSchema: {
      playlist_id: z.string().min(1),
      track_id: z.string().min(1),
      zone: targetSchema,
      mode: z.enum(["play_now", "add_next", "add_to_queue"]).default("play_now")
    }
  }, (input) => gateway.playPlaylistTrack(input));

  register("roon_analyze_playlist", {
    title: "Analyze RoonIA Playlist",
    description: "Use this when playlist identity readiness, missing metadata, ambiguity or probable duplicates should be checked without modifying it. In v0.20 beta, pass up to 10 catalog_track_ids to run the explainable MusicBrainz identity V2 recording and release diagnostic in shadow mode; it reports cache hits and rejection reasons but never changes the playlist or replaces a Roon selection.",
    annotations: readOnly,
    inputSchema: {
      playlist_id: z.string().min(1),
      include_duplicates: z.boolean().default(true),
      catalog_track_ids: z.array(z.string().min(1)).min(1).max(10).optional()
        .describe("Selected playlist track IDs to inspect through MusicBrainz without writing metadata.")
    }
  }, (input) => gateway.analyzePlaylist(input));

  register("roon_resolve_playlist", {
    title: "Resolve RoonIA Playlist",
    description: "Use this when stale, missing, ambiguous or incorrectly associated playlist tracks should be searched again and restored. It uses strict track identity matching, then prefers an equivalent TIDAL recording and its best known quality. Use selected with track_ids to repair chosen entries, all for a full rebuild, or unresolved by default. Do not claim completion while verified=false or resolution_summary.unresolved is nonzero.",
    annotations: write,
    inputSchema: {
      playlist_id: z.string().min(1),
      track_ids: z.array(z.string().min(1)).min(1).optional(),
      scope: z.enum(["unresolved", "selected", "all"]).default("unresolved"),
      selections: z.array(z.object({
        track_id: z.string().min(1),
        result_id: z.string().min(1)
      })).optional()
    }
  }, (input) => gateway.resolvePlaylist(input));

  register("roon_refresh_playlist_metadata", {
    title: "Refresh RoonIA Playlist Metadata",
    description: "Use this when resolved playlist tracks need coherent recording, release, duration, credits, year, source or artwork metadata refreshed without changing their selected identity. Results distinguish exact, partial, conflict and unverified metadata instead of guessing across editions. Use incomplete by default, selected with track_ids for chosen entries, or all for a full refresh. Use roon_resolve_playlist instead when a track is missing, ambiguous or incorrectly associated.",
    annotations: write,
    inputSchema: {
      playlist_id: z.string().min(1),
      track_ids: z.array(z.string().min(1)).min(1).optional(),
      scope: z.enum(["incomplete", "selected", "all"]).default("incomplete")
    }
  }, (input) => gateway.refreshPlaylistMetadata(input));

  register("roon_export_playlist", {
    title: "Export RoonIA Playlist",
    description: "Use this when a virtual playlist should be exported as JSON, CSV or M3U.",
    annotations: readOnly,
    inputSchema: {
      playlist_id: z.string().min(1),
      format: z.enum(["json", "csv", "m3u"]).default("json")
    }
  }, (input) => gateway.exportPlaylist(input));

  register("roon_import_playlist", {
    title: "Import RoonIA Playlist",
    description: "Use this when a validated RoonIA playlist JSON payload should be imported. Replacing an existing playlist requires confirm=true.",
    annotations: destructive,
    inputSchema: { payload: looseObject, confirm: z.boolean().default(false) }
  }, (input) => gateway.importPlaylist(input));

  register("roon_get_configuration", {
    title: "Get RoonIA Configuration",
    description: "Use this when configured safe volume limits or zone presets must be listed or read by ID.",
    annotations: readOnly,
    inputSchema: {
      resource: z.enum(["volume_limits", "zone_presets"]),
      id: z.string().optional()
    }
  }, (input) => gateway.getConfiguration(input));

  register("roon_save_configuration", {
    title: "Save RoonIA Configuration",
    description: "Use this when a safe volume limit or zone preset should be created or updated. Omit id to create it.",
    annotations: write,
    inputSchema: {
      resource: z.enum(["volume_limit", "zone_preset"]),
      id: z.string().optional(),
      value: looseObject
    }
  }, (input) => gateway.saveConfiguration(input));

  register("roon_delete_configuration", {
    title: "Delete RoonIA Configuration",
    description: "Use this when one safe volume limit or zone preset should be permanently deleted. It requires confirm=true.",
    annotations: destructive,
    inputSchema: {
      resource: z.enum(["volume_limit", "zone_preset"]),
      id: z.string().min(1),
      confirm: z.boolean().default(false)
    }
  }, (input) => gateway.deleteConfiguration(input));

  register("roon_apply_zone_preset", {
    title: "Apply RoonIA Zone Preset",
    description: "Use this when a stored zone preset should configure real grouping and volumes without selecting new music.",
    annotations: write,
    inputSchema: { preset_id: z.string().min(1), confirm: z.boolean().default(false) }
  }, (input) => gateway.applyZonePreset(input));

  register("roon_run_diagnostics", {
    title: "Run RoonIA Diagnostics",
    description: "Use this when RoonIA or Roon connectivity must be diagnosed with a sanitized operational bundle. Do not use it for routine state queries.",
    annotations: readOnly,
    inputSchema: {
      include_logs: z.boolean().default(true),
      include_actions: z.boolean().default(true)
    }
  }, (input) => gateway.runDiagnostics(input));
}
