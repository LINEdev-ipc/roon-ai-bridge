import crypto from "crypto";
import { APP_VERSION } from "../config/version";
import { SqliteDatabase } from "../db/database";
import type {
  MediaResult,
  MediaSource,
  RoonMediaService,
  VersionHint
} from "../roon/roonMediaService";
import type { Logger } from "../utils/logger";
import { MetadataProviderCacheService } from "./metadataProviderCacheService";
import {
  RecordingCatalogMetadata,
  RecordingCatalogReleaseCandidate,
  RecordingCatalogResolution,
  RecordingMetadataService,
  ReleaseTrackCatalogMetadata
} from "./recordingMetadataService";

export type CatalogCoverArt = {
  entity_type: "release" | "release_group";
  entity_id: string;
  image_id: string;
  original_url: string | null;
  thumbnail_250_url: string | null;
  thumbnail_500_url: string | null;
  thumbnail_1200_url: string | null;
  front: boolean;
  back: boolean;
  approved: boolean;
  source: "cover_art_archive";
};

export type CatalogReleaseGroupProfile = {
  musicbrainz_id: string;
  title: string;
  artist_credit: RecordingCatalogMetadata["artist_credit"];
  first_release_date: string | null;
  release_year: number | null;
  primary_type: string | null;
  secondary_types: string[];
  disambiguation: string | null;
  selection_reason: string;
};

export type RoonCatalogBinding = {
  binding_id: string;
  recording_id: string;
  item_key: string | null;
  result_id: string | null;
  source: MediaSource;
  canonical_query: string;
  reusable: false;
  playable: boolean;
  status: "observed" | "unavailable";
  confidence: "high" | "medium";
  selection_origin: "automatic" | "manual" | "display";
  observed_at: string;
  last_verified_at: string;
};

export type TrackCatalogProfile = {
  status: "exact" | "ambiguous" | "not_found" | "ineligible" | "provider_error";
  reason: string;
  fetched_at: string;
  recording: {
    musicbrainz_id: string;
    title: string;
    disambiguation: string | null;
    video: boolean;
    duration_seconds: number | null;
    duration_source: "musicbrainz_recording_median";
    isrcs: string[];
    artist_credit: RecordingCatalogMetadata["artist_credit"];
    artists: NonNullable<RecordingCatalogMetadata["artist_entities"]>;
  } | null;
  work: NonNullable<RecordingCatalogMetadata["work"]> | null;
  credits: NonNullable<RecordingCatalogMetadata["credits"]>;
  composers: string[];
  lyricists: string[];
  genres: NonNullable<RecordingCatalogMetadata["genre_details"]>;
  release_group: CatalogReleaseGroupProfile | null;
  release: ReleaseTrackCatalogMetadata | null;
  cover_art: CatalogCoverArt | null;
  roon_binding: RoonCatalogBinding | null;
  provenance: {
    canonical_metadata: "musicbrainz";
    cover_art: "cover_art_archive" | null;
    playback: "roon" | null;
  };
  warnings: string[];
};

type ResolveCatalogInput = {
  recording_id?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  album_observation?: string | null;
  version_hint?: string | null;
  isrc?: string | null;
  duration_seconds?: number | null;
  release_year_observation?: number | null;
  release_year?: number | null;
  track_number?: number | null;
  disc_number?: number | null;
  include_cover_art?: boolean;
};

type CoverArtArchivePayload = {
  images?: Array<{
    id?: string | number;
    image?: string;
    front?: boolean;
    back?: boolean;
    approved?: boolean;
    thumbnails?: Record<string, string>;
  }>;
};

const COVER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : null;
}

