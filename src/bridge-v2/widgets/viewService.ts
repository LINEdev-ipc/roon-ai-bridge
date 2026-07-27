import { BridgeV2Context } from "../context";
import { TargetReference } from "../contracts";
import { TargetResolver } from "../targetResolver";
import { formatZone } from "../../roon/roonZoneService";
import { getQueueSnapshot, QueueItem } from "../../roon/roonQueueService";
import type { MediaResult, MediaType, SourcePreference } from "../../roon/roonMediaService";
import { ApiError } from "../../utils/errors";

export type WidgetView =
  | "now_playing"
  | "search_results"
  | "artist"
  | "album"
  | "track"
  | "playlist"
  | "playlist_library"
  | "queue"
  | "zones";

export type WidgetPayload = {
  widget_version: 3;
  view: WidgetView;
  title: string;
  generated_at: string;
  [key: string]: unknown;
};

function basePayload(view: WidgetView, title: string): WidgetPayload {
  return {
    widget_version: 3,
    view,
    title,
    generated_at: new Date().toISOString()
  };
}

function artwork(imageKey: unknown): { image_key: string | null; image_url: null } {
  return {
    image_key: typeof imageKey === "string" && imageKey ? imageKey : null,
    image_url: null
  };
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class WidgetV2ViewService {
  private readonly targets: TargetResolver;

  constructor(private readonly context: BridgeV2Context) {
    this.targets = new TargetResolver(context.roonClient);
  }

  nowPlaying(input: { zone?: TargetReference } = {}): WidgetPayload {
    const requestedZone = input.zone ? this.targets.zone(input.zone) : null;
    const candidates = requestedZone ? [requestedZone] : this.context.roonClient.getZones();
    const zones = candidates
      .filter((zone) => {
        const nowPlaying = zone.now_playing;
        const lines = nowPlaying?.three_line;
        return zone.state === "playing" && Boolean(
          nowPlaying?.image_key || lines?.line1 || lines?.line2 || lines?.line3
        );
      })
      .map((zone) => {
        const formatted = formatZone(zone);
        return {
          zone_id: formatted.zone_id,
          name: formatted.display_name,
          media: {
            title: formatted.now_playing.line1,
            artist: formatted.now_playing.line2,
            album: formatted.now_playing.line3,
            ...artwork(formatted.now_playing.image_key)
          },
          outputs: formatted.outputs.map((output) => ({
            output_id: output.output_id,
            name: output.display_name,
            volume: output.volume
              ? {
                  value: output.volume.value ?? null,
                  type: output.volume.type ?? null,
                  muted: Boolean(output.volume.is_muted)
                }
              : null
          }))
        };
      });

    return {
      ...basePayload("now_playing", requestedZone ? requestedZone.display_name : "Ahora suena"),
      requested_zone: requestedZone
        ? { zone_id: requestedZone.zone_id, name: requestedZone.display_name }
        : null,
      zones
    };
  }

  async media(input: {
    query?: string;
    result_id?: string;
    types?: MediaType[];
    count?: number;
    source_preference?: SourcePreference;
  }): Promise<WidgetPayload> {
    if (input.result_id) return this.mediaEntity(input.result_id, input.count);
    const query = input.query?.trim();
    if (!query) throw new ApiError("VALIDATION_ERROR", "query or result_id is required");

    const result = await this.context.mediaService.search({
      query,
      types: input.types,
      count: input.count ?? 12,
      sourcePreference: input.source_preference ?? "highest_quality"
    });
    const explicitType = input.types?.length === 1 ? input.types[0] : null;
    const recommended = result.recommended_result_id
      ? result.results.find((item) => item.result_id === result.recommended_result_id)
      : null;
    if (
      explicitType &&
      explicitType !== "playlist" &&
      recommended?.media_type === explicitType &&
      !result.ambiguous &&
      !result.selection_required
    ) {
      return this.mediaEntity(recommended.result_id, input.count);
    }
    const cards = result.results.map((item) => this.mediaCard(item));
    return {
      ...basePayload("search_results", `Resultados para “${query}”`),
      query,
      results: cards,
      best_match: result.best_match ? this.mediaCard(result.best_match) : cards.find((item) => item.is_best_match) || cards[0] || null,
      groups: result.groups
        ? Object.fromEntries(Object.entries(result.groups).map(([key,items]) => [key,items.map((item) => this.mediaCard(item))]))
        : this.groupCards(cards),
      ambiguous: result.ambiguous,
      warnings: result.warnings || []
    };
  }

  playlist(input: {
    playlist: { id?: string; name?: string };
    limit?: number;
    offset?: number;
  }): WidgetPayload {
    const playlistId = this.resolvePlaylistId(input.playlist);
    const detail = this.context.playlistService.getPlaylistDetail(playlistId, {
      includeTracks: true,
      limit: input.limit ?? 50,
      offset: input.offset ?? 0
    });
    const tracks = detail.tracks || [];
    const coverKey = detail.cover_image_key || tracks.find((track) => track.image_key)?.image_key || null;
    return {
      ...basePayload("playlist", detail.name),
      playlist: {
        playlist_id: detail.playlist_id,
        name: detail.name,
        description: detail.description,
        track_count: detail.track_count,
        ...artwork(coverKey)
      },
      tracks: tracks.map((track) => ({
        track_id: track.track_id,
        position: track.position,
        title: track.audio_metadata?.title || track.title || track.query,
        artist: track.audio_metadata?.artist || track.artist,
        album: track.audio_metadata?.album || track.album,
        duration_seconds: track.audio_metadata?.duration_seconds ?? null,
        ...artwork(track.image_key)
      })),
      pagination: {
        offset: input.offset ?? 0,
        returned: tracks.length,
        total: detail.track_count,
        has_more: detail.has_more
      }
    };
  }

  playlistLibrary(input: { limit?: number; offset?: number } = {}): WidgetPayload {
    const limit = input.limit ?? 24;
    const offset = input.offset ?? 0;
    const result = this.context.playlistService.listPlaylists({
      scope: "saved",
      includeTracks: true,
      trackLimit: 1,
      trackOffset: 0,
      limit,
      offset
    });
    return {
      ...basePayload("playlist_library", "Biblioteca de playlists"),
      playlists: result.playlists.map((playlist) => {
        const firstTrack = playlist.tracks?.[0];
        return {
          playlist_id: playlist.playlist_id,
          name: playlist.name,
          description: playlist.description,
          track_count: playlist.track_count,
          total_duration_seconds: playlist.total_duration_seconds,
          duration_known_track_count: playlist.duration_known_track_count,
          last_played_at: playlist.last_played_at,
          updated_at: playlist.updated_at,
          ...artwork(playlist.cover_image_key || firstTrack?.image_key || null)
        };
      }),
      pagination: {
        offset: result.offset,
        returned: result.playlists.length,
        total: result.total,
        has_more: result.offset + result.playlists.length < result.total
      }
    };
  }

  async queue(input: { zone: TargetReference; count?: number }): Promise<WidgetPayload> {
    const zone = this.targets.zone(input.zone);
    const formatted = formatZone(zone);
    const snapshot = await getQueueSnapshot(
      this.context.roonClient,
      zone.zone_id,
      input.count ?? 30
    );
    const items = snapshot.items.map((item, index) => this.queueItem(item, index));
    const knownDurations = items
      .map((item) => item.duration_seconds)
      .filter((value): value is number => typeof value === "number");
    return {
      ...basePayload("queue", `A continuación · ${formatted.display_name}`),
      zone: {
        zone_id: formatted.zone_id,
        name: formatted.display_name,
        state: formatted.state,
        now_playing: {
          title: formatted.now_playing.line1,
          artist: formatted.now_playing.line2,
          album: formatted.now_playing.line3,
          seek_position: formatted.now_playing.seek_position,
          length: formatted.now_playing.length,
          ...artwork(formatted.now_playing.image_key)
        }
      },
      items,
      total_duration_seconds: knownDurations.length
        ? knownDurations.reduce((sum, value) => sum + value, 0)
        : null,
      duration_known_item_count: knownDurations.length,
      returned: items.length,
      truncated: snapshot.items.length >= snapshot.max_item_count
    };
  }

  zones(): WidgetPayload {
    const stateOrder: Record<string, number> = {
      playing: 0,
      loading: 1,
      paused: 2,
      stopped: 3
    };
    const zones = this.context.roonClient.getZones()
      .map((zone) => {
        const formatted = formatZone(zone);
        return {
          zone_id: formatted.zone_id,
          name: formatted.display_name,
          state: formatted.state,
          media: {
            title: formatted.now_playing.line1,
            artist: formatted.now_playing.line2,
            album: formatted.now_playing.line3,
            seek_position: formatted.now_playing.seek_position,
            length: formatted.now_playing.length,
            ...artwork(formatted.now_playing.image_key)
          },
          outputs: formatted.outputs.map((output) => {
            const activeLimit = this.context.volumeLimitService?.findActiveLimit(zone, output) || null;
            return {
              output_id: output.output_id,
              name: output.display_name,
              volume: output.volume
                ? {
                    value: output.volume.value ?? null,
                    type: output.volume.type ?? null,
                    min: output.volume.min ?? null,
                    max: output.volume.max ?? null,
                    muted: Boolean(output.volume.is_muted)
                  }
                : null,
              safe_limit: activeLimit
                ? { limit_id: activeLimit.limit_id, name: activeLimit.name, safe_max: activeLimit.safe_max }
                : null
            };
          }),
          playback_settings: formatted.playback_settings
        };
      })
      .sort((left, right) =>
        (stateOrder[left.state] ?? 9) - (stateOrder[right.state] ?? 9) ||
        left.name.localeCompare(right.name, "es")
      );
    const states = zones.reduce<Record<string, number>>((counts, zone) => {
      counts[zone.state] = (counts[zone.state] || 0) + 1;
      return counts;
    }, {});
    return {
      ...basePayload("zones", "Panel de zonas"),
      core: {
        name: this.context.roonClient.getCoreName(),
        connected: this.context.roonClient.isCoreConnected(),
        transport_ready: this.context.roonClient.isTransportReady()
      },
      zone_count: zones.length,
      states,
      zones
    };
  }

  private async mediaEntity(resultId: string, count = 50): Promise<WidgetPayload> {
    const media = this.context.mediaService.get(resultId);
    if (media.media_type === "artist") {
      const detail = await this.context.mediaService.getArtistDetail(resultId, undefined, count);
      const eps = detail.singles_eps.filter((item) => item.release_type === "ep");
      const singles = detail.singles_eps.filter((item) => item.release_type === "single");
      const mixedReleases = detail.singles_eps.filter((item) => !["ep", "single"].includes(item.release_type || ""));
      return {
        ...basePayload("artist", detail.artist.title),
        artist: this.mediaCard(detail.artist),
        popular_tracks: detail.popular_tracks.map((item) => this.mediaCard(item)),
        albums: detail.albums.map((item) => this.mediaCard(item)),
        singles_eps: detail.singles_eps.map((item) => this.mediaCard(item)),
        eps: eps.map((item) => this.mediaCard(item)),
        singles: singles.map((item) => this.mediaCard(item)),
        mixed_releases: mixedReleases.map((item) => this.mediaCard(item)),
        warnings: detail.warnings || []
      };
    }
    if (media.media_type === "album") {
      const detail = await this.context.mediaService.getAlbumDetail(resultId, undefined, Math.max(count, 100));
      return {
        ...basePayload("album", detail.album.title),
        album: this.mediaCard(detail.album),
        description: detail.description,
        tracks: detail.tracks.map((item) => this.mediaCard(item)),
        warnings: detail.warnings || []
      };
    }
    const catalog = this.context.trackCatalogService
      ? await this.context.trackCatalogService.describeRoonTrack(media)
      : null;
    return {
      ...basePayload("track", media.title),
      track: this.mediaCard(media),
      catalog,
      warnings: Array.from(new Set([
        ...(media.warnings || []),
        ...(catalog?.status === "provider_error" ? ["No se pudieron recuperar los metadatos de MusicBrainz."] : [])
      ]))
    };
  }

  private mediaCard(media: MediaResult): Record<string, unknown> {
    return {
      result_id: media.result_id,
      media_type: media.media_type,
      title: media.title,
      artist: media.artist,
      artists: media.artists,
      album: media.album,
      album_artist: media.album_artist,
      subtitle: media.subtitle,
      release_year: media.release_year ?? null,
      duration_seconds: media.duration_seconds ?? null,
      track_number: media.track_number ?? null,
      disc_number: media.disc_number ?? null,
      source: media.source,
      quality: media.quality,
      release_type: media.release_type,
      release_type_source: media.release_type_source,
      direct_match: media.direct_match,
      is_best_match: media.is_best_match,
      links: media.links,
      ...artwork(media.image_key)
    };
  }

  private queueItem(item: QueueItem, index: number): Record<string, unknown> {
    const raw = item as Record<string, unknown>;
    return {
      queue_item_id: item.queue_item_id ?? null,
      position: index + 1,
      title: optionalString(item.title) || "Sin título",
      artist: optionalString(raw.artist) || optionalString(item.subtitle),
      album: optionalString(raw.album),
      subtitle: optionalString(item.subtitle),
      duration_seconds: optionalNumber(raw.duration_seconds) ?? optionalNumber(raw.length),
      ...artwork(item.image_key)
    };
  }

  private groupCards(cards: Array<Record<string, unknown>>): Record<string, Array<Record<string, unknown>>> {
    const groups: Record<string, Array<Record<string, unknown>>> = {
      artist: [], album: [], ep: [], single_ep: [], single: [], track: [], playlist: []
    };
    for (const card of cards) {
      const releaseType = String(card.release_type || "");
      const key = card.media_type === "album" && ["ep", "single_ep", "single"].includes(releaseType)
        ? releaseType
        : String(card.media_type || "track");
      (groups[key] || groups.track).push(card);
    }
    return groups;
  }

  private resolvePlaylistId(ref: { id?: string; name?: string }): string {
    if (ref?.id) return ref.id;
    const wanted = normalize(ref?.name || "");
    if (!wanted) throw new ApiError("VALIDATION_ERROR", "playlist requires id or name");
    const result = this.context.playlistService.listPlaylists({ limit: 100, offset: 0 });
    const matches = result.playlists.filter((playlist) => normalize(playlist.name) === wanted);
    if (matches.length === 1) return matches[0].playlist_id;
    if (matches.length > 1) {
      throw new ApiError("AMBIGUOUS_MATCH", "Several playlists have the requested name", {
        candidates: matches.map((playlist) => ({ id: playlist.playlist_id, name: playlist.name }))
      });
    }
    throw new ApiError("PLAYLIST_NOT_FOUND", "Virtual playlist not found", { requested: ref });
  }
}
