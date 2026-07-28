import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { APP_VERSION } from "../../config/version";
import { BridgeV2Context } from "../context";
import { registerBridgeV2Tools } from "./tools";
import { registerWidgetV2Resources } from "../widgets/resources";
import { registerWidgetV2Tools } from "../widgets/tools";

export const BRIDGE_V2_INSTRUCTIONS =
  "For activity, mood or occasion requests when the user wants music now but did not ask to save it, call roon_create_temporary_playlist, replenish needs_input with its build_id, then call roon_play_playlist. Promote it only when asked to keep it; use roon_save_playlist for explicit permanent requests. For playlist artwork, call roon_prepare_playlist_cover before image generation, then call roon_set_playlist_cover with image_file. Never pass an internal sandbox path or claim success before the final tool returns status=completed and verified=true. For model-created playlists, always provide title and artist_credit for primary tracks and reserves. RoonIA resolves every accepted recording, enriches it before saving and reports metadata as exact, partial, conflict or unverified. A metadata conflict never authorizes choosing another recording or consuming a reserve; only unresolved identity does. If a size was requested, set desired_count. If status=needs_input, do not ask the user: call the same creation tool again with the returned build_id and fresh candidates. Exact retries are idempotent and do not consume a round; submit new candidates after a genuine needs_input. RoonIA never saves fewer tracks than desired_count. Never describe a reserve as saved unless it appears in accepted. To complete a RoonIA playlist from a selected Roon catalog playlist, page roon_get_media_entity with count and offset until pagination.has_more=false, read the target with roon_get_playlist, then add only missing recordings with roon_edit_playlist_tracks. For now-playing requests call roon_show_now_playing with the zone. Use roon_show_zones for a visual overview of all zones and roon_show_queue for what comes next in one named zone. Use roon_show_playlist_library to browse saved RoonIA playlists and roon_show_playlist for one exact playlist. Use roon_show_media for visual artist, album, song or search results. Search responses expose best_match plus artist, album, EP, single and track groups; trust best_match unless the user names a different entity. When the user explicitly says artist, album or song, pass that media type. roon_play_media, roon_enqueue_media and roon_start_radio accept either a query or a prior result_id. Use roon_rebuild_playlist to migrate old playlists, refresh canonical metadata and repair Roon bindings without changing their selection. If reconstruction still reports a real ambiguity, ask the user to choose. Only claim a mutation succeeded when status=completed; report verified and build_summary.complete separately.";

export function createBridgeV2McpServer(context: BridgeV2Context): McpServer {
  const server = new McpServer(
    { name: "roon-ai-bridge", version: APP_VERSION },
    {
      instructions: BRIDGE_V2_INSTRUCTIONS
    }
  );
  registerWidgetV2Resources(server);
  registerBridgeV2Tools(server, context);
  registerWidgetV2Tools(server, context);
  return server;
}

export async function startBridgeV2McpServer(context: BridgeV2Context): Promise<void> {
  const server = createBridgeV2McpServer(context);
  await server.connect(new StdioServerTransport());
  context.logger.info("MCP v2 stdio server listening", { service: "roon-ai-bridge" });
}
