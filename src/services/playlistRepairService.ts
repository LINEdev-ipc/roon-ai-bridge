import type { RoonMediaService, SourcePreference } from "../roon/roonMediaService";
import type { Logger } from "../utils/logger";
import { ApiError } from "../utils/errors";
import { PlaylistMetadataEnrichmentService } from "./playlistMetadataEnrichmentService";
import { PlaylistService } from "./playlistService";
import { TrackCatalogService } from "./trackCatalogService";

export class PlaylistRepairService {
  constructor(
    private readonly playlistService: PlaylistService,
    private readonly mediaService: RoonMediaService,
    private readonly metadataService: PlaylistMetadataEnrichmentService,
    private readonly logger?: Logger,
    private readonly trackCatalogService?: TrackCatalogService
  ) {}

  async repairPlaylist(input: {
    playlistId: string;
    trackIds?: string[];
    force?: boolean;
    sourcePreference?: SourcePreference;
  }) {
    const resolution = await this.playlistService.resolveVirtualPlaylistItems(input.playlistId, {
      mediaService: this.mediaService,
      logger: this.logger,
      sourcePreference: input.sourcePreference || "streaming_first",
      trackIds: input.trackIds,
      force: input.force
    });
    const resolvedTrackIds = resolution.resolution
      .filter((entry) => entry.status === "resolved" || entry.status === "manual")
      .map((entry) => entry.track_id);
    const enrichment = resolvedTrackIds.length
      ? await this.metadataService.refreshPlaylist(input.playlistId, {
          trackIds: resolvedTrackIds,
          force: true,
          sourcePreference: input.sourcePreference
        })
      : await this.metadataService.refreshPlaylist(input.playlistId, {
          trackIds: [],
          sourcePreference: input.sourcePreference
        });
    return {
      playlist: this.playlistService.getPlaylist(input.playlistId),
      resolution: resolution.resolution,
      enrichment
    };
  }

  async selectTrack(input: {
    playlistId: string;
    trackId: string;
    resultId: string;
    selectionReason?: string;
    selectionOrigin?: "model" | "portal_user" | "unknown_explicit";
  }) {
    const result = this.mediaService.get(input.resultId);
    if (result.media_type !== "track" || !result.playable || !result.roon_item_key) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "result_id must reference a playable Roon track", {
        result_id: input.resultId,
        media_type: result.media_type,
        playable: result.playable
      });
    }
    this.playlistService.setTrackMatch(input.playlistId, input.trackId, input.resultId, {
      mediaService: this.mediaService,
      selectionReason: input.selectionReason,
      selectionOrigin: input.selectionOrigin
    });
    const enrichment = await this.metadataService.refreshTrack(input.playlistId, input.trackId, { result });
    let enrichedTrack = enrichment.track;
    let enrichmentReport: Record<string, unknown> = enrichment.report;
    if (this.trackCatalogService) {
      const profile = await this.trackCatalogService.describeRoonTrack(result);
      if (profile.recording) {
        const binding = this.trackCatalogService.bind(profile.recording.musicbrainz_id, result, "manual", {
          playlist_id: input.playlistId,
          track_id: input.trackId,
          selection_reason: input.selectionReason || "explicit_manual_selection",
          selection_origin: input.selectionOrigin || "unknown_explicit"
        });
        profile.roon_binding = binding;
        profile.provenance.playback = "roon";
        const canonicalArtist = profile.recording.artist_credit.length
          ? profile.recording.artist_credit
            .map((credit) => `${credit.name}${credit.join_phrase}`)
            .join("")
          : result.artist || result.album_artist || "";
        const audioMetadata = {
          ...(enrichment.track.audio_metadata || {}),
          title: profile.recording.title,
          artist: canonicalArtist,
          album_artist: canonicalArtist,
          ...(profile.release_group?.title ? { album: profile.release_group.title } : {}),
          recording: {
            musicbrainz_id: profile.recording.musicbrainz_id,
            title: profile.recording.title,
            artist: canonicalArtist,
            artist_credit: profile.recording.artist_credit,
            disambiguation: profile.recording.disambiguation,
            duration_seconds: profile.recording.duration_seconds,
            duration_source: profile.recording.duration_source,
            isrcs: profile.recording.isrcs,
            composers: profile.composers,
            lyricists: profile.lyricists,
            genres: profile.genres.map((genre) => genre.name),
            confidence: "high"
          },
          composers: profile.composers,
          composer: profile.composers.join(", "),
          lyricists: profile.lyricists,
          genres: profile.genres.map((genre) => genre.name),
          genre: profile.genres.map((genre) => genre.name).join(", "),
          isrcs: profile.recording.isrcs,
          ...(profile.recording.isrcs[0] ? { isrc: profile.recording.isrcs[0] } : {}),
          catalog: profile
        };
        enrichmentReport = {
          ...enrichment.report,
          catalog: profile,
          roon_binding: binding
        };
        enrichedTrack = this.playlistService.updateTrackAudioMetadata(
          input.playlistId,
          input.trackId,
          audioMetadata,
          enrichmentReport
        );
      }
    }
    return {
      playlist: this.playlistService.getPlaylist(input.playlistId),
      track: enrichedTrack,
      enrichment: enrichmentReport
    };
  }
}
