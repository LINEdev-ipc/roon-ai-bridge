import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { APP_VERSION } from "../../config/version";
import { BridgeV2Context } from "../context";
import { registerBridgeV2Tools } from "./tools";
import { registerWidgetV2Resources } from "../widgets/resources";
import { registerWidgetV2Tools } from "../widgets/tools";

export const BRIDGE_V2_INSTRUCTIONS =
  "For activity, mood or occasion requests when the user wants music now but did not ask to save it, call roon_create_temporary_playlist, replenish needs_input with its build_id, then call roon_play_playlist. Promote it only when asked to keep it; use roon_save_playlist for explicit permanent requests. For playlist artwork, call roon_prepare_playlist_cover before image generation, then call roon_set_playlist_cover with image_file. Never pass an internal sandbox path. For model-created playlists, use Roon to discover playable candidates and MusicBrainz as the authority that verifies identity, first-publication date and metadata before anything is saved. For niche genres, date limits or uncertain titles, call roon_search_media with several focused queries first; copy exact track title, artist_credit, album_hint and result_id into every candidate. Never invent a title, artist, album or year. recording_intent is the recording version, not the genre: use standard by default, including dub-genre music, and use live, remix, cover, dub, acoustic or alternate only for that explicit version. Set desired_count and convert relative release-date constraints to release_year_from/release_year_to. Include reliable reserves from Roon and avoid repeating the same recording or overusing one artist unless requested. If status=needs_input, do not ask the user: inspect rejection_summary and call the same creation tool with build_id plus genuinely new candidates. For musicbrainz_ambiguous add the exact album_hint; for musicbrainz_not_found replace the proposal with a fresh Roon result; for roon_binding_required use another playable Roon result; for duplicates choose another recording. Exact retries are idempotent. After three genuine replenishment rounds RoonIA saves all verified tracks even if desired_count was not reached; always report added_count, missing_count and build_summary.complete. Never describe a reserve as saved unless it appears in accepted. A metadata conflict never authorizes choosing another recording or consuming a reserve; only unresolved identity does. To complete a RoonIA playlist from a selected Roon catalog playlist, page roon_get_media_entity with count and offset until pagination.has_more=false, read the target with roon_get_playlist, then add only missing recordings with roon_edit_playlist_tracks. For now-playing requests call roon_show_now_playing with the zone. Use roon_show_zones for all zones, roon_show_queue for one queue, roon_show_playlist_library for saved RoonIA playlists, roon_show_playlist for one exact playlist and roon_show_media for artist, album, song or search results. Search responses expose best_match and grouped entities; trust best_match unless the user names a different entity. roon_play_media, roon_enqueue_media and roon_start_radio accept a query or prior result_id. Use roon_rebuild_playlist to repair an existing playlist without changing its songs. Reconstruction is asynchronous: start with playlist_id, then poll the same tool with job_id while status=in_progress. If it finishes with a real ambiguity, ask the user to choose. Only claim a mutation succeeded when status=completed; report verified and build_summary.complete separately.";

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
