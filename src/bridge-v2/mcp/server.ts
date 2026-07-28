import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { APP_VERSION } from "../../config/version";
import { BridgeV2Context } from "../context";
import { registerBridgeV2Tools } from "./tools";
import { registerWidgetV2Resources } from "../widgets/resources";
import { registerWidgetV2Tools } from "../widgets/tools";

export const BRIDGE_V2_INSTRUCTIONS =
  "Treat any request to create, make, prepare, build, generate or curate a playlist, list or lista de reproducción as a permanent visible playlist and call roon_save_playlist. This remains true for moods, activities and occasions. Use roon_create_temporary_playlist only as a hidden helper for immediate-playback commands such as play music, put on music, pon música or reproduce música when the user did not request a playlist/list; then call roon_play_playlist. For every model-created playlist, generate the complete structured candidate pool yourself and call the creation tool once. Do not call roon_search_media first: RoonIA performs MusicBrainz/ListenBrainz identity discovery, Roon discovery and playback binding internally. MusicBrainz is the metadata and recording-identity authority; ListenBrainz only supplies ranking evidence and Roon only supplies the playable binding. Set desired_count and selection_complexity. Supply at least 125% of the requested count for standard selections, 140% for niche genres or date/other constraints, and 160% for named remixes, live versions, covers, soundtracks or performance-sensitive selections. Put the strongest desired_count choices first as primary and the remainder as reserve. Every candidate needs title and artist_credit; add album_hint, release_year_hint, required_credits and the exact recording_intent when known. recording_intent describes a version, never a genre: ordinary dub music is standard, while an explicit Dub Mix or Dub Version is dub. Convert relative date constraints to release_year_from/release_year_to. Avoid duplicate recordings and excessive repetition of an artist unless requested. RoonIA consumes reserves internally, stops after reaching the target and saves every verified track in the same call even if the target is not reached. Always report desired_count, added_count, missing_count and build_summary.complete; never claim unused reserves were saved. Use manual roon_search_media only when the user is selecting or repairing a specific unresolved item. For playlist artwork, call roon_prepare_playlist_cover before image generation, then call roon_set_playlist_cover with image_file; never pass an internal sandbox path. To complete a RoonIA playlist from a selected Roon catalog playlist, page roon_get_media_entity until pagination.has_more=false, read the target with roon_get_playlist, then add only missing recordings with roon_edit_playlist_tracks. For now-playing requests call roon_show_now_playing with the zone. Use roon_show_zones for all zones, roon_show_queue for one queue, roon_show_playlist_library for saved RoonIA playlists, roon_show_playlist for one exact playlist and roon_show_media for artist, album, song or search results. Search responses expose best_match and grouped entities; trust best_match unless the user names another entity. roon_play_media, roon_enqueue_media and roon_start_radio accept a query or prior result_id. Use roon_rebuild_playlist to repair an existing playlist without changing its songs. Reconstruction is asynchronous: start with playlist_id, then poll the same tool with job_id while status=in_progress. If it finishes with a real ambiguity, ask the user to choose. Only claim a mutation succeeded when status=completed; report verified and build_summary.complete separately.";

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
