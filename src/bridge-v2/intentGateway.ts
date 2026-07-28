import { getQueueSnapshot, playQueueItemFromHere } from "../roon/roonQueueService";
import { ApiError } from "../utils/errors";
import { TransportIntentHandler } from "./intents/transportIntentHandler";
import { BridgeV2Context } from "./context";
import {
  ambiguous,
  completed,
  MediaSelector,
  normalizeServiceResult,
  OperationResult,
  TargetReference
} from "./contracts";
import type { MediaType, SourcePreference } from "../roon/roonMediaService";
import { APP_VERSION } from "../config/version";
import { PlaylistBuildService } from "../services/playlistBuildService";
import { PlaylistRepairService } from "../services/playlistRepairService";
import {
  MAX_CUSTOM_COVER_BYTES,
  PLAYLIST_COVER_POLICY
} from "../services/playlistService";
import { downloadToolImage, ToolFileReference } from "../services/toolFileService";

export class IntentGateway extends TransportIntentHandler {
  private readonly playlistBuildService: PlaylistBuildService;
  private readonly playlistRepairService: PlaylistRepairService;

  constructor(context: BridgeV2Context) {
    super(context);
    this.playlistBuildService = context.playlistBuildService;
    this.playlistRepairService = context.playlistRepairService;
  }

  async searchMedia(input: {
    query: string;
    types?: MediaType[];
    count?: number;
    source_preference?: SourcePreference;
  }): Promise<OperationResult> {
    const result = await this.context.mediaService.search({
      query: input.query,
      types: input.types,
      count: input.count || 10,
      sourcePreference: input.source_preference || "streaming_first"
    });
    return completed("roon_search_media", `Found ${result.results.length} media results.`, result, {
      references: { recommended_result_id: result.recommended_result_id }
    });
  }

  async getMediaEntity(input: { result_id: string; zone?: TargetReference; count?: number; offset?: number }): Promise<OperationResult> {
    const media = this.context.mediaService.get(input.result_id);
    const zoneId = input.zone ? this.targets.zone(input.zone).zone_id : undefined;
    const data = media.media_type === "artist"
      ? await this.context.mediaService.getArtistDetail(input.result_id, zoneId, input.count || 50)
      : media.media_type === "album"
        ? await this.context.mediaService.getAlbumDetail(input.result_id, zoneId, input.count || 100)
        : media.media_type === "playlist"
          ? await this.context.mediaService.getPlaylistDetail(
              input.result_id,
              zoneId,
              input.count || 100,
              input.offset || 0
            )
          : this.context.trackCatalogService
            ? {
                track: media,
                catalog: await this.context.trackCatalogService.describeRoonTrack(media)
              }
            : media;
    return completed("roon_get_media_entity", `${media.media_type} details returned.`, data, {
      references: { result_id: input.result_id }
    });
  }

  private async resolveMedia(operation: string, selector: MediaSelector): Promise<string | OperationResult> {
    if (selector.result_id) return selector.result_id;
    if (!selector.query) throw new ApiError("INVALID_SEARCH_QUERY", "media requires result_id or query");
    const search = await this.context.mediaService.search({
      query: selector.query,
      types: selector.type ? [selector.type] : undefined,
      count: 10,
      sourcePreference: selector.source_preference || "streaming_first"
    });
    if (!search.recommended_result_id || search.selection_required) {
      return ambiguous(operation, "Several media results require selection.", {
        query: selector.query,
        candidates: search.results
      }, { recommended_result_id: search.recommended_result_id });
    }
    return search.recommended_result_id;
  }

  async playMedia(input: { zone: TargetReference; media: MediaSelector }): Promise<OperationResult> {
    const zone = this.targets.zone(input.zone);
    const resolved = await this.resolveMedia("roon_play_media", input.media);
    if (typeof resolved !== "string") return resolved;
    const result = await this.context.mediaService.play(resolved, zone.zone_id, "replace_queue");
    return normalizeServiceResult("roon_play_media", `Media start accepted in ${zone.display_name}.`, {
      ...result,
      final_zone_state: this.context.roonClient.getZone(zone.zone_id)?.state || null
    }, false);
  }

