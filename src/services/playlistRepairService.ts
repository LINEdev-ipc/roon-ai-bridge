import type { RoonMediaService, SourcePreference } from "../roon/roonMediaService";
import type { Logger } from "../utils/logger";
import { ApiError } from "../utils/errors";
import { PlaylistMetadataEnrichmentService } from "./playlistMetadataEnrichmentService";
import { PlaylistService } from "./playlistService";
import { TrackCatalogService } from "./trackCatalogService";
import {
  applyCatalogMetadata,
  catalogArtistCredit,
  catalogProfileFromAudio
} from "./playlists/catalogMetadata";
import { metadataCompleteness } from "./playlists/playlistMetadataPolicy";
import type { VirtualPlaylistTrack } from "./playlists/playlistContracts";

export class PlaylistRepairService {
  constructor(
    private readonly playlistService: PlaylistService,
    private readonly mediaService: RoonMediaService,
    private readonly metadataService: PlaylistMetadataEnrichmentService,
    private readonly logger?: Logger,
    private readonly trackCatalogService?: TrackCatalogService
  ) {}

  async rebuildPlaylist(input: {
    playlistId: string;
    trackIds?: string[];
    scope?: "issues" | "selected" | "all";
    sourcePreference?: SourcePreference;
  }) {
    const startedAt = Date.now();
    const before = this.playlistService.getPlaylist(input.playlistId);
    const requested = input.trackIds ? new Set(input.trackIds) : null;
    if (requested) {
      const known = new Set(before.tracks.map((track) => track.track_id));
      const unknown = [...requested].filter((trackId) => !known.has(trackId));
      if (unknown.length) {
        throw new ApiError("PLAYLIST_TRACK_NOT_FOUND", "Virtual playlist track not found", {
          playlist_id: input.playlistId,
          track_ids: unknown
        });
      }
    }
    const scope = input.scope || (requested ? "selected" : "issues");
    if (scope === "selected" && (!requested || requested.size === 0)) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "track_ids are required when reconstruction scope is selected", {
        playlist_id: input.playlistId,
        scope
      });
    }
    const candidates = before.tracks.filter((track) => {
      if (requested && !requested.has(track.track_id)) return false;
      if (scope === "all" || scope === "selected") return true;
      const status = String(track.resolution?.status || "");
      return !["resolved", "manual"].includes(status) ||
        catalogProfileFromAudio(track.audio_metadata)?.status !== "exact" ||
        !metadataCompleteness(track.audio_metadata).complete;
    });
    const migration: Array<Record<string, unknown>> = [];
    for (const track of candidates) {
      try {
        migration.push(await this.migrateCatalogIdentity(input.playlistId, track));
      } catch (error) {
        this.logger?.warn("Playlist catalog migration failed", {
          playlistId: input.playlistId,
          trackId: track.track_id,
          error: error instanceof Error ? error.message : String(error)
        });
        migration.push({
          track_id: track.track_id,
          status: "needs_review",
          reason: `catalog_lookup_failed:${error instanceof Error ? error.message : String(error)}`
        });
      }
    }

    const migratedPlaylist = this.playlistService.getPlaylist(input.playlistId);
    const resolveTrackIds = candidates
      .map((candidate) => migratedPlaylist.tracks.find((track) => track.track_id === candidate.track_id))
      .filter((track): track is VirtualPlaylistTrack => Boolean(track))
      .filter((track) => String(track.resolution?.status || "") !== "manual")
      .map((track) => track.track_id);
    const resolution = resolveTrackIds.length
      ? await this.playlistService.resolveVirtualPlaylistItems(input.playlistId, {
          mediaService: this.mediaService,
          logger: this.logger,
          sourcePreference: input.sourcePreference || "streaming_first",
          trackIds: resolveTrackIds,
          force: true
        })
      : { resolution: [] };
    const resolvedTrackIds = this.playlistService.getPlaylist(input.playlistId).tracks
      .filter((track) =>
        candidates.some((candidate) => candidate.track_id === track.track_id) &&
        ["resolved", "manual"].includes(String(track.resolution?.status || "")) &&
        (
          track.audio_metadata?.metadata_status !== "exact" ||
          !metadataCompleteness(track.audio_metadata).complete
        )
      )
      .map((track) => track.track_id);
    const enrichment = await this.metadataService.refreshPlaylist(input.playlistId, {
      trackIds: resolvedTrackIds,
      force: true,
      sourcePreference: input.sourcePreference
    });
    const playlist = this.playlistService.getPlaylist(input.playlistId);
    const countStatus = (status: string) => playlist.tracks.filter((track) =>
      String(track.resolution?.status || "") === status
    ).length;
    const exactMetadata = playlist.tracks.filter((track) =>
      track.audio_metadata?.metadata_status === "exact"
    ).length;
    const migrated = migration.filter((entry) => entry.status === "migrated").length;
    const preserved = migration.filter((entry) => entry.status === "preserved").length;
    const needsReview = migration.filter((entry) => entry.status === "needs_review").length;
    const report = {
      playlist_id: input.playlistId,
      scope,
      requested_tracks: candidates.length,
      migrated,
      preserved,
      needs_review: needsReview,
      resolved: countStatus("resolved"),
      manual: countStatus("manual"),
      ambiguous: countStatus("ambiguous"),
      missing: countStatus("missing"),
      exact_metadata: exactMetadata,
      total_tracks: playlist.tracks.length,
      complete: countStatus("ambiguous") === 0 && countStatus("missing") === 0 &&
        countStatus("stale") === 0 &&
        countStatus("error") === 0 && exactMetadata === playlist.tracks.length,
      resolver_version: "musicbrainz-v2-roon-binding-v2",
      rebuilt_at: new Date().toISOString(),
      elapsed_ms: Date.now() - startedAt,
      tracks: migration
    };
    this.logger?.info("Playlist reconstruction completed", report);
    return {
      playlist,
      report,
      resolution: resolution.resolution,
      enrichment
    };
  }

  async repairPlaylist(input: {
    playlistId: string;
    trackIds?: string[];
    force?: boolean;
    sourcePreference?: SourcePreference;
  }) {
    return this.rebuildPlaylist({
      playlistId: input.playlistId,
      trackIds: input.trackIds,
      scope: input.force ? "all" : input.trackIds ? "selected" : "issues",
      sourcePreference: input.sourcePreference
    });
  }

  private async migrateCatalogIdentity(
    playlistId: string,
    track: VirtualPlaylistTrack
  ): Promise<Record<string, unknown>> {
    if (!this.trackCatalogService) {
      return { track_id: track.track_id, status: "preserved", reason: "catalog_service_unavailable" };
    }
    const storedProfile = catalogProfileFromAudio(track.audio_metadata);
    if (storedProfile?.status === "exact" && storedProfile.recording) {
      const audio = applyCatalogMetadata(track.audio_metadata, storedProfile);
      this.playlistService.updateTrackAudioMetadata(playlistId, track.track_id, audio, {
        ...(track.resolution?.metadata_enrichment as Record<string, unknown> || {}),
        catalog: storedProfile,
        reconstruction: {
          resolver_version: "musicbrainz-v2-roon-binding-v2",
          reused_at: new Date().toISOString()
        }
      });
      return {
        track_id: track.track_id,
        status: "preserved",
        reason: "existing_exact_musicbrainz_identity",
        musicbrainz_recording_id: storedProfile.recording.musicbrainz_id
      };
    }
    const recording = track.audio_metadata?.recording as Record<string, unknown> | undefined;
    const recordingId = storedProfile?.recording?.musicbrainz_id ||
      (typeof recording?.musicbrainz_id === "string" ? recording.musicbrainz_id : null);
    const storedCredits = Array.isArray(recording?.artist_credit)
      ? recording.artist_credit as Array<Record<string, unknown>>
      : [];
    const storedArtist = storedCredits.map((credit) =>
      `${String(credit.name || "")}${String(credit.join_phrase || "")}`
    ).join("").trim();
    const title = storedProfile?.recording?.title ||
      (typeof recording?.title === "string" ? recording.title : null) ||
      track.identity.title || track.title || track.query;
    const artist = catalogArtistCredit(storedProfile) || storedArtist ||
      track.identity.artist || track.artist;
    if (!title || !artist) {
      return { track_id: track.track_id, status: "needs_review", reason: "canonical_title_or_artist_missing" };
    }
    const { profile } = await this.trackCatalogService.resolve({
      recording_id: recordingId,
      title,
      artist,
      album: storedProfile?.release_group?.title || track.identity.album || track.album,
      version_hint: track.identity.version_hint,
      isrc: track.identity.isrc,
      duration_seconds: track.identity.duration_seconds,
      release_year: track.identity.release_year,
      track_number: track.identity.track_number,
      disc_number: track.identity.disc_number
    });
    if (profile.status !== "exact" || !profile.recording) {
      return {
        track_id: track.track_id,
        status: "needs_review",
        reason: `musicbrainz_${profile.status}:${profile.reason}`
      };
    }
    const audio = applyCatalogMetadata(track.audio_metadata, profile);
    this.playlistService.updateTrackAudioMetadata(playlistId, track.track_id, audio, {
      ...(track.resolution?.metadata_enrichment as Record<string, unknown> || {}),
      catalog: profile,
      migration: {
        resolver_version: "musicbrainz-v2-roon-binding-v2",
        migrated_at: new Date().toISOString()
      }
    });
    return {
      track_id: track.track_id,
      status: "migrated",
      musicbrainz_recording_id: profile.recording.musicbrainz_id,
      title: profile.recording.title,
      artist: catalogArtistCredit(profile),
      album: profile.release_group?.title || null
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
