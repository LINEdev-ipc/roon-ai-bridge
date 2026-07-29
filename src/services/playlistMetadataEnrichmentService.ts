import { splitArtistCredit, type MediaResult, type RoonMediaService, type SourcePreference, type VersionHint } from "../roon/roonMediaService";
import type { Logger } from "../utils/logger";
import { ApiError } from "../utils/errors";
import type {
  AudioMetadata,
  PlaylistRecordingMetadata,
  PlaylistReleaseMetadata,
  VirtualPlaylistTrack
} from "./playlists/playlistContracts";
import {
  audioMetadataFromMedia,
  mergeMediaResult,
  metadataCompleteness,
  replaceCatalogAudioMetadata,
  type MetadataCompleteness,
  type PlaylistMetadataStatus
} from "./playlists/playlistMetadataPolicy";
import { PlaylistService, type VirtualPlaylistResolutionStatus } from "./playlistService";
import {
  RecordingMetadataService,
  type RecordingCatalogCandidate,
  type RecordingCatalogMetadata
} from "./recordingMetadataService";
import type { TrackCatalogProfile } from "./trackCatalogService";
import { TrackResolutionService } from "./trackResolutionService";
import {
  applyCatalogMetadata,
  catalogArtistCredit,
  catalogProfileFromAudio
} from "./playlists/catalogMetadata";

type FieldProvenance = Record<string, {
  source: "roon" | "musicbrainz";
  confidence: "high" | "medium" | "low";
}>;

export type MetadataEnrichmentReport = {
  status: "completed" | "partial" | "skipped" | "failed";
  metadata_status: PlaylistMetadataStatus;
  observed_at: string;
  source_result_id: string | null;
  album_result_id: string | null;
  completeness: MetadataCompleteness;
  recording: PlaylistRecordingMetadata | null;
  release: PlaylistReleaseMetadata | null;
  field_provenance: FieldProvenance;
  conflicts: Array<{ type: string; message: string; candidates?: RecordingCatalogCandidate[] }>;
  warnings: string[];
};

export type EnrichedMediaResult = {
  result: MediaResult;
  audio_metadata: AudioMetadata;
  report: MetadataEnrichmentReport;
};

export type PlaylistMetadataRefreshResult = {
  playlist_id: string;
  attempted: number;
  completed: number;
  partial: number;
  skipped: number;
  failed: number;
  conflict: number;
  unverified: number;
  tracks: Array<{ track_id: string; report: MetadataEnrichmentReport }>;
  playlist: ReturnType<PlaylistService["getPlaylist"]>;
};

function normalize(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sameText(left: unknown, right: unknown): boolean {
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && a === b);
}