  async enqueueMedia(input: {
    zone: TargetReference;
    media: MediaSelector;
    position?: "next" | "end";
  }): Promise<OperationResult> {
    const zone = this.targets.zone(input.zone);
    const resolved = await this.resolveMedia("roon_enqueue_media", input.media);
    if (typeof resolved !== "string") return resolved;
    const result = await this.context.mediaService.play(
      resolved,
      zone.zone_id,
      input.position === "next" ? "play_next" : "append"
    );
    return normalizeServiceResult("roon_enqueue_media", `Media queue action accepted in ${zone.display_name}.`, result, false);
  }

  async startRadio(input: { zone: TargetReference; artist: MediaSelector }): Promise<OperationResult> {
    const zone = this.targets.zone(input.zone);
    const selector = { ...input.artist, type: "artist" as const };
    const resolved = await this.resolveMedia("roon_start_radio", selector);
    if (typeof resolved !== "string") return resolved;
    const result = await this.context.mediaService.startRadio(resolved, zone.zone_id);
    return normalizeServiceResult("roon_start_radio", `Artist radio start accepted in ${zone.display_name}.`, result, false);
  }

  async getQueue(input: { zone: TargetReference; count?: number }): Promise<OperationResult> {
    const zone = this.targets.zone(input.zone);
    const result = await getQueueSnapshot(this.context.roonClient, zone.zone_id, input.count || 100);
    return completed("roon_get_queue", `Queue returned for ${zone.display_name}.`, result, { verified: true });
  }

  async playQueueItem(input: { zone: TargetReference; queue_item_id: number }): Promise<OperationResult> {
    const zone = this.targets.zone(input.zone);
    const result = await playQueueItemFromHere(this.context.roonClient, zone.zone_id, input.queue_item_id);
    return normalizeServiceResult("roon_play_queue_item", `Queue item start accepted in ${zone.display_name}.`, result, false);
  }

  listPlaylists(input: { limit?: number; offset?: number }): OperationResult {
    const data = this.context.playlistService.listPlaylists({
      includeTracks: false,
      limit: input.limit || 25,
      offset: input.offset || 0
    });
    return completed("roon_list_playlists", "Virtual playlists returned.", data, { verified: true });
  }

  listTemporaryPlaylists(input: { limit?: number; offset?: number }): OperationResult {
    const data = this.context.playlistService.listPlaylists({
      includeTracks: false,
      limit: input.limit || 25,
      offset: input.offset || 0,
      scope: "temporary"
    });
    return completed(
      "roon_list_temporary_playlists",
      "Active temporary playlists returned.",
      data,
      { verified: true }
    );
  }

  getPlaylist(input: { playlist_id: string; limit?: number; offset?: number }): OperationResult {
    const data = this.context.playlistService.getPlaylistDetail(input.playlist_id, {
      includeTracks: true,
      limit: input.limit || 50,
      offset: input.offset || 0
    });
    return completed("roon_get_playlist", "Virtual playlist returned.", data, { verified: true });
  }

  private playlistMutationResult(operation: string, action: string, playlist: Record<string, any>): OperationResult {
    const validation = typeof (this.context.playlistService as any).validatePlaylist === "function"
      ? this.context.playlistService.validatePlaylist(playlist.playlist_id) as Record<string, any>
      : {
          summary: {
            ready: Array.isArray(playlist.tracks) ? playlist.tracks.filter((track: any) => ["resolved", "manual"].includes(track.resolution?.status)).length : 0,
            unresolved: Array.isArray(playlist.tracks) ? playlist.tracks.filter((track: any) => !["resolved", "manual"].includes(track.resolution?.status)).length : 0
          },
          issues: []
        };
    const resolutionSummary = validation.summary || {};
    const unresolved = Number(resolutionSummary.unresolved || 0);
    const ready = unresolved === 0;
    const summary = ready
      ? `${action} ${Number(resolutionSummary.ready || 0)} tracks are associated with playable Roon recordings.`
      : `${action} ${Number(resolutionSummary.ready || 0)} tracks are ready and ${unresolved} still require resolution or explicit selection.`;
    return completed(operation, summary, {
      ...playlist,
      resolution_summary: resolutionSummary,
      resolution_issues: validation.issues || []
    }, {
      verified: ready,
      warnings: ready ? [] : ["The playlist was saved, but its recording associations are not fully verified."]
    });
  }