function normalize(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s*[([](?:19|20)\d{2}[\])]\s*$/u, " ")
    .replace(/\b(?:super deluxe(?: edition)?|deluxe edition|expanded edition)\b/g, " ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function year(value: unknown): number | null {
  const match = String(value || "").match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function official(candidate: RecordingCatalogReleaseCandidate): boolean {
  return !candidate.status || normalize(candidate.status) === "official";
}

function releaseTypeRank(candidate: RecordingCatalogReleaseCandidate): number {
  const secondary = candidate.secondary_types.map(normalize);
  if (secondary.includes("compilation")) return 5;
  if (secondary.includes("live")) return 4;
  if (secondary.includes("remix")) return 3;
  const primary = normalize(candidate.primary_type);
  if (primary === "album") return 0;
  if (primary === "ep") return 1;
  if (primary === "single") return 2;
  return 3;
}

function candidateOrder(
  left: RecordingCatalogReleaseCandidate,
  right: RecordingCatalogReleaseCandidate
): number {
  return releaseTypeRank(left) - releaseTypeRank(right)
    || (left.release_year ?? 9999) - (right.release_year ?? 9999)
    || left.title.localeCompare(right.title);
}

function mediaValue<T>(primary: T | null | undefined, fallback: T | null | undefined): T | null {
  return primary !== null && primary !== undefined ? primary : fallback ?? null;
}

function mergeMedia(source: MediaResult, detail: MediaResult): MediaResult {
  return {
    ...source,
    title: text(detail.title) || source.title,
    artist: text(detail.artist) || source.artist,
    artists: detail.artists?.length ? detail.artists : source.artists,
    album: text(detail.album) || source.album,
    album_artist: text(detail.album_artist) || source.album_artist,
    image_key: text(detail.image_key) || source.image_key,
    source: detail.source !== "unknown" ? detail.source : source.source,
    source_confidence: detail.source !== "unknown" ? detail.source_confidence : source.source_confidence,
    quality: detail.quality || source.quality,
    version_hint: detail.version_hint !== "unknown" ? detail.version_hint : source.version_hint,
    release_year: mediaValue(detail.release_year, source.release_year),
    duration_seconds: mediaValue(detail.duration_seconds, source.duration_seconds),
    track_number: mediaValue(detail.track_number, source.track_number),
    disc_number: mediaValue(detail.disc_number, source.disc_number),
    release_type: detail.release_type || source.release_type,
    release_type_source: detail.release_type_source || source.release_type_source,
    links: {
      artist: detail.links?.artist || source.links?.artist || null,
      artists: detail.links?.artists?.length ? detail.links.artists : source.links?.artists || [],
      album: detail.links?.album || source.links?.album || null
    }
  };
}

export class TrackCatalogService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly recordingMetadataService: RecordingMetadataService,
    private readonly mediaService?: RoonMediaService,
    private readonly cache?: MetadataProviderCacheService,
    private readonly logger?: Logger,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async resolve(input: ResolveCatalogInput): Promise<{
    resolution: RecordingCatalogResolution;
    profile: TrackCatalogProfile;
  }> {
    const fetchedAt = new Date().toISOString();
    let resolution: RecordingCatalogResolution;
    try {
      resolution = await this.recordingMetadataService.lookup(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        resolution: {
          status: "not_found",
          reason: "provider_error",
          metadata: null,
          candidates: [],
          trace: {
            cache_hit: false,
            cache_layer: null,
            elapsed_ms: 0,
            provider_requests: 0,
            search_attempts: [],
            candidate_counts: { returned: 0, accepted: 0, rejected: 0 },
            rejected_candidates: [],
            accepted_warnings: [reason]
          }
        },
        profile: this.emptyProfile("provider_error", "musicbrainz_provider_error", fetchedAt, [reason])
      };
    }
    if (resolution.status !== "exact" || !resolution.metadata) {
      const status = resolution.status === "conflict" ? "ambiguous" : "not_found";
      return {
        resolution,
        profile: this.emptyProfile(status, resolution.reason, fetchedAt, resolution.trace.accepted_warnings)
      };
    }

    const metadata = resolution.metadata;
    const selected = this.selectRelease(metadata, input);
    let release: ReleaseTrackCatalogMetadata | null = null;
    const warnings = [...resolution.trace.accepted_warnings];
    if (selected.edition) {
      try {
        const exact = await this.recordingMetadataService.lookupReleaseTrack(
          selected.edition.release_id,
          metadata.recording_id
        );
        if (exact.status === "exact") release = exact.metadata;
        else warnings.push(`release_track_${exact.reason}`);
      } catch (error) {
        warnings.push(`release_track_provider_error:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const coverEntity = release?.release_id
      ? { type: "release" as const, id: release.release_id }
      : selected.group?.musicbrainz_id
        ? { type: "release_group" as const, id: selected.group.musicbrainz_id }
        : null;
    const coverArt = coverEntity && input.include_cover_art
      ? await this.coverArt(coverEntity.type, coverEntity.id, warnings)
      : null;
    const profile: TrackCatalogProfile = {
      status: metadata.video ? "ineligible" : "exact",
      reason: metadata.video ? "musicbrainz_recording_is_video" : resolution.reason,
      fetched_at: fetchedAt,
      recording: {
        musicbrainz_id: metadata.recording_id,
        title: metadata.title,
        disambiguation: metadata.disambiguation,
        video: Boolean(metadata.video),
        duration_seconds: metadata.duration_seconds,
        duration_source: "musicbrainz_recording_median",
        isrcs: metadata.isrcs,
        artist_credit: metadata.artist_credit,
        artists: metadata.artist_entities || metadata.artist_credit.flatMap((credit) =>
          credit.musicbrainz_id ? [{
            musicbrainz_id: credit.musicbrainz_id,
            name: credit.name,
            sort_name: null,
            disambiguation: null,
            type: null,
            country: null,
            credited_name: credit.name,
            join_phrase: credit.join_phrase
          }] : []
        )
      },
      work: metadata.work || null,
      credits: metadata.credits || [
        ...metadata.composers.map((name) => ({
          musicbrainz_id: null,
          name,
          credited_name: null,
          role: "composer" as const,
          attributes: []
        })),
        ...metadata.lyricists.map((name) => ({
          musicbrainz_id: null,
          name,
          credited_name: null,
          role: "lyricist" as const,
          attributes: []
        }))
      ],
      composers: metadata.composers,
      lyricists: metadata.lyricists,
      genres: metadata.genre_details || metadata.genres.map((name) => ({
        name,
        count: 1,
        entity: "recording" as const
      })),
      release_group: selected.group,
      release,
      cover_art: coverArt,
      roon_binding: null,
      provenance: {
        canonical_metadata: "musicbrainz",
        cover_art: coverArt ? "cover_art_archive" : null,
        playback: null
      },
      warnings: Array.from(new Set(warnings))
    };
    this.persist(profile, metadata);
    return { resolution, profile };
  }

  async describeRoonTrack(source: MediaResult): Promise<TrackCatalogProfile> {
    let observed = source;
    const warnings: string[] = [];
    if (this.mediaService && typeof this.mediaService.getTrackMetadata === "function") {
      try {
        observed = mergeMedia(source, await this.mediaService.getTrackMetadata(source.result_id));
      } catch (error) {
        warnings.push(`roon_track_metadata:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const artist = observed.artist || observed.artists?.[0]?.title || observed.album_artist;
    if (!artist) {
      return this.emptyProfile("not_found", "artist_required_for_catalog_lookup", new Date().toISOString(), warnings);
    }
    const { profile } = await this.resolve({
      title: observed.title,
      artist,
      album_observation: observed.album,
      version_hint: observed.version_hint,
      isrc: text((observed as MediaResult & { isrc?: unknown }).isrc),
      duration_seconds: observed.duration_seconds,
      release_year: observed.release_year,
      track_number: observed.track_number,
      disc_number: observed.disc_number,
      include_cover_art: true
    });
    profile.warnings = Array.from(new Set([...warnings, ...profile.warnings]));
    if (profile.recording && profile.status !== "ineligible") {
      profile.roon_binding = this.bind(profile.recording.musicbrainz_id, observed, "display", {
        catalog_status: profile.status,
        release_group_id: profile.release_group?.musicbrainz_id || null,
        release_id: profile.release?.release_id || null
      });
      profile.provenance.playback = "roon";
    }
    return profile;
  }

  bind(
    recordingId: string,
    media: MediaResult,
    origin: RoonCatalogBinding["selection_origin"],
    evidence: Record<string, unknown> = {}
  ): RoonCatalogBinding {
    const now = new Date().toISOString();
    const canonicalQuery = [media.title, media.artist || media.album_artist].filter(Boolean).join(" ");
    const bindingId = crypto.createHash("sha256")
      .update([recordingId, media.roon_item_key || media.result_id, media.source].join("|"))
      .digest("hex");
    const binding: RoonCatalogBinding = {
      binding_id: bindingId,
      recording_id: recordingId,
      item_key: media.roon_item_key,
      result_id: media.result_id,
      source: media.source,
      canonical_query: canonicalQuery,
      reusable: false,
      playable: media.playable,
      status: media.playable ? "observed" : "unavailable",
      confidence: media.confidence === "high" ? "high" : "medium",
      selection_origin: origin,
      observed_at: now,
      last_verified_at: now
    };
    this.database.db.prepare(`
      INSERT INTO roon_recording_bindings (
        binding_id, recording_id, roon_item_key, roon_result_id, source, title, artist, album,
        image_key, quality_json, version_hint, canonical_query, reusable, playable,
        selection_origin, status, confidence, evidence_json, observed_at, last_verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(binding_id) DO UPDATE SET
        roon_item_key = excluded.roon_item_key,
        roon_result_id = excluded.roon_result_id,
        source = excluded.source,
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        image_key = excluded.image_key,
        quality_json = excluded.quality_json,
        version_hint = excluded.version_hint,
        canonical_query = excluded.canonical_query,
        reusable = excluded.reusable,
        playable = excluded.playable,
        selection_origin = excluded.selection_origin,
        status = excluded.status,
        confidence = excluded.confidence,
        evidence_json = excluded.evidence_json,
        last_verified_at = excluded.last_verified_at
    `).run(
      binding.binding_id,
      recordingId,
      binding.item_key,
      binding.result_id,
      binding.source,
      media.title,
      media.artist,
      media.album,
      media.image_key,
      JSON.stringify(media.quality),
      media.version_hint,
      binding.canonical_query,
      0,
      binding.playable ? 1 : 0,
      origin,
      binding.status,
      binding.confidence,
      JSON.stringify(evidence),
      now,
      now
    );
    return binding;
  }

  get(recordingId: string): TrackCatalogProfile | null {
    const row = this.database.db.prepare(
      "SELECT metadata_json FROM catalog_recordings WHERE recording_id = ?"
    ).get(recordingId) as { metadata_json?: string } | undefined;
    if (!row?.metadata_json) return null;
    try {
      return JSON.parse(row.metadata_json) as TrackCatalogProfile;
    } catch {
      return null;
    }
  }

  private emptyProfile(
    status: TrackCatalogProfile["status"],
    reason: string,
    fetchedAt: string,
    warnings: string[]
  ): TrackCatalogProfile {
    return {
      status,
      reason,
      fetched_at: fetchedAt,
      recording: null,
      work: null,
      credits: [],
      composers: [],
      lyricists: [],
      genres: [],
      release_group: null,
      release: null,
      cover_art: null,
      roon_binding: null,
      provenance: {
        canonical_metadata: "musicbrainz",
        cover_art: null,
        playback: null
      },
      warnings: Array.from(new Set(warnings))
    };
  }

  private selectRelease(
    metadata: RecordingCatalogMetadata,
    input: ResolveCatalogInput
  ): {
    group: CatalogReleaseGroupProfile | null;
    edition: RecordingCatalogReleaseCandidate | null;
  } {
    const candidates = metadata.release_candidates.filter(official);
    const album = text(input.album) || text(input.album_observation);
    let compatible = album
      ? candidates.filter((candidate) => normalize(candidate.title) === normalize(album))
      : [];
    let reason = album && compatible.length ? "catalog_album_matches_observed_album" : "earliest_primary_release_group";
    compatible = (compatible.length ? compatible : candidates).slice().sort(candidateOrder);
    if (!compatible.length) return { group: null, edition: null };

    const preferredGroupId = compatible[0].release_group_id;
    const groupCandidates = preferredGroupId
      ? compatible.filter((candidate) => candidate.release_group_id === preferredGroupId)
      : [compatible[0]];
    const groupDetail = metadata.release_groups?.find((group) =>
      group.musicbrainz_id === preferredGroupId
    );
    const first = groupCandidates[0];
    const group = preferredGroupId ? {
      musicbrainz_id: preferredGroupId,
      title: groupDetail?.title || first.title,
      artist_credit: metadata.artist_credit,
      first_release_date: groupDetail?.first_release_date || (
        first.release_year ? String(first.release_year) : null
      ),
      release_year: year(groupDetail?.first_release_date) || first.release_year,
      primary_type: groupDetail?.primary_type || first.primary_type,
      secondary_types: groupDetail?.secondary_types || first.secondary_types,
      disambiguation: groupDetail?.disambiguation || null,
      selection_reason: reason
    } : null;

    let editionCandidates = groupCandidates;
    const narrow = (predicate: (candidate: RecordingCatalogReleaseCandidate) => boolean) => {
      const matches = editionCandidates.filter(predicate);
      if (matches.length) editionCandidates = matches;
    };
    if (input.release_year) narrow((candidate) => candidate.release_year === input.release_year);
    if (input.disc_number) narrow((candidate) => candidate.medium_position === input.disc_number);
    if (input.track_number) narrow((candidate) => candidate.track_position === input.track_number);
    const hasEditionEvidence = Boolean(
      input.release_year || input.disc_number || input.track_number
    );
    const edition = hasEditionEvidence && editionCandidates.length === 1
      ? editionCandidates[0]
      : null;
    return { group, edition };
  }

  private async coverArt(
    entityType: CatalogCoverArt["entity_type"],
    entityId: string,
    warnings: string[]
  ): Promise<CatalogCoverArt | null> {
    const provider = "cover_art_archive";
    const cacheKey = `${entityType}:v1:${entityId}`;
    const cached = this.cache?.get<CatalogCoverArt | null>(provider, cacheKey);
    if (cached) return cached.payload;
    const endpoint = entityType === "release" ? "release" : "release-group";
    try {
      const response = await this.fetchImpl(`https://coverartarchive.org/${endpoint}/${entityId}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": `RoonAI-Bridge/${APP_VERSION} (https://github.com/LINEdev-ipc/roon-ai-bridge)`
        },
        signal: AbortSignal.timeout(6000)
      });
      if (response.status === 404) {
        this.cache?.set({
          provider,
          cacheKey,
          entityType: "cover_art",
          status: "not_found",
          payload: null,
          ttlMs: COVER_CACHE_TTL_MS
        });
        return null;
      }
      if (!response.ok) throw new Error(`Cover Art Archive returned HTTP ${response.status}`);
      const payload = await response.json() as CoverArtArchivePayload;
      const selected = (payload.images || []).find((image) => image.front && image.approved !== false)
        || (payload.images || []).find((image) => image.front)
        || (payload.images || [])[0];
      if (!selected) return null;
      const art: CatalogCoverArt = {
        entity_type: entityType,
        entity_id: entityId,
        image_id: String(selected.id || crypto.createHash("sha1").update(String(selected.image || entityId)).digest("hex")),
        original_url: text(selected.image),
        thumbnail_250_url: text(selected.thumbnails?.["250"]),
        thumbnail_500_url: text(selected.thumbnails?.["500"]),
        thumbnail_1200_url: text(selected.thumbnails?.["1200"]),
        front: Boolean(selected.front),
        back: Boolean(selected.back),
        approved: selected.approved !== false,
        source: "cover_art_archive"
      };
      this.cache?.set({
        provider,
        cacheKey,
        entityType: "cover_art",
        status: "exact",
        payload: art,
        ttlMs: COVER_CACHE_TTL_MS
      });
      return art;
    } catch (error) {
      warnings.push(`cover_art_provider_error:${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private persist(profile: TrackCatalogProfile, metadata: RecordingCatalogMetadata): void {
    if (!profile.recording) return;
    const now = profile.fetched_at;
    const recording = profile.recording;
    const recordingId = recording.musicbrainz_id;
    this.database.transaction(() => {
      this.database.db.prepare(`
        INSERT INTO catalog_recordings (
          recording_id, title, disambiguation, video, duration_seconds, duration_source,
          isrcs_json, metadata_status, metadata_json, source, fetched_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'musicbrainz', ?, ?)
        ON CONFLICT(recording_id) DO UPDATE SET
          title = excluded.title,
          disambiguation = excluded.disambiguation,
          video = excluded.video,
          duration_seconds = excluded.duration_seconds,
          duration_source = excluded.duration_source,
          isrcs_json = excluded.isrcs_json,
          metadata_status = excluded.metadata_status,
          metadata_json = excluded.metadata_json,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      `).run(
        recordingId,
        recording.title,
        recording.disambiguation,
        recording.video ? 1 : 0,
        recording.duration_seconds,
        recording.duration_source,
        JSON.stringify(recording.isrcs),
        profile.status,
        JSON.stringify(profile),
        now,
        now
      );

      this.database.db.prepare("DELETE FROM catalog_recording_artists WHERE recording_id = ?").run(recordingId);
      recording.artists.forEach((artist, position) => {
        this.database.db.prepare(`
          INSERT INTO catalog_artists (
            artist_id, name, sort_name, disambiguation, artist_type, country,
            metadata_json, fetched_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(artist_id) DO UPDATE SET
            name = excluded.name,
            sort_name = excluded.sort_name,
            disambiguation = excluded.disambiguation,
            artist_type = excluded.artist_type,
            country = excluded.country,
            metadata_json = excluded.metadata_json,
            fetched_at = excluded.fetched_at,
            updated_at = excluded.updated_at
        `).run(
          artist.musicbrainz_id,
          artist.name,
          artist.sort_name,
          artist.disambiguation,
          artist.type,
          artist.country,
          JSON.stringify(artist),
          now,
          now
        );
        this.database.db.prepare(`
          INSERT INTO catalog_recording_artists (
            recording_id, artist_id, credit_position, credited_name, join_phrase, role
          ) VALUES (?, ?, ?, ?, ?, 'primary')
        `).run(
          recordingId,
          artist.musicbrainz_id,
          position,
          artist.credited_name,
          artist.join_phrase
        );
      });

      if (profile.work) {
        this.database.db.prepare(`
          INSERT INTO catalog_works (
            work_id, title, work_type, language, iswcs_json, disambiguation,
            metadata_json, fetched_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(work_id) DO UPDATE SET
            title = excluded.title,
            work_type = excluded.work_type,
            language = excluded.language,
            iswcs_json = excluded.iswcs_json,
            disambiguation = excluded.disambiguation,
            metadata_json = excluded.metadata_json,
            fetched_at = excluded.fetched_at,
            updated_at = excluded.updated_at
        `).run(
          profile.work.musicbrainz_id,
          profile.work.title,
          profile.work.type,
          profile.work.language,
          JSON.stringify(profile.work.iswcs),
          profile.work.disambiguation,
          JSON.stringify(profile.work),
          now,
          now
        );
        this.database.db.prepare(`
          INSERT INTO catalog_recording_works (
            recording_id, work_id, relation_type, attributes_json
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(recording_id, work_id, relation_type) DO UPDATE SET
            attributes_json = excluded.attributes_json
        `).run(
          recordingId,
          profile.work.musicbrainz_id,
          profile.work.relation_type,
          JSON.stringify(profile.work.relation_attributes)
        );
      }

      this.database.db.prepare("DELETE FROM catalog_credits WHERE recording_id = ?").run(recordingId);
      profile.credits.forEach((credit, position) => {
        if (credit.musicbrainz_id) {
          this.database.db.prepare(`
            INSERT INTO catalog_artists (
              artist_id, name, sort_name, disambiguation, artist_type, country,
              metadata_json, fetched_at, updated_at
            ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
            ON CONFLICT(artist_id) DO UPDATE SET
              name = excluded.name,
              metadata_json = excluded.metadata_json,
              fetched_at = excluded.fetched_at,
              updated_at = excluded.updated_at
          `).run(
            credit.musicbrainz_id,
            credit.name,
            credit.name,
            JSON.stringify({ source: "musicbrainz_work_credit", ...credit }),
            now,
            now
          );
        }
        const creditId = crypto.createHash("sha256")
          .update([recordingId, profile.work?.musicbrainz_id || "", credit.role, credit.musicbrainz_id || credit.name, position].join("|"))
          .digest("hex");
        this.database.db.prepare(`
          INSERT INTO catalog_credits (
            credit_id, recording_id, work_id, artist_id, name, credited_name,
            role, credit_position, attributes_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          creditId,
          recordingId,
          profile.work?.musicbrainz_id || null,
          credit.musicbrainz_id,
          credit.name,
          credit.credited_name,
          credit.role,
          position,
          JSON.stringify(credit.attributes)
        );
      });

      this.database.db.prepare("DELETE FROM catalog_recording_release_groups WHERE recording_id = ?").run(recordingId);
      const releaseGroups = metadata.release_groups || [];
      for (const group of releaseGroups) {
        this.database.db.prepare(`
          INSERT INTO catalog_release_groups (
            release_group_id, title, artist_credit_json, first_release_date,
            primary_type, secondary_types_json, disambiguation, metadata_json,
            fetched_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(release_group_id) DO UPDATE SET
            title = excluded.title,
            artist_credit_json = excluded.artist_credit_json,
            first_release_date = excluded.first_release_date,
            primary_type = excluded.primary_type,
            secondary_types_json = excluded.secondary_types_json,
            disambiguation = excluded.disambiguation,
            metadata_json = excluded.metadata_json,
            fetched_at = excluded.fetched_at,
            updated_at = excluded.updated_at
        `).run(
          group.musicbrainz_id,
          group.title,
          JSON.stringify(metadata.artist_credit),
          group.first_release_date,
          group.primary_type,
          JSON.stringify(group.secondary_types),
          group.disambiguation,
          JSON.stringify(group),
          now,
          now
        );
        this.database.db.prepare(`
          INSERT INTO catalog_recording_release_groups (
            recording_id, release_group_id, is_primary, selection_reason
          ) VALUES (?, ?, ?, ?)
        `).run(
          recordingId,
          group.musicbrainz_id,
          profile.release_group?.musicbrainz_id === group.musicbrainz_id ? 1 : 0,
          profile.release_group?.musicbrainz_id === group.musicbrainz_id
            ? profile.release_group.selection_reason
            : null
        );
      }
      if (profile.release_group && !releaseGroups.some((group) =>
        group.musicbrainz_id === profile.release_group!.musicbrainz_id
      )) {
        const group = profile.release_group;
        this.database.db.prepare(`
          INSERT INTO catalog_release_groups (
            release_group_id, title, artist_credit_json, first_release_date,
            primary_type, secondary_types_json, disambiguation, metadata_json,
            fetched_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(release_group_id) DO UPDATE SET
            title = excluded.title,
            first_release_date = excluded.first_release_date,
            primary_type = excluded.primary_type,
            secondary_types_json = excluded.secondary_types_json,
            disambiguation = excluded.disambiguation,
            metadata_json = excluded.metadata_json,
            fetched_at = excluded.fetched_at,
            updated_at = excluded.updated_at
        `).run(
          group.musicbrainz_id,
          group.title,
          JSON.stringify(group.artist_credit),
          group.first_release_date,
          group.primary_type,
          JSON.stringify(group.secondary_types),
          group.disambiguation,
          JSON.stringify(group),
          now,
          now
        );
        this.database.db.prepare(`
          INSERT INTO catalog_recording_release_groups (
            recording_id, release_group_id, is_primary, selection_reason
          ) VALUES (?, ?, 1, ?)
        `).run(recordingId, group.musicbrainz_id, group.selection_reason);
      }

      if (profile.release) {
        const release = profile.release;
        this.database.db.prepare(`
          INSERT INTO catalog_releases (
            release_id, release_group_id, title, release_date, country, status,
            album_artist, barcode, packaging, labels_json, media_format,
            metadata_json, fetched_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(release_id) DO UPDATE SET
            release_group_id = excluded.release_group_id,
            title = excluded.title,
            release_date = excluded.release_date,
            country = excluded.country,
            status = excluded.status,
            album_artist = excluded.album_artist,
            barcode = excluded.barcode,
            packaging = excluded.packaging,
            labels_json = excluded.labels_json,
            media_format = excluded.media_format,
            metadata_json = excluded.metadata_json,
            fetched_at = excluded.fetched_at,
            updated_at = excluded.updated_at
        `).run(
          release.release_id,
          release.release_group_id,
          release.title,
          release.date,
          release.country,
          release.status,
          release.album_artist,
          release.barcode || null,
          release.packaging || null,
          JSON.stringify(release.labels || []),
          release.media_format || null,
          JSON.stringify(release),
          now,
          now
        );
        this.database.db.prepare(`
          INSERT INTO catalog_release_tracks (
            release_id, recording_id, medium_position, track_position,
            track_number, title, duration_seconds
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(release_id, recording_id, medium_position, track_position) DO UPDATE SET
            track_number = excluded.track_number,
            title = excluded.title,
            duration_seconds = excluded.duration_seconds
        `).run(
          release.release_id,
          recordingId,
          release.medium_position,
          release.track_position,
          release.track_number,
          release.track_title,
          release.duration_seconds
        );
      }

      this.database.db.prepare(
        "DELETE FROM catalog_genres WHERE entity_type = 'recording' AND entity_id = ?"
      ).run(recordingId);
      for (const genre of profile.genres) {
        const entityType = genre.entity === "work" && profile.work ? "work" : "recording";
        const entityId = entityType === "work" ? profile.work!.musicbrainz_id : recordingId;
        this.database.db.prepare(`
          INSERT INTO catalog_genres (entity_type, entity_id, name, score, source)
          VALUES (?, ?, ?, ?, 'musicbrainz')
          ON CONFLICT(entity_type, entity_id, name) DO UPDATE SET score = excluded.score
        `).run(entityType, entityId, genre.name, genre.count);
      }

      if (profile.cover_art) {
        const cover = profile.cover_art;
        this.database.db.prepare(`
          UPDATE catalog_cover_art
          SET selected = 0
          WHERE entity_type = ? AND entity_id = ?
        `).run(cover.entity_type, cover.entity_id);
        this.database.db.prepare(`
          INSERT INTO catalog_cover_art (
            entity_type, entity_id, image_id, front, back, approved, original_url,
            thumbnail_250_url, thumbnail_500_url, thumbnail_1200_url,
            selected, source, fetched_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'cover_art_archive', ?)
          ON CONFLICT(entity_type, entity_id, image_id) DO UPDATE SET
            front = excluded.front,
            back = excluded.back,
            approved = excluded.approved,
            original_url = excluded.original_url,
            thumbnail_250_url = excluded.thumbnail_250_url,
            thumbnail_500_url = excluded.thumbnail_500_url,
            thumbnail_1200_url = excluded.thumbnail_1200_url,
            selected = 1,
            fetched_at = excluded.fetched_at
        `).run(
          cover.entity_type,
          cover.entity_id,
          cover.image_id,
          cover.front ? 1 : 0,
          cover.back ? 1 : 0,
          cover.approved ? 1 : 0,
          cover.original_url,
          cover.thumbnail_250_url,
          cover.thumbnail_500_url,
          cover.thumbnail_1200_url,
          now
        );
      }
    });
    this.logger?.info("Canonical track metadata stored", {
      recordingId,
      releaseGroupId: profile.release_group?.musicbrainz_id || null,
      releaseId: profile.release?.release_id || null,
      metadataStatus: profile.status
    });
  }
}