function canonicalTrackTitle(value: unknown): string {
  return normalize(value)
    .replace(/\b(?:lp|album|single) version\b/g, " ")
    .replace(/\bremaster(?:ed)?\b(?:\s+(?:19|20)\d{2})?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameRecordingTitle(left: unknown, right: unknown): boolean {
  const a = canonicalTrackTitle(left);
  const b = canonicalTrackTitle(right);
  return Boolean(a && b && a === b);
}

type VersionFamily = "live" | "remix" | "edit" | "demo" | "alternate" | "immersive" | "remaster" | "studio";

function versionFamily(title: unknown, hint?: unknown): VersionFamily {
  const value = normalize([title, hint].filter(Boolean).join(" "));
  if (/\b(?:live|concert|en vivo|directo)\b/.test(value)) return "live";
  if (/\bremix\b/.test(value)) return "remix";
  if (/\b(?:radio edit|single edit|edit)\b/.test(value)) return "edit";
  if (/\b(?:demo|session|take)\b/.test(value)) return "demo";
  if (/\b(?:atmos|5 1|binaural|3d)\b/.test(value)) return "immersive";
  if (/\b(?:alternate|alternative)\b/.test(value)) return "alternate";
  if (/\bremaster(?:ed)?\b/.test(value)) return "remaster";
  return "studio";
}

function versionCompatible(candidate: MediaResult, source: MediaResult): boolean {
  const expected = versionFamily(source.title, source.version_hint);
  const actual = versionFamily(candidate.title, candidate.version_hint);
  if (expected === actual) return true;
  if (expected === "studio" && /\b(?:lp|album) version\b/i.test(candidate.title)) return true;
  if (expected === "remaster" && actual === "studio") {
    const expectedYear = normalize(source.title).match(/\b(?:19|20)\d{2}\b/)?.[0];
    return Boolean(expectedYear && normalize(candidate.title).includes(expectedYear));
  }
  return false;
}

function artistMatches(track: { artist?: unknown; subtitle?: unknown }, artist: unknown): boolean {
  const expected = normalize(artist);
  if (!expected) return true;
  const actual = normalize(track.artist || track.subtitle);
  return Boolean(actual && (actual.includes(expected) || expected.includes(actual)));
}

function resolutionStatus(track: VirtualPlaylistTrack): VirtualPlaylistResolutionStatus {
  const status = track.resolution?.status;
  return ["resolved", "stale", "ambiguous", "manual", "missing", "error"].includes(String(status))
    ? status as VirtualPlaylistResolutionStatus
    : track.roon_item_key ? "stale" : "missing";
}

function sourceConfidence(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "medium" ? value : "low";
}

function recordingSnapshot(metadata: RecordingCatalogMetadata): PlaylistRecordingMetadata {
  return {
    musicbrainz_id: metadata.recording_id,
    title: metadata.title,
    artist: metadata.artist,
    disambiguation: metadata.disambiguation,
    duration_seconds: metadata.duration_seconds,
    isrcs: metadata.isrcs,
    composers: metadata.composers,
    lyricists: metadata.lyricists,
    genres: metadata.genres,
    confidence: metadata.confidence
  };
}

export class PlaylistMetadataEnrichmentService {
  private readonly activeTrackRefreshes = new Map<string, Promise<{ track: VirtualPlaylistTrack; report: MetadataEnrichmentReport }>>();
  private readonly artistReleaseCache = new Map<string, { expiresAt: number; promise: Promise<MediaResult[]> }>();
  private readonly albumDetailCache = new Map<string, {
    expiresAt: number;
    promise: Promise<Awaited<ReturnType<RoonMediaService["getAlbumDetail"]>>>;
  }>();

  constructor(
    private readonly playlistService: PlaylistService,
    private readonly mediaService: RoonMediaService,
    private readonly logger?: Logger,
    private readonly sourcePreference: SourcePreference = "streaming_first",
    private readonly recordingMetadataService?: RecordingMetadataService
  ) {}

  private async verifiedRelease(
    source: MediaResult,
    albumResultId: string
  ): Promise<{
    result: MediaResult;
    release: PlaylistReleaseMetadata;
    warnings: string[];
  } | null> {
    const detail = await this.loadAlbumDetail(albumResultId);
    const matched = [...(detail.tracks || []), ...(detail.related_tracks || [])].find((candidate) =>
      sameRecordingTitle(candidate.title, source.title) &&
      artistMatches(candidate, source.artist) &&
      versionCompatible(candidate, source)
    ) || null;
    if (!matched) return null;
    const releaseImage = detail.album.image_key || matched.image_key || null;
    if (source.image_key && releaseImage && source.image_key !== releaseImage) return null;
    const merged = mergeMediaResult(mergeMediaResult(source, matched), {
      album: detail.album.title,
      album_artist: detail.album.album_artist || detail.album.artist,
      release_year: matched.release_year || detail.album.release_year,
      track_number: matched.track_number,
      disc_number: matched.disc_number,
      source: matched.source !== "unknown" ? matched.source : detail.album.source,
      source_confidence: matched.source !== "unknown"
        ? matched.source_confidence
        : detail.album.source_confidence,
      image_key: source.image_key || releaseImage
    });
    return {
      result: merged,
      release: {
        title: detail.album.title,
        album_artist: detail.album.album_artist || detail.album.artist,
        image_key: releaseImage,
        source: merged.source === "unknown" ? null : merged.source,
        source_confidence: merged.source === "unknown" ? null : merged.source_confidence,
        release_year: merged.release_year || null,
        original_release_year: null,
        track_number: merged.track_number || null,
        disc_number: merged.disc_number || null,
        release_type: detail.album.release_type || null,
        verified_by: "roon_album_membership_and_cover",
        confidence: "high"
      },
      warnings: detail.warnings || []
    };
  }

  rememberAlbumDetail(
    albumResultId: string,
    detail: Awaited<ReturnType<RoonMediaService["getAlbumDetail"]>>
  ): void {
    this.albumDetailCache.set(albumResultId, {
      expiresAt: Date.now() + 10 * 60 * 1000,
      promise: Promise.resolve(detail)
    });
  }

  private async loadAlbumDetail(
    albumResultId: string
  ): Promise<Awaited<ReturnType<RoonMediaService["getAlbumDetail"]>>> {
    const cached = this.albumDetailCache.get(albumResultId);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const pending = this.mediaService.getAlbumDetail(albumResultId, undefined, 500);
    const entry = {
      expiresAt: Date.now() + 10 * 60 * 1000,
      promise: pending
    };
    this.albumDetailCache.set(albumResultId, entry);
    try {
      return await pending;
    } catch (error) {
      if (this.albumDetailCache.get(albumResultId) === entry) {
        this.albumDetailCache.delete(albumResultId);
      }
      throw error;
    }
  }

  async enrichResult(
    source: MediaResult,
    hints: {
      title?: string | null;
      artist?: string | null;
      album?: string | null;
      catalog_profile?: TrackCatalogProfile | null;
      verify_release?: boolean;
    } = {}
  ): Promise<EnrichedMediaResult> {
    const observedAt = new Date().toISOString();
    const warnings: string[] = [];
    const conflicts: MetadataEnrichmentReport["conflicts"] = [];
    const provenance: FieldProvenance = {
      title: { source: "roon", confidence: "high" },
      artist: { source: "roon", confidence: source.confidence || "medium" },
      image_key: { source: "roon", confidence: source.image_key ? "high" : "low" },
      version_hint: { source: "roon", confidence: "medium" }
    };
    let result = source;
    let albumResultId = result.links?.album?.result_id || null;
    let release: PlaylistReleaseMetadata | null = null;
    const verifyRoonRelease = !hints.catalog_profile || hints.verify_release === true;

    // A catalog profile normally supplies the canonical release and recording.
    // Exact recording families opt back into Roon release navigation because
    // the observed album is binding evidence, not canonical metadata.
    if (verifyRoonRelease && albumResultId) {
      try {
        const verified = await this.verifiedRelease(source, albumResultId);
        if (verified) {
          result = verified.result;
          release = verified.release;
          warnings.push(...verified.warnings);
        }
      } catch (error) {
        warnings.push(`album_detail_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (verifyRoonRelease && !release && typeof this.mediaService.getTrackMetadata === "function") {
      try {
        const detail = await this.mediaService.getTrackMetadata(source.result_id);
        const detailAlbumId = detail.links?.album?.result_id || albumResultId;
        let verified: Awaited<ReturnType<PlaylistMetadataEnrichmentService["verifiedRelease"]>> = null;
        if (detailAlbumId) {
          try {
            verified = await this.verifiedRelease(source, detailAlbumId);
          } catch (error) {
            warnings.push(`album_detail_failed:${error instanceof Error ? error.message : String(error)}`);
          }
          if (verified) {
            result = verified.result;
            release = verified.release;
            albumResultId = detailAlbumId;
            warnings.push(...verified.warnings);
          }
        }
        if (!verified && detail.album && (!source.image_key || !detail.image_key || source.image_key === detail.image_key) && versionCompatible(detail, source)) {
          result = mergeMediaResult(result, detail);
          release = {
            title: detail.album,
            album_artist: detail.album_artist || detail.artist,
            image_key: detail.image_key || source.image_key,
            source: detail.source === "unknown" ? null : detail.source,
            source_confidence: detail.source === "unknown" ? null : detail.source_confidence,
            release_year: detail.release_year || null,
            original_release_year: null,
            track_number: detail.track_number || null,
            disc_number: detail.disc_number || null,
            release_type: detail.release_type || null,
            verified_by: "roon_direct_album_navigation",
            confidence: "high"
          };
        }
      } catch (error) {
        warnings.push(`track_detail_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const requestedAlbum = result.album || hints.album || null;
    if (verifyRoonRelease && !release && requestedAlbum) {
      try {
        const requestedArtist = source.album_artist || hints.artist || source.artist;
        const search = await this.mediaService.search({
          query: [requestedAlbum, requestedArtist].filter(Boolean).join(" "),
          types: ["album"],
          count: 10,
          sourcePreference: this.sourcePreference
        });
        const exact = search.results.find((candidate) =>
          candidate.media_type === "album" &&
          sameText(candidate.title, requestedAlbum) &&
          artistMatches(candidate, requestedArtist)
        );
        if (exact) {
          const verified = await this.verifiedRelease(source, exact.result_id);
          if (verified) {
            result = verified.result;
            release = verified.release;
            albumResultId = exact.result_id;
            warnings.push(...verified.warnings);
          }
        }
      } catch (error) {
        warnings.push(`album_search_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (verifyRoonRelease && !release && source.image_key) {
      try {
        const artistHints = Array.from(new Map([
          ...splitArtistCredit(hints.artist),
          ...splitArtistCredit(source.album_artist),
          ...(source.artists || []).map((artist) => artist.title),
          ...splitArtistCredit(source.artist)
        ].filter(Boolean).map((artist) => [normalize(artist), artist])).values()).slice(0, 5);
        for (const artistHint of artistHints) {
          const artistSearch = await this.mediaService.search({
            query: artistHint,
            types: ["artist"],
            count: 10,
            sourcePreference: this.sourcePreference
          });
          const artist = artistSearch.results.find((candidate) =>
            candidate.media_type === "artist" && sameText(candidate.title, artistHint)
          );
          if (!artist) continue;
          const releases = await this.loadArtistReleases(artist.result_id, artistHint);
          const matchingCovers = releases.filter((candidate) => candidate.image_key === source.image_key);
          for (const candidate of matchingCovers) {
            const verified = await this.verifiedRelease(source, candidate.result_id);
            if (!verified) continue;
            result = verified.result;
            release = verified.release;
            albumResultId = candidate.result_id;
            warnings.push(...verified.warnings);
            break;
          }
          if (release) break;
        }
      } catch (error) {
        warnings.push(`artist_catalog_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (verifyRoonRelease && !release && requestedAlbum) {
      conflicts.push({
        type: "release_mismatch",
        message: "The requested album could not be verified against the selected Roon track and artwork."
      });
    }

    let recording: PlaylistRecordingMetadata | null = null;
    let external: RecordingCatalogMetadata | null = null;
    const title = result.title || hints.title || null;
    const artist = release?.album_artist || result.album_artist || result.artists?.[0]?.title ||
      splitArtistCredit(hints.artist || result.artist)[0] || null;
    const resultIsrc = typeof (result as MediaResult & { isrc?: unknown }).isrc === "string"
      ? String((result as MediaResult & { isrc?: string }).isrc)
      : null;
    if (!hints.catalog_profile && this.recordingMetadataService && title && artist) {
      try {
        const resolved = await this.recordingMetadataService.lookup({
          title,
          artist,
          album: release?.title || null,
          version_hint: result.version_hint,
          isrc: resultIsrc,
          duration_seconds: result.duration_seconds || null
        });
        if (resolved.status === "conflict") {
          conflicts.push({
            type: "recording_conflict",
            message: "Several MusicBrainz recordings remain compatible with the selected Roon track.",
            candidates: resolved.candidates
          });
        } else if (resolved.status === "exact" && resolved.metadata) {
          if (release || resultIsrc) {
            external = resolved.metadata;
            recording = recordingSnapshot(external);
          } else {
            warnings.push("musicbrainz_exact_but_unanchored");
          }
        } else {
          warnings.push("musicbrainz_recording_not_found");
        }
      } catch (error) {
        warnings.push(`musicbrainz_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    let audio = audioMetadataFromMedia(result as MediaResult & Record<string, unknown>);
    if (release) {
      audio.album = release.title;
      audio.album_artist = release.album_artist;
      audio.release_year = release.release_year;
      audio.track_number = release.track_number;
      audio.disc_number = release.disc_number;
      if (release.source) {
        audio.source = release.source;
        audio.source_confidence = release.source_confidence;
      }
      audio.release = release;
      for (const field of ["album", "album_artist", "release_year", "track_number", "disc_number", "source"]) {
        if (audio[field] !== null && audio[field] !== undefined && audio[field] !== "") {
          provenance[field] = { source: "roon", confidence: release.confidence };
        }
      }
    } else {
      delete audio.album;
      delete audio.album_artist;
      delete audio.release_year;
      delete audio.track_number;
      delete audio.disc_number;
    }
    if (external && recording) {
      if (!audio.duration_seconds && external.duration_seconds) {
        audio.duration_seconds = external.duration_seconds;
        provenance.duration_seconds = { source: "musicbrainz", confidence: external.confidence };
      }
      if (!audio.release_year && external.release_year) {
        audio.release_year = external.release_year;
        provenance.release_year = { source: "musicbrainz", confidence: external.confidence };
      }
      if (external.original_release_year) {
        audio.original_release_year = external.original_release_year;
        provenance.original_release_year = { source: "musicbrainz", confidence: external.confidence };
      }
      if (external.isrc) {
        audio.isrc = external.isrc;
        provenance.isrc = { source: "musicbrainz", confidence: external.confidence };
      }
      audio.isrcs = external.isrcs;
      audio.composers = external.composers;
      audio.composer = external.composers.join(", ");
      audio.lyricists = external.lyricists;
      audio.genres = external.genres;
      audio.genre = external.genres.join(", ");
      audio.recording = recording;
      for (const field of ["isrcs", "composers", "lyricists", "genres"]) {
        if (audio[field] !== null && audio[field] !== undefined && audio[field] !== "") {
          provenance[field] = { source: "musicbrainz", confidence: external.confidence };
        }
      }
      if (release && external.release_year && !release.release_year) release.release_year = external.release_year;
      if (release && external.original_release_year) release.original_release_year = external.original_release_year;
    }
    const profile = hints.catalog_profile;
    const profileRecording = profile?.recording;
    if (profile && profileRecording) {
      const canonicalArtist = catalogArtistCredit(profile);
      recording = {
        musicbrainz_id: profileRecording.musicbrainz_id,
        title: profileRecording.title,
        artist: canonicalArtist,
        disambiguation: profileRecording.disambiguation,
        duration_seconds: profileRecording.duration_seconds,
        isrcs: profileRecording.isrcs,
        composers: profile.composers,
        lyricists: profile.lyricists,
        genres: profile.genres.map((genre) => genre.name),
        confidence: "high"
      };
      audio = applyCatalogMetadata(audio, profile);
      warnings.push(...profile.warnings);
    }

    const completeness = metadataCompleteness(audio);
    const metadataStatus: PlaylistMetadataStatus = conflicts.length
      ? "conflict"
      : completeness.complete && (
          profileRecording
            ? Boolean(recording?.duration_seconds)
            : Boolean(release && (result.duration_seconds || recording?.duration_seconds))
        )
        ? "exact"
        : release || recording
          ? "partial"
          : "unverified";
    audio.metadata_status = metadataStatus;
    audio.field_provenance = provenance;
    if (!release && !hints.catalog_profile?.release_group) warnings.push("release_reference_unavailable");
    const report: MetadataEnrichmentReport = {
      status: metadataStatus === "exact" ? "completed" : "partial",
      metadata_status: metadataStatus,
      observed_at: observedAt,
      source_result_id: source.result_id || null,
      album_result_id: albumResultId,
      completeness,
      recording,
      release,
      field_provenance: provenance,
      conflicts,
      warnings: Array.from(new Set(warnings))
    };
    return { result, audio_metadata: audio, report };
  }

  private async loadArtistReleases(resultId: string, artist: string): Promise<MediaResult[]> {
    const key = normalize(artist);
    const cached = this.artistReleaseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const pending = this.mediaService.listArtistReleases(resultId, undefined, 200)
      .then((result) => result.releases);
    const entry = { expiresAt: Date.now() + 10 * 60 * 1000, promise: pending };
    this.artistReleaseCache.set(key, entry);
    try {
      return await pending;
    } catch (error) {
      if (this.artistReleaseCache.get(key) === entry) this.artistReleaseCache.delete(key);
      throw error;
    }
  }

  async refreshTrack(
    playlistId: string,
    trackId: string,
    options: { result?: MediaResult; sourcePreference?: SourcePreference } = {}
  ): Promise<{ track: VirtualPlaylistTrack; report: MetadataEnrichmentReport }> {
    const refreshKey = `${playlistId}:${trackId}`;
    const active = this.activeTrackRefreshes.get(refreshKey);
    if (active) return active;
    const pending = this.refreshTrackOnce(playlistId, trackId, options);
    this.activeTrackRefreshes.set(refreshKey, pending);
    try {
      return await pending;
    } finally {
      if (this.activeTrackRefreshes.get(refreshKey) === pending) this.activeTrackRefreshes.delete(refreshKey);
    }
  }

  private async refreshTrackOnce(
    playlistId: string,
    trackId: string,
    options: { result?: MediaResult; sourcePreference?: SourcePreference } = {}
  ): Promise<{ track: VirtualPlaylistTrack; report: MetadataEnrichmentReport }> {
    const playlist = this.playlistService.getPlaylist(playlistId);
    const track = playlist.tracks.find((candidate) => candidate.track_id === trackId);
    if (!track) throw new ApiError("PLAYLIST_TRACK_NOT_FOUND", "Virtual playlist track not found", {
      playlist_id: playlistId,
      track_id: trackId
    });

    let result = options.result || null;
    if (!result) {
      const status = resolutionStatus(track);
      if (status !== "resolved" && status !== "manual" && status !== "stale") {
        const report = this.skippedReport("identity_resolution_required", track.audio_metadata);
        return { track, report };
      }
      const resolution = await new TrackResolutionService(this.mediaService).resolve({
        query: track.query || track.identity.canonical_query,
        title: track.identity.title || track.title,
        artist: track.identity.artist || track.artist,
        album: track.identity.album,
        releaseYear: track.identity.release_year,
        versionHint: track.identity.version_hint as VersionHint | null,
        count: 25,
        includeExactQuery: false,
        sourcePreference: options.sourcePreference || this.sourcePreference
      });
      const storedImageKey = track.image_key || (typeof track.audio_metadata?.image_key === "string"
        ? track.audio_metadata.image_key
        : null);
      const recovered = resolution.candidates.find((candidate) =>
        Boolean(storedImageKey && candidate.result.image_key === storedImageKey) &&
        sameRecordingTitle(candidate.result.title, track.identity.title || track.title) &&
        artistMatches(candidate.result, track.identity.artist || track.artist) &&
        versionFamily(candidate.result.title, candidate.result.version_hint) ===
          versionFamily(track.identity.title || track.title, track.identity.version_hint)
      );
      result = resolution.status === "resolved"
        ? resolution.selected?.result || null
        : recovered?.result || null;
      if (!result) {
        const report = this.skippedReport(`identity_${resolution.status}:${resolution.reason}`, track.audio_metadata);
        return { track, report };
      }
    }

    try {
      const enriched = await this.enrichResult(result, {
        title: track.identity.title || track.title,
        artist: track.identity.artist || track.artist,
        album: track.identity.album,
        catalog_profile: catalogProfileFromAudio(track.audio_metadata)
      });
      const replaced = replaceCatalogAudioMetadata(track.audio_metadata, enriched.audio_metadata) || {};
      const completeness = metadataCompleteness(replaced);
      const report = { ...enriched.report, completeness };
      const updated = this.playlistService.updateTrackAudioMetadata(playlistId, trackId, replaced, report);
      this.logger?.info("Playlist track metadata refreshed", {
        playlistId,
        trackId,
        status: report.status,
        metadataStatus: report.metadata_status,
        missingFields: completeness.missing_fields,
        conflicts: report.conflicts.length
      });
      return { track: updated, report };
    } catch (error) {
      const report = this.failedReport(error, result.result_id || null, track.audio_metadata);
      this.logger?.warn("Playlist track metadata refresh failed", { playlistId, trackId, error: report.warnings[0] });
      return { track, report };
    }
  }

  async refreshPlaylist(
    playlistId: string,
    options: { trackIds?: string[]; force?: boolean; sourcePreference?: SourcePreference } = {}
  ): Promise<PlaylistMetadataRefreshResult> {
    const playlist = this.playlistService.getPlaylist(playlistId);
    const selected = options.trackIds ? new Set(options.trackIds) : null;
    if (selected) {
      const known = new Set(playlist.tracks.map((track) => track.track_id));
      const unknown = [...selected].filter((trackId) => !known.has(trackId));
      if (unknown.length) throw new ApiError("PLAYLIST_TRACK_NOT_FOUND", "Virtual playlist track not found", {
        playlist_id: playlistId,
        track_ids: unknown
      });
    }
    const tracks = playlist.tracks.filter((track) =>
      (!selected || selected.has(track.track_id)) &&
      (options.force || track.audio_metadata?.metadata_status !== "exact" || !metadataCompleteness(track.audio_metadata).complete)
    );
    const results: PlaylistMetadataRefreshResult["tracks"] = [];
    for (const track of tracks) {
      const refreshed = await this.refreshTrack(playlistId, track.track_id, {
        sourcePreference: options.sourcePreference
      });
      results.push({ track_id: track.track_id, report: refreshed.report });
    }
    const count = (status: MetadataEnrichmentReport["status"]) =>
      results.filter((entry) => entry.report.status === status).length;
    const metadataCount = (status: PlaylistMetadataStatus) =>
      results.filter((entry) => entry.report.metadata_status === status).length;
    return {
      playlist_id: playlistId,
      attempted: results.length,
      completed: count("completed"),
      partial: count("partial"),
      skipped: count("skipped"),
      failed: count("failed"),
      conflict: metadataCount("conflict"),
      unverified: metadataCount("unverified"),
      tracks: results,
      playlist: this.playlistService.getPlaylist(playlistId)
    };
  }

  private skippedReport(reason: string, metadata: AudioMetadata | null): MetadataEnrichmentReport {
    return {
      status: "skipped",
      metadata_status: "unverified",
      observed_at: new Date().toISOString(),
      source_result_id: null,
      album_result_id: null,
      completeness: metadataCompleteness(metadata),
      recording: null,
      release: null,
      field_provenance: {},
      conflicts: [],
      warnings: [reason]
    };
  }

  private failedReport(error: unknown, resultId: string | null, metadata: AudioMetadata | null): MetadataEnrichmentReport {
    return {
      status: "failed",
      metadata_status: "unverified",
      observed_at: new Date().toISOString(),
      source_result_id: resultId,
      album_result_id: null,
      completeness: metadataCompleteness(metadata),
      recording: null,
      release: null,
      field_provenance: {},
      conflicts: [],
      warnings: [error instanceof Error ? error.message : String(error)]
    };
  }
}