  async savePlaylist(input: {
    build_id?: string;
    playlist_id?: string;
    name?: string;
    description?: string;
    desired_count?: number;
    release_year_from?: number;
    release_year_to?: number;
    no_adjacent_same_artist?: boolean;
    tracks?: unknown[];
  }): Promise<OperationResult> {
    if (input.playlist_id && input.tracks === undefined && !input.build_id) {
      const data = this.context.playlistService.updatePlaylist(input.playlist_id, input);
      return this.playlistMutationResult("roon_save_playlist", "Playlist updated.", data);
    }

    const build = await this.playlistBuildService.build(input);
    if (build.phase === "needs_candidates") {
      return {
        status: "needs_input",
        operation: "roon_save_playlist",
        summary: `Playlist preflight needs ${build.missing_count} more verified tracks. Submit candidate round ${build.next_round} with build_id ${build.build_id}.`,
        verified: false,
        data: build,
        references: { build_id: build.build_id, next_round: build.next_round },
        warnings: ["No playlist has been created or modified yet."]
      };
    }

    const mutation = this.playlistMutationResult(
      "roon_save_playlist",
      input.playlist_id ? "Playlist updated." : "Playlist created.",
      build.playlist as Record<string, any>
    );
    const completionWarning = build.complete
      ? []
      : [`The playlist was created safely with ${build.missing_count} fewer tracks than requested.`];
    return {
      ...mutation,
      summary: build.desired_count === null
        ? `${input.playlist_id ? "Playlist updated" : "Playlist created"} with ${build.added_count} verified tracks.`
        : build.complete
          ? `${input.playlist_id ? "Playlist updated" : "Playlist created"} with all ${build.desired_count} requested tracks verified.`
          : `${input.playlist_id ? "Playlist updated" : "Playlist created"} with ${build.added_count} verified tracks; ${build.missing_count} are missing from the requested target.`,
      data: {
        ...(mutation.data as Record<string, unknown>),
        build_summary: {
          round: build.round,
          desired_count: build.desired_count,
          added_count: build.added_count,
          missing_count: build.missing_count,
          complete: build.complete,
          accepted: build.accepted,
          rejected: build.rejected,
          not_selected: build.not_selected,
          unused_reserves: build.unused_reserves,
          search_summary: build.search_summary,
          rejection_summary: build.rejection_summary
        }
      },
      warnings: [...mutation.warnings, ...completionWarning]
    };
  }

  async createTemporaryPlaylist(input: {
    build_id?: string;
    name?: string;
    description?: string;
    intent?: string;
    desired_count?: number;
    release_year_from?: number;
    release_year_to?: number;
    no_adjacent_same_artist?: boolean;
    tracks?: unknown[];
  }): Promise<OperationResult> {
    const expiryDays = this.context.systemManagementService?.getTemporaryPlaylistExpiryDays() || 7;
    const build = await this.playlistBuildService.build({
      ...input,
      purpose: "temporary_playlist",
      expiry_days: expiryDays
    });
    if (build.phase === "needs_candidates") {
      return {
        status: "needs_input",
        operation: "roon_create_temporary_playlist",
        summary: `Temporary playlist preflight needs ${build.missing_count} more verified tracks. Submit candidate round ${build.next_round} with build_id ${build.build_id}.`,
        verified: false,
        data: build,
        references: { build_id: build.build_id, next_round: build.next_round },
        warnings: ["No temporary playlist has been created yet."]
      };
    }

    const mutation = this.playlistMutationResult(
      "roon_create_temporary_playlist",
      "Temporary playlist created.",
      build.playlist as Record<string, any>
    );
    const playlist = mutation.data as Record<string, any>;
    return {
      ...mutation,
      summary: build.complete
        ? `Temporary playlist created with ${build.added_count} verified tracks.`
        : `Temporary playlist created safely with ${build.added_count} verified tracks; ${build.missing_count} are missing from the requested target.`,
      data: {
        ...playlist,
        build_summary: {
          round: build.round,
          desired_count: build.desired_count,
          added_count: build.added_count,
          missing_count: build.missing_count,
          complete: build.complete,
          accepted: build.accepted,
          rejected: build.rejected,
          not_selected: build.not_selected,
          unused_reserves: build.unused_reserves,
          search_summary: build.search_summary,
          rejection_summary: build.rejection_summary
        }
      },
      references: {
        playlist_id: playlist.playlist_id,
        expires_at: playlist.lifecycle?.expires_at || null
      },
      warnings: build.complete
        ? mutation.warnings
        : [...mutation.warnings, `The temporary playlist has ${build.missing_count} fewer tracks than requested.`]
    };
  }

