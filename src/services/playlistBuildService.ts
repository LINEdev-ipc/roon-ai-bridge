import crypto from "crypto";
import {
  MediaResult,
  RoonMediaService,
  SourcePreference,
  VersionHint
} from "../roon/roonMediaService";
import { ApiError } from "../utils/errors";
import { Logger } from "../utils/logger";
import { PlaylistService, VirtualPlaylist } from "./playlistService";
import { PlaylistMetadataEnrichmentService } from "./playlistMetadataEnrichmentService";
import {
  TrackCatalogProfile,
  TrackCatalogService
} from "./trackCatalogService";
import type { AudioMetadata } from "./playlists/playlistContracts";
import {
  RankedTrackCandidate,
  TrackResolution,
  TrackResolutionService
} from "./trackResolutionService";

export type PlaylistRecordingIntent =
  | "standard"
  | "live"
  | "remix"
  | "cover"
  | "dub"
  | "acoustic"
  | "alternate";

export type PlaylistCandidateRole = "primary" | "reserve";

export type PlaylistCandidateInput = {
  candidate_id?: unknown;
  role?: unknown;
  result_id?: unknown;
  title?: unknown;
  artist?: unknown;
  artist_credit?: unknown;
  required_credits?: unknown;
  album?: unknown;
  album_hint?: unknown;
  release_year?: unknown;
  release_year_hint?: unknown;
  recording_intent?: unknown;
  performance_sensitive?: unknown;
  user_metadata?: unknown;
};

export type PlaylistBuildRequest = {
  build_id?: unknown;
  playlist_id?: unknown;
  name?: unknown;
  description?: unknown;
  desired_count?: unknown;
  no_adjacent_same_artist?: unknown;
  tracks?: unknown;
  purpose?: unknown;
  intent?: unknown;
  expiry_days?: unknown;
};

type PlaylistBuildPurpose = "saved_playlist" | "temporary_playlist";

type RequiredCredit = {
  name: string;
  role: string;
};

type NormalizedCandidate = {
  candidateId: string;
  role: PlaylistCandidateRole;
  resultId: string | null;
  title: string;
  artist: string;
  requiredCredits: RequiredCredit[];
  albumHint: string | null;
  releaseYearHint: number | null;
  recordingIntent: PlaylistRecordingIntent;
  performanceSensitive: boolean;
  userMetadata: Record<string, unknown> | null;
  round: number;
};

type RoonObservation = {
  observed_at: string;
  search_queries: string[];
  search_result: Record<string, unknown>;
  album_detail: {
    attempted: boolean;
    album_result_id: string | null;
    album: Record<string, unknown> | null;
    matched_track: Record<string, unknown> | null;
  };
  warnings: string[];
};

type PreparedCandidate = {
  input: NormalizedCandidate;
  result: MediaResult;
  storedTrack: Record<string, unknown>;
  identityKey: string;
  selectedArtistKey: string;
  resolutionReason: string;
  catalogProfile: TrackCatalogProfile | null;
};

export type RejectedCandidate = {
  candidate_id: string;
  title: string;
  artist: string;
  role: PlaylistCandidateRole;
  round: number;
  status: "missing" | "needs_enrichment" | "duplicate" | "invalid" | "manual_required" | "ineligible";
  reason: string;
};

export type PlaylistCandidatePreflightResult =
  | {
      accepted: true;
      track: Record<string, unknown>;
      candidate: Record<string, unknown>;
    }
  | {
      accepted: false;
      rejection: RejectedCandidate;
    };

type BuildSession = {
  buildId: string;
  playlistId: string | null;
  name: string | null;
  description: string | null;
  desiredCount: number;
  noAdjacentSameArtist: boolean;
  round: number;
  prepared: PreparedCandidate[];
  rejected: RejectedCandidate[];
  seenProposalKeys: Set<string>;
  seenIdentityKeys: Set<string>;
  createdAt: number;
  updatedAt: number;
  purpose: PlaylistBuildPurpose;
  intent: string | null;
  expiryDays: number | null;
};

export type PlaylistBuildResult = {
  phase: "needs_candidates" | "finalized";
  build_id: string | null;
  round: number;
  next_round: number | null;
  rounds_remaining: number;
  desired_count: number | null;
  added_count: number;
  missing_count: number | null;
  complete: boolean;
  playlist: VirtualPlaylist | null;
  accepted: Array<Record<string, unknown>>;
  rejected: RejectedCandidate[];
  not_selected: Array<Record<string, unknown>>;
  unused_reserves: number;
  search_summary: {
    proposals_seen: number;
    valid_recordings: number;
    rejected: number;
  };
};