  promoteTemporaryPlaylist(input: {
    playlist_id: string;
    name?: string;
    description?: string;
  }): OperationResult {
    const playlist = this.context.playlistService.promoteTemporaryPlaylist(input.playlist_id, input);
    return completed(
      "roon_promote_temporary_playlist",
      "Temporary playlist saved as a permanent playlist.",
      playlist,
      { verified: true, references: { playlist_id: playlist.playlist_id } }
    );
  }

  async editPlaylistTracks(input: {
    playlist_id: string;
    operations: Array<Record<string, any>>;
    confirm?: boolean;
  }): Promise<OperationResult> {
    const destructiveOperations = input.operations.filter((operation) =>
      operation.type === "remove" || operation.type === "replace"
    );
    if (destructiveOperations.length > 0 && !input.confirm) {
      return {
        status: "confirmation_required",
        operation: "roon_edit_playlist_tracks",
        summary: "Removing or replacing playlist tracks requires confirm=true.",
        verified: false,
        data: {
          playlist_id: input.playlist_id,
          destructive_operations: destructiveOperations.map((operation) => operation.type)
        },
        references: {},
        warnings: []
      };
    }
    const acceptedCandidates: Array<Record<string, unknown>> = [];
    const omittedCandidates: Array<Record<string, unknown>> = [];
    for (const operation of input.operations) {
      if (operation.type === "add") {
        const prepared = await this.playlistBuildService.prepareCandidate(operation.track || operation.media);
        if (prepared.accepted) {
          const duplicate = typeof (this.context.playlistService as any).findDuplicateTrack === "function"
            ? (this.context.playlistService as any).findDuplicateTrack(input.playlist_id, prepared.track)
            : null;
          if (duplicate) {
            omittedCandidates.push({
              ...prepared.candidate,
              status: "duplicate",
              reason: "duplicate_existing_recording",
              existing_track_id: duplicate.track_id
            });
          } else {
            this.context.playlistService.addTrack(input.playlist_id, prepared.track);
            acceptedCandidates.push(prepared.candidate);
          }
        } else {
          omittedCandidates.push(prepared.rejection);
        }
      }
      else if (operation.type === "update") {
        const changes = operation.changes || {};
        if (changes.result_id) {
          this.materializePlaylistTrack(changes);
          const { result_id, ...metadataChanges } = changes;
          if (Object.keys(metadataChanges).length > 0) {
            this.context.playlistService.updateTrack(input.playlist_id, operation.track_id, metadataChanges);
          }
          this.context.playlistService.setTrackMatch(
            input.playlist_id,
            operation.track_id,
            result_id,
            {
              mediaService: this.context.mediaService,
              selectionReason: "selected_search_result",
              selectionOrigin: "model"
            }
          );
        } else {
          this.context.playlistService.updateTrack(input.playlist_id, operation.track_id, changes);
          await this.context.playlistService.resolveVirtualPlaylistItems(input.playlist_id, {
            mediaService: this.context.mediaService,
            logger: this.context.logger,
            trackIds: [operation.track_id],
            force: true
          });
        }
      }
      else if (operation.type === "remove") this.context.playlistService.removeTrack(input.playlist_id, operation.track_id);
      else if (operation.type === "reorder") this.context.playlistService.reorderTracks(input.playlist_id, operation.track_ids);
      else if (operation.type === "replace") {
        const build = await this.playlistBuildService.build({
          playlist_id: input.playlist_id,
          tracks: operation.tracks || []
        });
        acceptedCandidates.push(...build.accepted);
        omittedCandidates.push(...build.rejected, ...build.not_selected);
      }
      else throw new ApiError("INVALID_PLAYLIST_TRACK", "Unsupported playlist track operation", { type: operation.type });
    }
    const mutation = this.playlistMutationResult(
      "roon_edit_playlist_tracks",
      "Playlist track operations completed.",
      this.context.playlistService.getPlaylist(input.playlist_id)
    );
    return {
      ...mutation,
      data: {
        ...(mutation.data as Record<string, unknown>),
        edit_summary: {
          accepted: acceptedCandidates,
          omitted: omittedCandidates
        }
      },
      warnings: omittedCandidates.length > 0
        ? [...mutation.warnings, `${omittedCandidates.length} unresolved or unsafe track candidates were omitted.`]
        : mutation.warnings
    };
  }

  async setPlaylistCover(input: {
    playlist_id: string;
    image_file?: ToolFileReference;
    image_data_url?: string;
    image_base64?: string;
    content_type?: "image/jpeg" | "image/png" | "image/webp";
  }): Promise<OperationResult> {
    const downloaded = input.image_file
      ? await (this.context.downloadToolImage || ((file: ToolFileReference) =>
          downloadToolImage(file, { maximumBytes: MAX_CUSTOM_COVER_BYTES })))(input.image_file)
      : null;
    const data = await this.context.playlistService.setCustomCover(input.playlist_id, {
      data_url: downloaded ? undefined : input.image_data_url,
      image_base64: downloaded ? downloaded.bytes.toString("base64") : input.image_base64,
      content_type: downloaded ? downloaded.contentType : input.content_type
    });
    const coverId = typeof data.cover_image_key === "string" && data.cover_image_key.startsWith("custom:")
      ? data.cover_image_key.slice("custom:".length)
      : null;
    const coverVerification = coverId && typeof (this.context.playlistService as any).inspectCustomCover === "function"
      ? await (this.context.playlistService as any).inspectCustomCover(coverId)
      : { cover_image_key: data.cover_image_key };
    return completed("roon_set_playlist_cover", "Playlist cover image saved and verified.", {
      ...data,
      upload_source: downloaded ? "authorized_file" : "inline_base64",
      source_file: downloaded
        ? { file_id: downloaded.fileId, file_name: downloaded.fileName }
        : null,
      cover_verification: coverVerification
    }, { verified: true });
  }

  preparePlaylistCover(input: {
    playlist: { id?: string; name?: string };
  }): OperationResult {
    const playlist = this.context.playlistService.getPlaylistByReference(input.playlist);
    const trackContext = playlist.tracks.slice(0, 24).map((track) => ({
      position: track.position,
      title: track.audio_metadata?.title || track.title || track.query,
      artist: track.audio_metadata?.artist || track.artist || null,
      album: track.audio_metadata?.album || track.album || null
    }));
    return completed(
      "roon_prepare_playlist_cover",
      `Artwork requirements prepared for ${playlist.name}. Generate the image now, then upload it with roon_set_playlist_cover using image_file.`,
      {
        playlist: {
          playlist_id: playlist.playlist_id,
          name: playlist.name,
          description: playlist.description,
          track_count: playlist.track_count,
          current_cover_image_key: playlist.cover_image_key
        },
        generation_context: {
          tracks: trackContext,
          tracks_returned: trackContext.length,
          tracks_total: playlist.track_count
        },
        artwork_requirements: PLAYLIST_COVER_POLICY,
        required_next_steps: [
          "Generate one square cover from this playlist context and the user's requested style.",
          "Keep essential subjects and text centered inside an edge-safe area.",
          "Call roon_set_playlist_cover with playlist_id and image_file from the generated or attached image.",
          "Only report success when roon_set_playlist_cover returns status=completed and verified=true."
        ]
      },
      {
        verified: true,
        references: { playlist_id: playlist.playlist_id }
      }
    );
  }

  deletePlaylist(input: { playlist_id: string; confirm?: boolean }): OperationResult {
    if (!input.confirm) {
      return {
        status: "confirmation_required",
        operation: "roon_delete_playlist",
        summary: "Deleting a playlist requires confirm=true.",
        verified: false,
        data: { playlist_id: input.playlist_id },
        references: {},
        warnings: []
      };
    }
    return completed("roon_delete_playlist", "Playlist deleted.", this.context.playlistService.deletePlaylist(input.playlist_id), { verified: true });
  }