const MAX_ADDITIONAL_ROUNDS = 2;
const SESSION_TTL_MS = 30 * 60 * 1000;
const RESOLUTION_CONCURRENCY = 3;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : null;
}

function normalize(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function canonicalTitle(value: unknown): string {
  return normalize(value)
    .replace(/\b(?:remaster(?:ed)?|digital master|single version|album version|original version|stereo version|mono version)\b.*$/g, "")
    .replace(/\b(?:live|en vivo|directo|remix|rework|dub|radio edit|acoustic|acapella|instrumental|demo|karaoke|cover)\b.*$/g, "")
    .trim();
}

function phraseIncludes(haystack: string, needle: string): boolean {
  return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `);
}

function resultCredits(result: MediaResult): string[] {
  const record = result as MediaResult & Record<string, unknown>;
  const extraCredits = [
    record.composer,
    record.conductor,
    record.orchestra,
    record.ensemble,
    record.performer,
    ...(Array.isArray(record.performers) ? record.performers : [])
  ].map((value) => {
    if (typeof value === "string") return value;
    return objectValue(value) ? optionalString(objectValue(value)?.title) : null;
  });
  return Array.from(new Set([
    result.artist,
    result.subtitle,
    result.album_artist,
    ...(result.artists || []).map((artist) => artist.title),
    ...extraCredits
  ].map(normalize).filter(Boolean)));
}

function versionFamily(result: Pick<MediaResult, "title" | "version_hint">): PlaylistRecordingIntent | "remaster" {
  const value = `${result.title || ""} ${result.version_hint || ""}`;
  if (/\b(?:live|en vivo|directo|concert)\b/i.test(value)) return "live";
  if (/\b(?:remix|rework|mix)\b/i.test(value)) return "remix";
  if (/\bdub\b/i.test(value)) return "dub";
  if (/\b(?:karaoke|tribute|homage|cover|originally performed|made popular)\b/i.test(value)) return "cover";
  if (/\bacoustic\b/i.test(value)) return "acoustic";
  if (/\b(?:radio edit|edit|acapella|instrumental|demo|re-record(?:ed|ing)?|sped up|slowed|nightcore|mashup|medley)\b/i.test(value)) return "alternate";
  if (/\b(?:remaster(?:ed)?|digital master)\b/i.test(value) || result.version_hint === "remaster") return "remaster";
  if (result.version_hint === "live" || result.version_hint === "remix" || result.version_hint === "cover") {
    return result.version_hint;
  }
  if (result.version_hint === "edit" || result.version_hint === "alternate") return "alternate";
  return "standard";
}

function versionAllowed(intent: PlaylistRecordingIntent, result: MediaResult): boolean {
  const actual = versionFamily(result);
  if (intent === "standard") return actual === "standard" || actual === "remaster";
  return actual === intent;
}

function versionHint(intent: PlaylistRecordingIntent): VersionHint {
  if (intent === "standard") return "studio";
  if (intent === "live" || intent === "remix" || intent === "cover") return intent;
  if (intent === "acoustic" || intent === "dub" || intent === "alternate") return "alternate";
  return "studio";
}

function candidateSnapshot(result: MediaResult): Record<string, unknown> {
  return { ...result };
}

function creditMatches(expected: string, credits: string[]): boolean {
  const wanted = normalize(expected);
  const combined = normalize(credits.join(" and "));
  return credits.some((credit) =>
    credit === wanted || phraseIncludes(credit, wanted) || phraseIncludes(wanted, credit)
  ) || phraseIncludes(combined, wanted);
}

function baseGate(input: NormalizedCandidate, result: MediaResult): boolean {
  if (!result.playable || !result.roon_item_key || result.media_type !== "track") return false;
  if (canonicalTitle(input.title) !== canonicalTitle(result.title)) return false;
  const credits = resultCredits(result);
  const primaryCredit = input.requiredCredits[0]?.name || input.artist;
  if (!creditMatches(primaryCredit, credits)) return false;
  return versionAllowed(input.recordingIntent, result);
}

function hardGate(input: NormalizedCandidate, result: MediaResult): boolean {
  if (!baseGate(input, result)) return false;
  const credits = resultCredits(result);
  if (!input.requiredCredits.every((credit) => creditMatches(credit.name, credits))) return false;
  return true;
}

function observedRecordingKey(result: MediaResult): string | null {
  const record = result as MediaResult & { isrc?: string | null };
  if (record.isrc) return `isrc:${normalize(record.isrc)}`;
  if (result.duration_seconds && result.album) {
    return `duration-album:${Math.round(result.duration_seconds)}:${normalize(result.album)}`;
  }
  return null;
}

function proposalKey(input: NormalizedCandidate): string {
  return [canonicalTitle(input.title), normalize(input.artist), input.recordingIntent].join("|");
}

function identityKey(input: NormalizedCandidate, result: MediaResult): string {
  return [canonicalTitle(result.title), normalize(input.requiredCredits[0]?.name || input.artist), versionFamily(result)].join("|");
}

function selectedArtistKey(input: NormalizedCandidate, result: MediaResult): string {
  return normalize(input.requiredCredits[0]?.name || result.artist || result.subtitle || input.artist);
}

function normalizeCandidate(value: unknown, round: number, index: number): NormalizedCandidate {
  const payload = objectValue(value);
  if (!payload) throw new ApiError("INVALID_PLAYLIST_TRACK", "Playlist candidate must be an object");
  const title = optionalString(payload.title);
  const artist = optionalString(payload.artist_credit) || optionalString(payload.artist);
  if (!title || !artist) {
    throw new ApiError(
      "INVALID_PLAYLIST_TRACK",
      "Every model-proposed playlist candidate requires title and artist_credit",
      { index, title, artist }
    );
  }
  const rawCredits = Array.isArray(payload.required_credits) ? payload.required_credits : [];
  const requiredCredits = rawCredits
    .map((entry) => objectValue(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      name: optionalString(entry.name) || "",
      role: optionalString(entry.role) || "primary"
    }))
    .filter((entry) => entry.name);
  if (!requiredCredits.length) {
    const inferred = artist
      .split(/\b(?:feat\.?|featuring|with)\b/i)
      .map((name) => name.trim())
      .filter(Boolean);
    for (const [creditIndex, name] of inferred.entries()) {
      requiredCredits.push({ name, role: creditIndex === 0 ? "primary" : "featured" });
    }
  }
  const rawIntent = optionalString(payload.recording_intent) || "standard";
  const allowedIntents = new Set<PlaylistRecordingIntent>([
    "standard", "live", "remix", "cover", "dub", "acoustic", "alternate"
  ]);
  const recordingIntent = allowedIntents.has(rawIntent as PlaylistRecordingIntent)
    ? rawIntent as PlaylistRecordingIntent
    : "standard";
  const role = payload.role === "reserve" ? "reserve" : "primary";
  const userMetadata = objectValue(payload.user_metadata);
  return {
    candidateId: optionalString(payload.candidate_id) || `round-${round}-candidate-${index + 1}`,
    role,
    resultId: optionalString(payload.result_id),
    title,
    artist,
    requiredCredits,
    albumHint: optionalString(payload.album_hint) || optionalString(payload.album),
    releaseYearHint: optionalInteger(payload.release_year_hint) ?? optionalInteger(payload.release_year),
    recordingIntent,
    performanceSensitive: payload.performance_sensitive === true || requiredCredits.some((credit) =>
      ["performer", "conductor", "orchestra", "ensemble", "soloist"].includes(credit.role)
    ),
    userMetadata,
    round
  };
}

function scheduleNoAdjacent(
  prepared: PreparedCandidate[],
  target: number | null,
  enabled: boolean
): { selected: PreparedCandidate[]; excluded: PreparedCandidate[] } {
  if (!enabled) {
    const selected = target === null ? prepared : prepared.slice(0, target);
    return { selected, excluded: prepared.slice(selected.length) };
  }
  const groups = new Map<string, Array<{ candidate: PreparedCandidate; index: number }>>();
  prepared.forEach((candidate, index) => {
    const group = groups.get(candidate.selectedArtistKey) || [];
    group.push({ candidate, index });
    groups.set(candidate.selectedArtistKey, group);
  });
  const selected: PreparedCandidate[] = [];
  let previous = "";
  const limit = target ?? prepared.length;
  while (selected.length < limit) {
    const choices = Array.from(groups.entries())
      .filter(([key, items]) => key !== previous && items.length > 0)
      .sort((left, right) =>
        right[1].length - left[1].length || left[1][0].index - right[1][0].index
      );
    if (!choices.length) break;
    const [key, items] = choices[0];
    selected.push(items.shift()!.candidate);
    previous = key;
  }
  const selectedSet = new Set(selected);
  return {
    selected,
    excluded: prepared.filter((candidate) => !selectedSet.has(candidate))
  };
}

export class PlaylistBuildService {
  private readonly sessions = new Map<string, BuildSession>();
  private readonly metadataService: PlaylistMetadataEnrichmentService;

  constructor(
    private readonly playlistService: PlaylistService,
    private readonly mediaService: RoonMediaService,
    private readonly logger?: Logger,
    private readonly sourcePreference: SourcePreference = "streaming_first",
    metadataService?: PlaylistMetadataEnrichmentService,
    private readonly trackCatalogService?: TrackCatalogService
  ) {
    this.metadataService = metadataService || new PlaylistMetadataEnrichmentService(
      playlistService,
      mediaService,
      logger,
      sourcePreference
    );
  }

  async prepareCandidate(value: unknown): Promise<PlaylistCandidatePreflightResult> {
    const candidate = normalizeCandidate(value, 0, 0);
    const outcome = await this.resolveCandidate(candidate);
    if ("rejected" in outcome) {
      return { accepted: false, rejection: outcome.rejected };
    }
    const prepared = outcome.prepared;
    return {
      accepted: true,
      track: prepared.storedTrack,
      candidate: {
        candidate_id: prepared.input.candidateId,
        title: prepared.result.title,
        artist: prepared.result.artist || prepared.result.subtitle,
        album: prepared.result.album,
        result_id: prepared.result.result_id,
        source: prepared.result.source,
        version_hint: prepared.result.version_hint,
        musicbrainz_recording_id: prepared.catalogProfile?.recording?.musicbrainz_id || null,
        resolution_reason: prepared.resolutionReason
      }
    };
  }

  async build(request: PlaylistBuildRequest): Promise<PlaylistBuildResult> {
    this.purgeExpiredSessions();
    const buildId = optionalString(request.build_id);
    const requestedPurpose: PlaylistBuildPurpose = request.purpose === "temporary_playlist"
      ? "temporary_playlist"
      : "saved_playlist";
    let session: BuildSession;
    if (buildId) {
      const existing = this.sessions.get(buildId);
      if (!existing) {
        throw new ApiError("PLAYLIST_BUILD_NOT_FOUND", "Playlist build session expired or was not found", {
          build_id: buildId
        });
      }
      if (existing.round >= MAX_ADDITIONAL_ROUNDS) {
        throw new ApiError("PLAYLIST_BUILD_FINALIZED", "Playlist build already used both replenishment rounds", {
          build_id: buildId
        });
      }
      if (existing.purpose !== requestedPurpose) {
        throw new ApiError("PLAYLIST_BUILD_PURPOSE_MISMATCH", "Playlist build belongs to a different workflow", {
          build_id: buildId,
          expected: existing.purpose,
          received: requestedPurpose
        });
      }
      existing.round += 1;
      existing.updatedAt = Date.now();
      session = existing;
    } else {
      const desiredCount = optionalInteger(request.desired_count);
      if (desiredCount !== null && (desiredCount < 1 || desiredCount > 500)) {
        throw new ApiError("INVALID_PLAYLIST", "desired_count must be between 1 and 500");
      }
      const playlistId = optionalString(request.playlist_id);
      const name = optionalString(request.name);
      if (!playlistId && !name) throw new ApiError("INVALID_PLAYLIST", "Playlist name is required");
      if (requestedPurpose === "temporary_playlist" && playlistId) {
        throw new ApiError("INVALID_PLAYLIST", "Temporary playlist builds cannot replace an existing playlist");
      }
      const expiryDays = optionalInteger(request.expiry_days);
      if (
        requestedPurpose === "temporary_playlist" &&
        (expiryDays === null || expiryDays < 1 || expiryDays > 365)
      ) {
        throw new ApiError(
          "INVALID_TEMPORARY_PLAYLIST_EXPIRY",
          "expiry_days must be an integer from 1 to 365"
        );
      }
      session = {
        buildId: crypto.randomUUID(),
        playlistId,
        name,
        description: optionalString(request.description),
        desiredCount: desiredCount ?? 0,
        noAdjacentSameArtist: request.no_adjacent_same_artist !== false,
        round: 0,
        prepared: [],
        rejected: [],
        seenProposalKeys: new Set(),
        seenIdentityKeys: new Set(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        purpose: requestedPurpose,
        intent: optionalString(request.intent),
        expiryDays
      };
      if (desiredCount !== null) this.sessions.set(session.buildId, session);
    }

    const rawTracks = Array.isArray(request.tracks) ? request.tracks : [];
    const candidates = rawTracks.map((track, index) => normalizeCandidate(track, session.round, index));
    candidates.sort((left, right) =>
      (left.role === "primary" ? 0 : 1) - (right.role === "primary" ? 0 : 1)
    );
    await this.processCandidates(session, candidates);

    const target = session.desiredCount || null;
    const scheduled = scheduleNoAdjacent(
      session.prepared,
      target,
      session.noAdjacentSameArtist
    );
    const missing = target === null ? null : Math.max(0, target - scheduled.selected.length);
    const shouldFinalize = target === null || missing === 0 || session.round >= MAX_ADDITIONAL_ROUNDS;
    if (!shouldFinalize) {
      this.sessions.set(session.buildId, session);
      this.logger?.info("Playlist preflight needs replenishment", {
        buildId: session.buildId,
        round: session.round,
        desiredCount: target,
        acceptedCount: scheduled.selected.length,
        missingCount: missing,
        rejectedCount: session.rejected.length
      });
      return this.result(session, "needs_candidates", null, scheduled, missing);
    }

    const preparedTracks = scheduled.selected.map((candidate) => candidate.storedTrack);
    const playlist = session.purpose === "temporary_playlist"
      ? this.playlistService.savePreparedTemporaryPlaylist({
          name: session.name || undefined,
          description: session.description === null ? undefined : session.description,
          tracks: preparedTracks,
          intent: session.intent,
          expiry_days: session.expiryDays
        })
      : this.playlistService.savePreparedPlaylist({
          playlist_id: session.playlistId || undefined,
          name: session.name || undefined,
          description: session.description === null ? undefined : session.description,
          tracks: preparedTracks
        });
    this.sessions.delete(session.buildId);
    this.logger?.info("Playlist preflight finalized", {
      buildId: session.buildId,
      playlistId: playlist.playlist_id,
      round: session.round,
      desiredCount: target,
      acceptedCount: scheduled.selected.length,
      missingCount: missing,
      rejectedCount: session.rejected.length
    });
    return this.result(session, "finalized", playlist, scheduled, missing);
  }

  private async processCandidates(session: BuildSession, candidates: NormalizedCandidate[]): Promise<void> {
    const target = session.desiredCount || null;
    for (let offset = 0; offset < candidates.length;) {
      const current = scheduleNoAdjacent(session.prepared, target, session.noAdjacentSameArtist);
      if (target !== null && current.selected.length >= target) break;
      const remainingSlots = target === null
        ? RESOLUTION_CONCURRENCY
        : Math.max(1, target - current.selected.length);
      const chunkSize = Math.min(RESOLUTION_CONCURRENCY, remainingSlots);
      const chunk = candidates.slice(offset, offset + chunkSize);
      offset += chunk.length;
      const outcomes = await Promise.all(chunk.map(async (candidate) => {
        const key = proposalKey(candidate);
        if (session.seenProposalKeys.has(key)) {
          return {
            rejected: this.rejection(candidate, "duplicate", "duplicate_proposal")
          };
        }
        session.seenProposalKeys.add(key);
        try {
          return await this.resolveCandidate(candidate);
        } catch (error) {
          this.logger?.warn("Playlist candidate preflight failed", {
            buildId: session.buildId,
            candidateId: candidate.candidateId,
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            rejected: this.rejection(candidate, "invalid", "resolution_error")
          };
        }
      }));
      for (const outcome of outcomes) {
        if ("rejected" in outcome) {
          session.rejected.push(outcome.rejected);
          continue;
        }
        if (session.seenIdentityKeys.has(outcome.prepared.identityKey)) {
          session.rejected.push(this.rejection(
            outcome.prepared.input,
            "duplicate",
            "duplicate_recording"
          ));
          continue;
        }
        session.seenIdentityKeys.add(outcome.prepared.identityKey);
        session.prepared.push(outcome.prepared);
      }
      session.updatedAt = Date.now();
    }
  }

  private async resolveCandidate(candidate: NormalizedCandidate): Promise<
    { prepared: PreparedCandidate } | { rejected: RejectedCandidate }
  > {
    let catalogProfile: TrackCatalogProfile | null = null;
    let canonicalTitle = candidate.title;
    let canonicalArtist = candidate.artist;
    let bindingCandidate = candidate;
    if (this.trackCatalogService) {
      const catalog = await this.trackCatalogService.resolve({
        title: candidate.title,
        artist: candidate.requiredCredits[0]?.name || candidate.artist,
        album: candidate.albumHint,
        version_hint: versionHint(candidate.recordingIntent),
        release_year: candidate.releaseYearHint
      });
      catalogProfile = catalog.profile;
      if (catalogProfile.status === "ineligible") {
        return {
          rejected: this.rejection(candidate, "ineligible", "musicbrainz_recording_is_video")
        };
      }
      if (catalogProfile.status !== "exact" || !catalogProfile.recording) {
        return {
          rejected: this.rejection(
            candidate,
            "manual_required",
            `musicbrainz_${catalogProfile.status}:${catalogProfile.reason}`
          )
        };
      }
      canonicalTitle = catalogProfile.recording.title;
      canonicalArtist = catalogProfile.recording.artist_credit.length
        ? catalogProfile.recording.artist_credit
          .map((credit) => `${credit.name}${credit.join_phrase}`)
          .join("")
        : candidate.artist;
      bindingCandidate = {
        ...candidate,
        title: canonicalTitle,
        artist: canonicalArtist,
        requiredCredits: [
          ...catalogProfile.recording.artist_credit.map((credit, index) => ({
            name: credit.name,
            role: index === 0 ? "primary" : "featured"
          })),
          ...candidate.requiredCredits.filter((credit) =>
            !["primary", "featured"].includes(credit.role)
          )
        ]
      };
    }
    const resolver = new TrackResolutionService(this.mediaService);
    const baseQuery = `${canonicalTitle} ${canonicalArtist}`;
    let resolution = await resolver.resolve({
      query: baseQuery,
      title: canonicalTitle,
      artist: canonicalArtist,
      album: candidate.albumHint,
      releaseYear: candidate.releaseYearHint,
      versionHint: versionHint(candidate.recordingIntent),
      count: 25,
      sourcePreference: this.sourcePreference
    });
    let selected = await this.selectStrictCandidate(bindingCandidate, resolution);
    let stage = "title_artist";
    if (!selected && candidate.albumHint) {
      stage = "title_artist_album";
      resolution = await resolver.resolve({
        query: `${baseQuery} ${candidate.albumHint}`,
        title: canonicalTitle,
        artist: canonicalArtist,
        album: candidate.albumHint,
        releaseYear: candidate.releaseYearHint,
        versionHint: versionHint(candidate.recordingIntent),
        count: 25,
        sourcePreference: this.sourcePreference,
        includeExactQuery: false
      });
      selected = await this.selectStrictCandidate(bindingCandidate, resolution);
    }
    if (!selected) {
      const needsEnrichment = resolution.candidates.some((entry) => baseGate(bindingCandidate, entry.result));
      return {
        rejected: this.rejection(
          candidate,
          this.trackCatalogService ? "manual_required" : needsEnrichment ? "needs_enrichment" : "missing",
          this.trackCatalogService
            ? `roon_binding_required:${needsEnrichment ? "performance_metadata_required" : resolution.reason}`
            : needsEnrichment ? "performance_metadata_required" : resolution.reason
        )
      };
    }

    const hydrated = await this.hydrate(selected.result, candidate, resolution.queries);
    const result = hydrated.result;
    if (catalogProfile?.recording && this.trackCatalogService) {
      hydrated.audioMetadata.title = catalogProfile.recording.title;
      hydrated.audioMetadata.artist = canonicalArtist;
      hydrated.audioMetadata.album_artist = canonicalArtist;
      if (catalogProfile.release_group?.title) {
        hydrated.audioMetadata.album = catalogProfile.release_group.title;
      }
      hydrated.audioMetadata.recording = {
        musicbrainz_id: catalogProfile.recording.musicbrainz_id,
        title: catalogProfile.recording.title,
        artist: canonicalArtist,
        artist_credit: catalogProfile.recording.artist_credit,
        disambiguation: catalogProfile.recording.disambiguation,
        duration_seconds: catalogProfile.recording.duration_seconds,
        duration_source: catalogProfile.recording.duration_source,
        isrcs: catalogProfile.recording.isrcs,
        composers: catalogProfile.composers,
        lyricists: catalogProfile.lyricists,
        genres: catalogProfile.genres.map((genre) => genre.name),
        confidence: "high"
      };
      hydrated.audioMetadata.composers = catalogProfile.composers;
      hydrated.audioMetadata.composer = catalogProfile.composers.join(", ");
      hydrated.audioMetadata.lyricists = catalogProfile.lyricists;
      hydrated.audioMetadata.genres = catalogProfile.genres.map((genre) => genre.name);
      hydrated.audioMetadata.genre = catalogProfile.genres.map((genre) => genre.name).join(", ");
      hydrated.audioMetadata.isrcs = catalogProfile.recording.isrcs;
      if (catalogProfile.recording.isrcs[0]) {
        hydrated.audioMetadata.isrc = catalogProfile.recording.isrcs[0];
      }
      hydrated.audioMetadata.catalog = catalogProfile;
      hydrated.metadataEnrichment.catalog = catalogProfile;
      const binding = this.trackCatalogService.bind(
        catalogProfile.recording.musicbrainz_id,
        result,
        "automatic",
        {
          recording_intent: candidate.recordingIntent,
          album_hint: candidate.albumHint,
          resolution_reason: resolution.reason
        }
      );
      hydrated.metadataEnrichment.roon_binding = binding;
    }
    const storedTrack = this.storedTrack(
      candidate,
      result,
      resolution,
      selected,
      stage,
      hydrated.observation,
      hydrated.audioMetadata,
      hydrated.metadataEnrichment,
      catalogProfile
    );
    return {
      prepared: {
        input: candidate,
        result,
        storedTrack,
        identityKey: catalogProfile?.recording?.musicbrainz_id
          ? `musicbrainz:${catalogProfile.recording.musicbrainz_id}`
          : identityKey(candidate, result),
        selectedArtistKey: selectedArtistKey(candidate, result),
        resolutionReason: resolution.reason,
        catalogProfile
      }
    };
  }

  private async selectStrictCandidate(
    input: NormalizedCandidate,
    resolution: TrackResolution
  ): Promise<RankedTrackCandidate | null> {
    const baseCandidates = resolution.candidates.filter((candidate) => baseGate(input, candidate.result));
    if (!baseCandidates.length) return null;
    const strictCandidates = baseCandidates.filter((candidate) => hardGate(input, candidate.result));
    if (!input.performanceSensitive && strictCandidates.length === 1) return strictCandidates[0];
    if (!input.performanceSensitive && resolution.status === "resolved") {
      const resolved = strictCandidates.find((candidate) =>
        candidate.result.result_id === resolution.selected?.result.result_id
      );
      if (resolved) return resolved;
    }

    const hydrated = (await Promise.all(baseCandidates.slice(0, 3).map(async (candidate) => ({
      candidate,
      hydrated: await this.hydrate(candidate.result, input, resolution.queries)
    })))).filter((entry) => hardGate(input, entry.hydrated.result));
    if (hydrated.length === 1) return hydrated[0].candidate;
    if (!hydrated.length) return null;
    const albumMatches = input.albumHint
      ? hydrated.filter((entry) => normalize(entry.hydrated.result.album) === normalize(input.albumHint))
      : [];
    if (albumMatches.length === 1) return albumMatches[0].candidate;
    const yearMatches = input.releaseYearHint
      ? hydrated.filter((entry) => entry.hydrated.result.release_year === input.releaseYearHint)
      : [];
    if (yearMatches.length === 1) return yearMatches[0].candidate;
    const observedKeys = hydrated
      .map((entry) => observedRecordingKey(entry.hydrated.result))
      .filter((key): key is string => Boolean(key));
    if (observedKeys.length === hydrated.length && new Set(observedKeys).size === 1) {
      return hydrated[0].candidate;
    }
    return null;
  }

  private async hydrate(
    result: MediaResult,
    input: NormalizedCandidate,
    queries: string[]
  ): Promise<{
    result: MediaResult;
    observation: RoonObservation;
    audioMetadata: AudioMetadata;
    metadataEnrichment: Record<string, unknown>;
  }> {
    const enriched = await this.metadataService.enrichResult(result, {
      title: input.title,
      artist: input.artist,
      album: input.albumHint
    });
    const hydrated = enriched.result;
    const albumResultId = enriched.report.album_result_id;
    return {
      result: hydrated,
      audioMetadata: enriched.audio_metadata,
      metadataEnrichment: enriched.report,
      observation: {
        observed_at: enriched.report.observed_at,
        search_queries: queries,
        search_result: candidateSnapshot(result),
        album_detail: {
          attempted: Boolean(albumResultId),
          album_result_id: albumResultId,
          album: hydrated.album ? { title: hydrated.album, artist: hydrated.album_artist } : null,
          matched_track: candidateSnapshot(hydrated)
        },
        warnings: enriched.report.warnings
      }
    };
  }

  private storedTrack(
    input: NormalizedCandidate,
    result: MediaResult,
    resolution: TrackResolution,
    selected: RankedTrackCandidate,
    stage: string,
    observation: RoonObservation,
    audioMetadata: AudioMetadata,
    metadataEnrichment: Record<string, unknown>,
    catalogProfile: TrackCatalogProfile | null
  ): Record<string, unknown> {
    const canonicalArtist = catalogProfile?.recording?.artist_credit.length
      ? catalogProfile.recording.artist_credit
        .map((credit) => `${credit.name}${credit.join_phrase}`)
        .join("")
      : result.artist || result.subtitle || input.artist;
    const canonicalTitle = catalogProfile?.recording?.title || result.title;
    const canonicalAlbum = catalogProfile?.release_group?.title || result.album;
    const canonicalQuery = `${canonicalTitle} ${canonicalArtist}`;
    const llmHints = {
      album: input.albumHint,
      release_year: input.releaseYearHint,
      recording_intent: input.recordingIntent,
      required_credits: input.requiredCredits
    };
    return {
      query: canonicalQuery,
      roon_item_key: result.roon_item_key,
      title: canonicalTitle,
      artist: canonicalArtist,
      album: canonicalAlbum,
      image_key: result.image_key,
      audio_metadata: audioMetadata,
      user_metadata: {
        ...(input.userMetadata || {}),
        llm_hints: llmHints,
        playlist_candidate: {
          candidate_id: input.candidateId,
          role: input.role,
          round: input.round
        }
      },
      resolution: {
        status: "resolved",
        readiness: "ready",
        query: canonicalQuery,
        stage,
        selected_result_id: result.result_id,
        selected_roon_item_key: result.roon_item_key,
        selected_candidate: candidateSnapshot(selected.result),
        score: selected.identity_score,
        confidence: selected.identity_score >= 100 ? "high" : "medium",
        reason: resolution.reason,
        selection_origin: "automatic",
        resolved_at: observation.observed_at,
        candidates: resolution.candidates.map((candidate) => candidateSnapshot(candidate.result)),
        roon_observation: observation,
        metadata_enrichment: metadataEnrichment,
        persistent_identity: "track_id",
        roon_item_key_persistent: false,
        binding: {
          state: "stale",
          item_key: result.roon_item_key,
          reusable: false,
          observed_at: observation.observed_at
        },
        catalog_identity: catalogProfile
      }
    };
  }

  private rejection(
    input: NormalizedCandidate,
    status: RejectedCandidate["status"],
    reason: string
  ): RejectedCandidate {
    return {
      candidate_id: input.candidateId,
      title: input.title,
      artist: input.artist,
      role: input.role,
      round: input.round,
      status,
      reason
    };
  }

  private result(
    session: BuildSession,
    phase: PlaylistBuildResult["phase"],
    playlist: VirtualPlaylist | null,
    scheduled: { selected: PreparedCandidate[]; excluded: PreparedCandidate[] },
    missing: number | null
  ): PlaylistBuildResult {
    const accepted = scheduled.selected.map((candidate) => ({
      candidate_id: candidate.input.candidateId,
      title: candidate.result.title,
      artist: candidate.result.artist || candidate.result.subtitle,
      album: candidate.result.album,
      role: candidate.input.role,
      round: candidate.input.round,
      result_id: candidate.result.result_id,
      source: candidate.result.source,
      version_hint: candidate.result.version_hint,
      metadata_status: objectValue(candidate.storedTrack.audio_metadata)?.metadata_status || "unverified",
      musicbrainz_recording_id: candidate.catalogProfile?.recording?.musicbrainz_id || null,
      resolution_reason: candidate.resolutionReason
    }));
    return {
      phase,
      build_id: phase === "needs_candidates" ? session.buildId : null,
      round: session.round,
      next_round: phase === "needs_candidates" ? session.round + 1 : null,
      rounds_remaining: phase === "needs_candidates"
        ? MAX_ADDITIONAL_ROUNDS - session.round
        : 0,
      desired_count: session.desiredCount || null,
      added_count: scheduled.selected.length,
      missing_count: missing,
      complete: missing === null || missing === 0,
      playlist,
      accepted,
      rejected: session.rejected,
      not_selected: scheduled.excluded.map((candidate) => ({
        candidate_id: candidate.input.candidateId,
        title: candidate.result.title,
        artist: candidate.result.artist || candidate.result.subtitle,
        role: candidate.input.role,
        round: candidate.input.round,
        reason: missing !== null && missing > 0
          ? "artist_adjacency_constraint"
          : "target_already_filled"
      })),
      unused_reserves: scheduled.excluded.length,
      search_summary: {
        proposals_seen: session.seenProposalKeys.size,
        valid_recordings: session.prepared.length,
        rejected: session.rejected.length
      }
    };
  }

  private purgeExpiredSessions(): void {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [buildId, session] of this.sessions) {
      if (session.updatedAt < cutoff) this.sessions.delete(buildId);
    }
  }
}