  async playPlaylist(input: {
    playlist_id: string;
    zone: TargetReference;
    mode?: "play_now" | "add_next" | "add_to_queue";
    limit?: number;
  }): Promise<OperationResult> {
    const zone = this.targets.zone(input.zone);
    const result = await this.context.playlistService.playPlaylist(
      this.context.roonClient,
      input.playlist_id,
      { zone_id: zone.zone_id, mode: input.mode || "play_now", limit: input.limit },
      { mediaService: this.context.mediaService, logger: this.context.logger, sourcePreference: "streaming_first" }
    );
    return normalizeServiceResult("roon_play_playlist", `Playlist sent to ${zone.display_name}.`, result, true);
  }

  async playPlaylistTrack(input: {
    playlist_id: string;
    track_id: string;
    zone: TargetReference;
    mode?: "play_now" | "add_next" | "add_to_queue";
  }): Promise<OperationResult> {
    const zone = this.targets.zone(input.zone);
    const result = await this.context.playlistService.playPlaylistTrack(
      this.context.roonClient,
      input.playlist_id,
      input.track_id,
      { zone_id: zone.zone_id, mode: input.mode || "play_now" },
      { mediaService: this.context.mediaService, logger: this.context.logger, sourcePreference: "streaming_first" }
    );
    return normalizeServiceResult("roon_play_playlist_track", `Playlist track sent to ${zone.display_name}.`, result, false);
  }

  async analyzePlaylist(input: {
    playlist_id: string;
    include_duplicates?: boolean;
    catalog_track_ids?: string[];
  }): Promise<OperationResult> {
    const validation = this.context.playlistService.validatePlaylist(input.playlist_id);
    const duplicates = input.include_duplicates
      ? this.context.playlistService.deduplicatePlaylist(input.playlist_id, { dry_run: true })
      : null;
    if (input.catalog_track_ids?.length && !this.context.playlistCatalogDiagnosticsService) {
      throw new ApiError("NOT_IMPLEMENTED", "MusicBrainz shadow diagnostics are not configured");
    }
    const catalogDiagnostics = input.catalog_track_ids?.length
      ? await this.context.playlistCatalogDiagnosticsService!.analyze(
          input.playlist_id,
          input.catalog_track_ids
        )
      : null;
    return completed(
      "roon_analyze_playlist",
      catalogDiagnostics
        ? `Playlist analysis and ${catalogDiagnostics.inspected_track_count} shadow catalog diagnostics completed.`
        : "Playlist analysis completed.",
      { validation, duplicates, catalog_diagnostics: catalogDiagnostics },
      { verified: true }
    );
  }

  async rebuildPlaylist(input: {
    job_id?: string;
    playlist_id?: string;
    track_ids?: string[];
    scope?: "issues" | "selected" | "all";
    selections?: Array<{ track_id: string; result_id: string }>;
  }): Promise<OperationResult> {
    if (input.job_id) {
      return this.rebuildJobResult(this.playlistRepairService.getRebuild(input.job_id));
    }
    if (!input.playlist_id) {
      throw new ApiError("INVALID_PLAYLIST", "playlist_id is required to start a reconstruction");
    }
    const manual: Array<Awaited<ReturnType<PlaylistRepairService["selectTrack"]>>> = [];
    for (const selection of input.selections || []) {
      manual.push(await this.playlistRepairService.selectTrack({
        playlistId: input.playlist_id,
        trackId: selection.track_id,
        resultId: selection.result_id,
        selectionReason: "explicit_model_selection",
        selectionOrigin: "model"
      }));
    }
    const manuallySelected = new Set((input.selections || []).map((entry) => entry.track_id));
    const selectedIds = input.scope === "selected"
      ? (input.track_ids || []).filter((trackId) => !manuallySelected.has(trackId))
      : undefined;
    const shouldResolve = input.scope !== "selected" || Boolean(selectedIds?.length);
    if (!shouldResolve) {
      const playlist = this.context.playlistService.getPlaylist(input.playlist_id);
      const result = this.playlistMutationResult(
        "roon_rebuild_playlist",
        "Playlist selections applied.",
        playlist
      );
      return {
        ...result,
        data: {
          ...(result.data as Record<string, unknown>),
          manual_selections: manual.map((entry) => ({
            track_id: entry.track.track_id,
            enrichment: entry.enrichment
          }))
        }
      };
    }
    const job = this.playlistRepairService.startRebuild({
      playlistId: input.playlist_id,
      trackIds: selectedIds,
      scope: input.scope || "issues",
      sourcePreference: "streaming_first"
    });
    const operation = this.rebuildJobResult(job);
    if (!manual.length) return operation;
    return {
      ...operation,
      data: {
        ...(operation.data as Record<string, unknown>),
        manual_selections: manual.map((entry) => ({
          track_id: entry.track.track_id,
          enrichment: entry.enrichment
        }))
      }
    };
  }

  private rebuildJobResult(job: ReturnType<PlaylistRepairService["getRebuild"]>): OperationResult {
    if (job.status === "failed") {
      return {
        status: "failed",
        operation: "roon_rebuild_playlist",
        summary: job.error?.message || "Playlist reconstruction failed.",
        verified: false,
        data: job,
        references: { job_id: job.job_id, playlist_id: job.playlist_id },
        warnings: [],
        error: job.error || {
          code: "INTERNAL_ERROR",
          message: "Playlist reconstruction failed.",
          details: {}
        }
      };
    }
    if (job.status !== "completed" || !job.result) {
      return {
        status: "in_progress",
        operation: "roon_rebuild_playlist",
        summary: job.progress.message,
        verified: false,
        data: job,
        references: { job_id: job.job_id, playlist_id: job.playlist_id },
        warnings: ["Reconstruction is still running; poll this same tool with job_id."]
      };
    }
    const data = job.result as Record<string, any>;
    const playlist = data.playlist;
    const jobSummary = { ...job, result: null };
    const result = this.playlistMutationResult(
      "roon_rebuild_playlist",
      "Playlist reconstruction completed.",
      playlist
    );
    return {
      ...result,
      data: {
        ...(result.data as Record<string, unknown>),
        reconstruction_job: jobSummary,
        resolution_attempts: data.resolution,
        metadata_enrichment: data.enrichment,
        reconstruction: data.report
      }
    };
  }

  private materializePlaylistTrack(input: unknown): unknown {
    if (!input || typeof input !== "object" || Array.isArray(input)) return input;
    const track = input as Record<string, any>;
    if (!track.result_id) return track;
    const result = this.context.mediaService.get(track.result_id);
    if (result.media_type !== "track" || !result.playable || !result.roon_item_key) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "result_id must reference a playable Roon track", {
        result_id: track.result_id,
        media_type: result.media_type,
        playable: result.playable
      });
    }
    return {
      ...track,
      query: track.query || [result.title, result.artist || result.subtitle].filter(Boolean).join(" "),
      roon_item_key: result.roon_item_key,
      title: track.title || result.title,
      artist: track.artist || result.artist || result.subtitle,
      album: track.album || result.album,
      image_key: track.image_key || result.image_key,
      duration_seconds: track.duration_seconds || result.duration_seconds,
      source: track.source || result.source,
      quality: track.quality || result.quality,
      resolution: {
        status: "manual",
        selected_result_id: result.result_id,
        selected_roon_item_key: result.roon_item_key,
        score: result.match_score,
        confidence: result.confidence,
        reason: "selected_search_result",
        selection_origin: "model",
        persistent_identity: "track_id",
        roon_item_key_persistent: false
      }
    };
  }

  exportPlaylist(input: { playlist_id: string; format?: "json" | "csv" | "m3u" }): OperationResult {
    return completed("roon_export_playlist", "Playlist exported.", this.context.playlistService.exportPlaylist(input.playlist_id, input.format || "json"), { verified: true });
  }

  importPlaylist(input: { payload: Record<string, unknown>; confirm?: boolean }): OperationResult {
    const preview = this.context.playlistService.importPlaylist({ ...input.payload, dry_run: true });
    if ((preview as any).would_update && !input.confirm) {
      return {
        status: "confirmation_required",
        operation: "roon_import_playlist",
        summary: "Importing this payload would replace an existing playlist and requires confirm=true.",
        verified: false,
        data: preview,
        references: {},
        warnings: []
      };
    }
    const data = this.context.playlistService.importPlaylist({
      ...input.payload,
      dry_run: false,
      confirm: Boolean(input.confirm)
    });
    return completed("roon_import_playlist", "Playlist imported.", data, { verified: true });
  }

  getConfiguration(input: { resource: "volume_limits" | "zone_presets"; id?: string }): OperationResult {
    const service = input.resource === "volume_limits" ? this.context.volumeLimitService : this.context.zonePresetService;
    const data = input.id ? service.get(input.id) : service.list();
    return completed("roon_get_configuration", `${input.resource} returned.`, data, { verified: true });
  }

  saveConfiguration(input: {
    resource: "volume_limit" | "zone_preset";
    id?: string;
    value: Record<string, unknown>;
  }): OperationResult {
    const data = input.resource === "volume_limit"
      ? input.id
        ? this.context.volumeLimitService.update(input.id, input.value)
        : this.context.volumeLimitService.create(input.value)
      : input.id
        ? this.context.zonePresetService.update(input.id, input.value)
        : this.context.zonePresetService.create(this.context.roonClient, input.value);
    return completed("roon_save_configuration", `${input.resource} saved.`, data, { verified: true });
  }

  deleteConfiguration(input: {
    resource: "volume_limit" | "zone_preset";
    id: string;
    confirm?: boolean;
  }): OperationResult {
    if (!input.confirm) {
      return {
        status: "confirmation_required",
        operation: "roon_delete_configuration",
        summary: "Deleting configuration requires confirm=true.",
        verified: false,
        data: input,
        references: {},
        warnings: []
      };
    }
    if (input.resource === "volume_limit") this.context.volumeLimitService.delete(input.id);
    else this.context.zonePresetService.delete(input.id);
    return completed("roon_delete_configuration", `${input.resource} deleted.`, { id: input.id }, { verified: true });
  }

  async applyZonePreset(input: { preset_id: string; confirm?: boolean }): Promise<OperationResult> {
    const result = await this.context.zonePresetService.apply(this.context.roonClient, input.preset_id, {
      confirm: Boolean(input.confirm),
      volumeLimitService: this.context.volumeLimitService
    });
    return normalizeServiceResult("roon_apply_zone_preset", "Zone preset applied.", result, true);
  }

  runDiagnostics(input: { include_logs?: boolean; include_actions?: boolean }): OperationResult {
    const state = {
      core_connected: this.context.roonClient.isCoreConnected(),
      core_name: this.context.roonClient.getCoreName(),
      transport_ready: this.context.roonClient.isTransportReady(),
      browse_ready: this.context.roonClient.isBrowseReady(),
      image_ready: this.context.roonClient.isImageReady(),
      zones_count: this.context.roonClient.getZones().length,
      outputs_count: this.context.roonClient.getOutputs().length
    };
    const data = {
      generated_at: new Date().toISOString(),
      app: { name: "RoonIA", version: APP_VERSION, mcp_generation: 2 },
      roon: state,
      capabilities: {
        intent_tools: 33,
        app_only_tools: 1,
        widgets_attached: true,
        semantic_zone_resolution: true,
        query_to_action: true,
        virtual_playlists: true,
        volume_limits: true,
        zone_presets: true
      },
      recent_errors: input.include_logs !== false
        ? ((this.context.technicalLogService?.errors(25) as any)?.errors || [])
        : [],
      recent_actions: input.include_actions !== false
        ? ((this.context.actionLogService?.list({ limit: 25 }) as any)?.actions || [])
        : []
    };
    const warnings = [
      !state.core_connected ? "Roon Core is not connected." : null,
      !state.transport_ready ? "Roon Transport is not ready." : null,
      !state.browse_ready ? "Roon Browse is not ready." : null
    ].filter(Boolean) as string[];
    return completed("roon_run_diagnostics", "Diagnostics bundle created.", data, {
      verified: true,
      warnings
    });
  }
}
