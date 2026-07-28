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
  applyCatalogMetadata,
  catalogArtistCredit
} from "./playlists/catalogMetadata";
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
export type PlaylistSelectionComplexity = "standard" | "constrained" | "exact_versions";

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
  playlist_id?: unknown;
  name?: unknown;
  description?: unknown;
  desired_count?: unknown;
  selection_complexity?: unknown;
  release_year_from?: unknown;
  release_year_to?: unknown;
  no_adjacent_same_artist?: unknown;
  tracks?: unknown;
  purpose?: unknown;
  intent?: unknown;
  expiry_days?: unknown;
  diagnostics?: unknown;
  enqueue_metadata_enrichment?: unknown;
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

type HydratedCandidateResult = {
  result: MediaResult;
  observation: RoonObservation;
  audioMetadata: AudioMetadata;
  metadataEnrichment: Record<string, unknown>;
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
  playlistId: string | null;
  name: string | null;
  description: string | null;
  desiredCount: number;
  selectionComplexity: PlaylistSelectionComplexity;
  suppliedCandidates: number;
  releaseYearFrom: number | null;
  releaseYearTo: number | null;
  noAdjacentSameArtist: boolean;
  round: number;
  prepared: PreparedCandidate[];
  rejected: RejectedCandidate[];
  seenProposalKeys: Set<string>;
  seenIdentityKeys: Set<string>;
  startedAt: number;
  purpose: PlaylistBuildPurpose;
  intent: string | null;
  expiryDays: number | null;
  candidateMetrics: CandidateResolutionMetrics[];
  diagnostics: boolean;
  enqueueMetadataEnrichment: boolean;
};

type CandidateResolutionMetrics = {
  candidate_id: string;
  role: PlaylistCandidateRole;
  total_ms: number;
  catalog_ms: number;
  musicbrainz_requests: number;
  musicbrainz_cache_hits: number;
  listenbrainz_requests: number;
  listenbrainz_cache_hits: number;
  roon_speculative_ms: number;
  roon_fallback_ms: number;
  roon_searches: number;
  hydration_ms: number;
  speculative_binding_reused: boolean;
  binding_created: boolean;
  outcome: "accepted" | "rejected";
};

export type PlaylistBuildResult = {
  phase: "finalized";
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
  rejection_summary: {
    total: number;
    returned_candidates: number;
    by_status: Record<string, number>;
    by_reason: Record<string, number>;
    recovery_actions: string[];
  };
  performance: {
    elapsed_ms: number;
    candidates_started: number;
    candidates_accepted: number;
    candidates_rejected: number;
    catalog_ms_total: number;
    musicbrainz_requests: number;
    musicbrainz_cache_hits: number;
    listenbrainz_requests: number;
    listenbrainz_cache_hits: number;
    roon_speculative_ms_total: number;
    roon_fallback_ms_total: number;
    roon_searches: number;
    hydration_ms_total: number;
    speculative_bindings_reused: number;
    canonical_roon_fallbacks: number;
    bindings_created: number;
    reserve_policy: {
      complexity: PlaylistSelectionComplexity;
      multiplier: number;
      desired_count: number | null;
      recommended_candidates: number | null;
      supplied_candidates: number;
      sufficient: boolean | null;
    };
    metadata_enrichment: {
      mode: "background" | "disabled";
      queued_tracks: number;
    };
  };
  diagnostics?: {
    rejected_candidates: RejectedCandidate[];
    candidate_metrics: CandidateResolutionMetrics[];
  };
};

const RESOLUTION_CONCURRENCY = 6;
const RESERVE_MULTIPLIERS: Record<PlaylistSelectionComplexity, number> = {
  standard: 1.25,
  constrained: 1.5,
  exact_versions: 1.6
};

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
  const raw = String(value || "")
    .replace(/\s*[([]\s*\d{2,3}\s*[\])]\s*$/u, "")
    .replace(/\s*[\[(]\s*(?:(?:live|en vivo|directo|concert)\b[^)\]]*|[^)\]]*\b(?:remix|rework|refix|dub mix|dub version|radio edit|acoustic(?: version)?|unplugged|acapella|instrumental|demo|karaoke|cover version|remaster(?:ed|ing)?|digital master)\b[^)\]]*)[\])]\s*$/iu, "")
    .replace(/\s+-\s+(?:(?:live|en vivo|directo|concert)\b.*|.*\b(?:remix|rework|refix|dub mix|dub version|radio edit|acoustic(?: version)?|unplugged|acapella|instrumental|demo|karaoke|cover version|remaster(?:ed|ing)?|digital master)\b.*)$/iu, "")
    .replace(/\s+\b(?:single version|album version|original version|stereo version|mono version)\b.*$/iu, "");
  return normalize(raw);
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
  const title = result.title || "";
  const versionSuffix = /(?:[\[(]\s*[^)\]]*[\])]\s*$|\s+-\s+.+$)/u.test(title);
  if (versionSuffix && /\b(?:live|en vivo|directo|concert)\b/iu.test(title)) return "live";
  if (/\b(?:dub mix|dub version|version dub)\b/iu.test(title) || (versionSuffix && /\bdub\b/iu.test(title))) return "dub";
  if (/\b(?:remix|rework)\b/iu.test(title) || (versionSuffix && /\bmix\b/iu.test(title))) return "remix";
  if (/\b(?:karaoke|tribute|homage|cover version|originally performed|made popular)\b/iu.test(title)) return "cover";
  if (versionSuffix && /\b(?:acoustic|unplugged)\b/iu.test(title)) return "acoustic";
  if (/\b(?:radio edit|acapella|instrumental version|demo version|re-record(?:ed|ing)?|sped up|slowed|nightcore|mashup|medley)\b/iu.test(title)) return "alternate";
  if (/\b(?:remaster(?:ed)?|digital master)\b/iu.test(title) || result.version_hint === "remaster") return "remaster";
  if (result.version_hint === "live" || result.version_hint === "remix" || result.version_hint === "cover") {
    return result.version_hint;
  }
  if (result.version_hint === "edit" || result.version_hint === "alternate") return "alternate";
  return "standard";
}

function versionAllowed(
  input: NormalizedCandidate,
  result: MediaResult
): boolean {
  const intent = input.recordingIntent;
  const actual = versionFamily(result);
  const requestedTitle = input.title;
  const albumMatches = albumMatchesInput(input, result);
  const editionEvidence = [
    requestedTitle,
    input.albumHint,
    result.title,
    result.album
  ].filter(Boolean).join(" ");
  if (intent === "standard") {
    if (actual === "standard" || actual === "remaster") return true;
    if (
      actual === "remix" &&
      /\b(?:mix|remix|rework)\b/iu.test(requestedTitle) &&
      canonicalTitle(requestedTitle) === canonicalTitle(result.title)
    ) {
      return true;
    }
    return false;
  }
  if (intent === "cover") {
    // A cover is identified by its performing artist and canonical recording.
    // Roon normally exposes it as that artist's standard recording rather than
    // putting the word "cover" in the visible title.
    return actual === "cover" || actual === "standard" || actual === "remaster";
  }
  if (
    intent === "live" &&
    (actual === "standard" || actual === "remaster") &&
    albumMatches &&
    /\b(?:live|concert|en vivo|directo|unplugged)\b/iu.test(editionEvidence)
  ) {
    return true;
  }
  if (
    intent === "acoustic" &&
    (
      actual === "standard" || actual === "remaster" ||
      actual === "alternate" || actual === "live"
    ) &&
    albumMatches &&
    /\b(?:acoustic|unplugged|acústico|acustico)\b/iu.test(editionEvidence)
  ) {
    return true;
  }
  return actual === intent;
}

function versionHint(intent: PlaylistRecordingIntent): VersionHint {
  if (intent === "standard") return "studio";
  if (intent === "live" || intent === "remix") return intent;
  if (intent === "cover") return "studio";
  if (intent === "acoustic") return "unknown";
  if (intent === "dub") return "remix";
  if (intent === "alternate") return "alternate";
  return "studio";
}

function albumMatchesInput(input: NormalizedCandidate, result: MediaResult): boolean {
  return Boolean(
    input.albumHint &&
    result.album &&
    (
      normalize(input.albumHint) === normalize(result.album) ||
      phraseIncludes(normalize(input.albumHint), normalize(result.album)) ||
      phraseIncludes(normalize(result.album), normalize(input.albumHint))
    )
  );
}

function exactRecordingFamily(input: NormalizedCandidate): boolean {
  return input.recordingIntent !== "standard";
}

function resultIsrcs(result: MediaResult): string[] {
  const observed = result as MediaResult & { isrc?: string | null; isrcs?: string[] };
  return [observed.isrc, ...(observed.isrcs || [])].map(normalize).filter(Boolean);
}

function hasPublishedVersionLabel(title: string): boolean {
  return /\b(?:live|concert|en vivo|directo|remix|mix|rework|refix|dub|acoustic|unplugged|edit|alternate|version)\b/iu
    .test(title);
}

function recordingEvidenceAllowed(
  input: NormalizedCandidate,
  result: MediaResult,
  catalogProfile: TrackCatalogProfile | null
): boolean {
  if (!exactRecordingFamily(input) && !input.performanceSensitive) return true;
  if (albumMatchesInput(input, result)) return true;

  const canonicalIsrcs = new Set(
    (catalogProfile?.recording?.isrcs || []).map(normalize).filter(Boolean)
  );
  if (
    canonicalIsrcs.size &&
    resultIsrcs(result).some((isrc) => canonicalIsrcs.has(isrc))
  ) {
    return true;
  }

  if (
    !catalogProfile &&
    hasPublishedVersionLabel(input.title) &&
    normalize(input.title) === normalize(result.title)
  ) {
    return true;
  }

  const canonicalDuration = catalogProfile?.recording?.duration_seconds || null;
  const durationMatches = Boolean(
    canonicalDuration &&
    result.duration_seconds &&
    Math.abs(result.duration_seconds - canonicalDuration) <= 3
  );
  if (!durationMatches) return false;
  if (input.recordingIntent === "standard" || input.recordingIntent === "cover") return true;
  if (!hasPublishedVersionLabel(input.title)) return false;
  const requested = normalize(input.title);
  const observed = normalize(result.title);
  return requested === observed ||
    phraseIncludes(requested, observed) ||
    phraseIncludes(observed, requested);
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

function identityGate(input: NormalizedCandidate, result: MediaResult): boolean {
  if (!result.playable || !result.roon_item_key || result.media_type !== "track") return false;
  if (canonicalTitle(input.title) !== canonicalTitle(result.title)) return false;
  const credits = resultCredits(result);
  const primaryCredit = input.requiredCredits[0]?.name || input.artist;
  if (!creditMatches(primaryCredit, credits)) return false;
  return true;
}

function baseGate(input: NormalizedCandidate, result: MediaResult): boolean {
  return identityGate(input, result) && versionAllowed(input, result);
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
    const rawTracks = Array.isArray(request.tracks) ? request.tracks : [];
    const requestedPurpose: PlaylistBuildPurpose = request.purpose === "temporary_playlist"
      ? "temporary_playlist"
      : "saved_playlist";
    const desiredCount = optionalInteger(request.desired_count);
    if (desiredCount !== null && (desiredCount < 1 || desiredCount > 500)) {
      throw new ApiError("INVALID_PLAYLIST", "desired_count must be between 1 and 500");
    }
    if (desiredCount !== null && rawTracks.length === 0) {
      throw new ApiError(
        "INVALID_PLAYLIST",
        "A playlist with desired_count requires a non-empty candidate pool"
      );
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
    const rawComplexity = optionalString(request.selection_complexity);
    const selectionComplexity: PlaylistSelectionComplexity =
      rawComplexity === "constrained" || rawComplexity === "exact_versions"
        ? rawComplexity
        : "standard";
    const session: BuildSession = {
      playlistId,
      name,
      description: optionalString(request.description),
      desiredCount: desiredCount ?? 0,
      selectionComplexity,
      suppliedCandidates: rawTracks.length,
      releaseYearFrom: optionalInteger(request.release_year_from),
      releaseYearTo: optionalInteger(request.release_year_to),
      noAdjacentSameArtist: request.no_adjacent_same_artist !== false,
      round: 0,
      prepared: [],
      rejected: [],
      seenProposalKeys: new Set(),
      seenIdentityKeys: new Set(),
      startedAt: Date.now(),
      purpose: requestedPurpose,
      intent: optionalString(request.intent),
      expiryDays,
      candidateMetrics: [],
      diagnostics: request.diagnostics === true,
      enqueueMetadataEnrichment: request.enqueue_metadata_enrichment !== false
    };
    for (const [field, value] of [
      ["release_year_from", session.releaseYearFrom],
      ["release_year_to", session.releaseYearTo]
    ] as const) {
      if (value !== null && (value < 1000 || value > 3000)) {
        throw new ApiError("INVALID_PLAYLIST", `${field} must be between 1000 and 3000`);
      }
    }
    if (
      session.releaseYearFrom !== null &&
      session.releaseYearTo !== null &&
      session.releaseYearFrom > session.releaseYearTo
    ) {
      throw new ApiError(
        "INVALID_PLAYLIST",
        "release_year_from must be less than or equal to release_year_to"
      );
    }

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
    if (scheduled.selected.length === 0 && rawTracks.length > 0) {
      const byStatus: Record<string, number> = {};
      const byReason: Record<string, number> = {};
      for (const rejection of session.rejected) {
        byStatus[rejection.status] = (byStatus[rejection.status] || 0) + 1;
        byReason[rejection.reason] = (byReason[rejection.reason] || 0) + 1;
      }
      throw new ApiError(
        "PLAYLIST_BUILD_INCOMPLETE",
        "No submitted recording could be verified, so an empty playlist was not created",
        {
          desired_count: target,
          accepted_count: 0,
          rejected_count: session.rejected.length,
          rejection_summary: {
            by_status: byStatus,
            by_reason: byReason
          },
          rejected: session.rejected.slice(0, 25),
          ...(session.diagnostics ? {
            diagnostics: {
              rejected_candidates: session.rejected,
              candidate_metrics: session.candidateMetrics
            }
          } : {})
        }
      );
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
    this.logger?.info("Playlist preflight finalized", {
      playlistId: playlist.playlist_id,
      desiredCount: target,
      acceptedCount: scheduled.selected.length,
      missingCount: missing,
      rejectedCount: session.rejected.length,
      elapsedMs: Date.now() - session.startedAt
    });
    const enrichmentCandidates = scheduled.selected.filter((candidate) =>
      candidate.catalogProfile?.warnings.includes("metadata_enrichment_pending")
    );
    if (session.enqueueMetadataEnrichment && enrichmentCandidates.length) {
      this.queueMetadataEnrichment(playlist, scheduled.selected);
    }
    return this.result(session, "finalized", playlist, scheduled, missing);
  }

  private queueMetadataEnrichment(
    playlist: VirtualPlaylist,
    candidates: PreparedCandidate[]
  ): void {
    if (!this.trackCatalogService) return;
    const queued = candidates.flatMap((candidate, position) => {
      if (!candidate.catalogProfile?.warnings.includes("metadata_enrichment_pending")) return [];
      const track = playlist.tracks[position];
      return track ? [{ candidate, trackId: track.track_id }] : [];
    });
    setImmediate(() => {
      void this.enrichPlaylistMetadata(playlist.playlist_id, queued);
    });
  }

  private async enrichPlaylistMetadata(
    playlistId: string,
    queued: Array<{ candidate: PreparedCandidate; trackId: string }>
  ): Promise<void> {
    if (!this.trackCatalogService) return;
    for (const { candidate, trackId } of queued) {
      const recordingId = candidate.catalogProfile?.recording?.musicbrainz_id;
      if (!recordingId) continue;
      try {
        const full = await this.trackCatalogService.resolve({
          recording_id: recordingId,
          title: candidate.catalogProfile?.recording?.title || candidate.input.title,
          artist: candidate.catalogProfile?.recording?.artist_credit[0]?.name
            || candidate.input.artist,
          album_observation: candidate.input.albumHint,
          require_release_match: exactRecordingFamily(candidate.input) &&
            Boolean(candidate.input.albumHint),
          release_year_observation: candidate.input.releaseYearHint,
          version_hint: candidate.input.recordingIntent,
          metadata_depth: "full"
        });
        if (full.profile.status !== "exact" || !full.profile.recording) continue;
        const playlist = this.playlistService.getPlaylist(playlistId);
        const track = playlist.tracks.find((entry) => entry.track_id === trackId);
        if (!track) continue;
        const resolution = objectValue(track.resolution) || {};
        const metadataEnrichment = objectValue(resolution.metadata_enrichment) || {};
        this.playlistService.updateTrack(playlistId, trackId, {
          audio_metadata: applyCatalogMetadata(track.audio_metadata, full.profile),
          resolution: {
            ...resolution,
            catalog_identity: full.profile,
            metadata_enrichment: {
              ...metadataEnrichment,
              catalog: full.profile
            }
          }
        });
        this.logger?.info("Playlist track metadata enrichment completed", {
          playlistId,
          trackId,
          recordingId
        });
      } catch (error) {
        this.logger?.warn("Playlist track metadata enrichment failed", {
          playlistId,
          trackId,
          recordingId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
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
            rejected: this.rejection(candidate, "duplicate", "duplicate_proposal"),
            metrics: {
              candidate_id: candidate.candidateId,
              role: candidate.role,
              total_ms: 0,
              catalog_ms: 0,
              musicbrainz_requests: 0,
              musicbrainz_cache_hits: 0,
              listenbrainz_requests: 0,
              listenbrainz_cache_hits: 0,
              roon_speculative_ms: 0,
              roon_fallback_ms: 0,
              roon_searches: 0,
              hydration_ms: 0,
              speculative_binding_reused: false,
              binding_created: false,
              outcome: "rejected" as const
            }
          };
        }
        session.seenProposalKeys.add(key);
        try {
          return await this.resolveCandidate(candidate, {
            from: session.releaseYearFrom,
            to: session.releaseYearTo
          });
        } catch (error) {
          this.logger?.warn("Playlist candidate preflight failed", {
            candidateId: candidate.candidateId,
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            rejected: this.rejection(candidate, "invalid", "resolution_error"),
            metrics: {
              candidate_id: candidate.candidateId,
              role: candidate.role,
              total_ms: 0,
              catalog_ms: 0,
              musicbrainz_requests: 0,
              musicbrainz_cache_hits: 0,
              listenbrainz_requests: 0,
              listenbrainz_cache_hits: 0,
              roon_speculative_ms: 0,
              roon_fallback_ms: 0,
              roon_searches: 0,
              hydration_ms: 0,
              speculative_binding_reused: false,
              binding_created: false,
              outcome: "rejected" as const
            }
          };
        }
      }));
      for (const outcome of outcomes) {
        session.candidateMetrics.push(outcome.metrics);
        if ("rejected" in outcome) {
          session.rejected.push(outcome.rejected);
          continue;
        }
        if (session.seenIdentityKeys.has(outcome.prepared.identityKey)) {
          outcome.metrics.outcome = "rejected";
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
    }
  }

  private async resolveCandidate(
    candidate: NormalizedCandidate,
    releaseRange: { from: number | null; to: number | null } = { from: null, to: null }
  ): Promise<
    | { prepared: PreparedCandidate; metrics: CandidateResolutionMetrics }
    | { rejected: RejectedCandidate; metrics: CandidateResolutionMetrics }
  > {
    const startedAt = Date.now();
    let catalogMs = 0;
    let musicbrainzRequests = 0;
    let musicbrainzCacheHits = 0;
    let listenbrainzRequests = 0;
    let listenbrainzCacheHits = 0;
    let roonSpeculativeMs = 0;
    let roonFallbackMs = 0;
    let roonSearches = 0;
    let hydrationMs = 0;
    let speculativeBindingReused = false;
    let bindingCreated = false;
    const metrics = (outcome: CandidateResolutionMetrics["outcome"]): CandidateResolutionMetrics => ({
      candidate_id: candidate.candidateId,
      role: candidate.role,
      total_ms: Date.now() - startedAt,
      catalog_ms: catalogMs,
      musicbrainz_requests: musicbrainzRequests,
      musicbrainz_cache_hits: musicbrainzCacheHits,
      listenbrainz_requests: listenbrainzRequests,
      listenbrainz_cache_hits: listenbrainzCacheHits,
      roon_speculative_ms: roonSpeculativeMs,
      roon_fallback_ms: roonFallbackMs,
      roon_searches: roonSearches,
      hydration_ms: hydrationMs,
      speculative_binding_reused: speculativeBindingReused,
      binding_created: bindingCreated,
      outcome
    });
    const rejected = (
      status: RejectedCandidate["status"],
      reason: string
    ): { rejected: RejectedCandidate; metrics: CandidateResolutionMetrics } => ({
      rejected: this.rejection(candidate, status, reason),
      metrics: metrics("rejected")
    });
    const resolver = new TrackResolutionService(this.mediaService);
    const proposedQuery = `${candidate.title} ${candidate.artist}`;
    const speculativeStartedAt = Date.now();
    const speculativePromise = resolver.resolve({
      query: proposedQuery,
      preferredResultId: candidate.resultId,
      title: candidate.title,
      artist: candidate.artist,
      album: candidate.albumHint,
      releaseYear: candidate.releaseYearHint,
      versionHint: versionHint(candidate.recordingIntent),
      count: 25,
      sourcePreference: this.sourcePreference
    }).then((resolution) => {
      roonSpeculativeMs = Date.now() - speculativeStartedAt;
      roonSearches += resolution.queries.length;
      return resolution;
    });
    const catalogStartedAt = Date.now();
    const catalogPromise = this.trackCatalogService
      ? this.trackCatalogService.resolve({
          title: candidate.title,
          artist: candidate.requiredCredits[0]?.name || candidate.artist,
          album_observation: candidate.albumHint,
          require_release_match: exactRecordingFamily(candidate) && Boolean(candidate.albumHint),
          release_year_observation: candidate.releaseYearHint,
          version_hint: candidate.recordingIntent,
          metadata_depth: "identity"
        }).then((catalog) => {
          catalogMs = Date.now() - catalogStartedAt;
          const trace = catalog.resolution?.trace;
          musicbrainzRequests = trace?.provider_requests || 0;
          musicbrainzCacheHits = trace?.cache_hit ? 1 : 0;
          listenbrainzRequests = trace?.listenbrainz?.provider_requests || 0;
          listenbrainzCacheHits = trace?.listenbrainz?.cache_hits || 0;
          return catalog;
        })
      : Promise.resolve(null);
    const [catalog, speculativeResolution] = await Promise.all([
      catalogPromise,
      speculativePromise
    ]);
    let catalogProfile: TrackCatalogProfile | null = null;
    let canonicalTitle = candidate.title;
    let bindingArtist = candidate.requiredCredits[0]?.name || candidate.artist;
    let bindingCandidate = candidate;
    if (catalog) {
      catalogProfile = catalog.profile;
      if (catalogProfile.status === "ineligible") {
        return rejected("ineligible", "musicbrainz_recording_is_video");
      }
      if (catalogProfile.status !== "exact" || !catalogProfile.recording) {
        return rejected(
          "manual_required",
          `musicbrainz_${catalogProfile.status}:${catalogProfile.reason}`
        );
      }
      const firstReleaseYear = catalogProfile.release_group?.release_year ?? null;
      if (
        (releaseRange.from !== null || releaseRange.to !== null) &&
        (
          firstReleaseYear === null ||
          (releaseRange.from !== null && firstReleaseYear < releaseRange.from) ||
          (releaseRange.to !== null && firstReleaseYear > releaseRange.to)
        )
      ) {
        return rejected(
          "ineligible",
          firstReleaseYear === null
            ? "musicbrainz_release_year_unverified"
            : "musicbrainz_release_year_outside_requested_range"
        );
      }
      canonicalTitle = catalogProfile.recording.title;
      const canonicalCredits = catalogProfile.recording.artist_credit
        .map((credit) => credit.name)
        .filter(Boolean);
      const equivalentCredit = canonicalCredits.find((credit) =>
        creditMatches(bindingArtist, [normalize(credit)])
      );
      bindingArtist = equivalentCredit || canonicalCredits[0] || bindingArtist;
      bindingCandidate = {
        ...candidate,
        title: canonicalTitle,
        artist: bindingArtist,
        requiredCredits: equivalentCredit
          ? candidate.requiredCredits
          : [
              { name: bindingArtist, role: "primary" },
              ...candidate.requiredCredits.filter((credit) =>
                !["primary", "featured"].includes(credit.role)
              )
            ]
      };
    }
    const baseQuery = `${canonicalTitle} ${bindingArtist}`;
    const canonicalRequest = {
      query: baseQuery,
      title: canonicalTitle,
      artist: bindingArtist,
      album: candidate.albumHint,
      releaseYear: candidate.releaseYearHint,
      versionHint: versionHint(candidate.recordingIntent),
      count: 25,
      sourcePreference: this.sourcePreference
    } as const;
    const hydrationCache = new Map<string, Promise<HydratedCandidateResult>>();
    const hydrateCached = (
      result: MediaResult,
      queries: string[]
    ): Promise<HydratedCandidateResult> => {
      const key = [result.result_id, ...queries].join("|");
      const existing = hydrationCache.get(key);
      if (existing) return existing;
      const pending = this.hydrate(result, candidate, queries, catalogProfile);
      hydrationCache.set(key, pending);
      return pending;
    };
    let resolution = resolver.reconcile(
      canonicalRequest,
      speculativeResolution.candidates.map((entry) => entry.result),
      speculativeResolution.queries
    );
    let selected = await this.selectStrictCandidate(
      bindingCandidate,
      resolution,
      catalogProfile,
      (result) => hydrateCached(result, resolution.queries)
    );
    let stage = selected ? "speculative_title_artist" : "canonical_title_artist";
    speculativeBindingReused = Boolean(selected);
    const canonicalAlreadySearched = speculativeResolution.queries.some((query) =>
      normalize(query) === normalize(`${canonicalTitle} ${bindingArtist}`)
    );
    if (!selected && !canonicalAlreadySearched) {
      const fallbackStartedAt = Date.now();
      resolution = await resolver.resolve(canonicalRequest);
      roonFallbackMs += Date.now() - fallbackStartedAt;
      roonSearches += resolution.queries.length;
      selected = await this.selectStrictCandidate(
        bindingCandidate,
        resolution,
        catalogProfile,
        (result) => hydrateCached(result, resolution.queries)
      );
    }
    if (!selected && candidate.albumHint) {
      stage = "title_artist_album";
      const fallbackStartedAt = Date.now();
      resolution = await resolver.resolve({
        query: `${baseQuery} ${candidate.albumHint}`,
        title: canonicalTitle,
        artist: bindingArtist,
        album: candidate.albumHint,
        releaseYear: candidate.releaseYearHint,
        versionHint: versionHint(candidate.recordingIntent),
        count: 25,
        sourcePreference: this.sourcePreference,
        includeExactQuery: false
      });
      roonFallbackMs += Date.now() - fallbackStartedAt;
      roonSearches += resolution.queries.length;
      selected = await this.selectStrictCandidate(
        bindingCandidate,
        resolution,
        catalogProfile,
        (result) => hydrateCached(result, resolution.queries)
      );
    }
    if (!selected) {
      const needsEnrichment = resolution.candidates.some((entry) => baseGate(bindingCandidate, entry.result));
      return rejected(
        this.trackCatalogService ? "manual_required" : needsEnrichment ? "needs_enrichment" : "missing",
        this.trackCatalogService
          ? `roon_binding_required:${needsEnrichment ? "performance_metadata_required" : resolution.reason}`
          : needsEnrichment ? "performance_metadata_required" : resolution.reason
      );
    }

    const hydrationStartedAt = Date.now();
    const hydrated = await hydrateCached(selected.result, resolution.queries);
    hydrationMs = Date.now() - hydrationStartedAt;
    const result = hydrated.result;
    if (catalogProfile?.recording && this.trackCatalogService) {
      hydrated.audioMetadata = applyCatalogMetadata(hydrated.audioMetadata, catalogProfile);
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
      bindingCreated = true;
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
      },
      metrics: metrics("accepted")
    };
  }

  private async selectStrictCandidate(
    input: NormalizedCandidate,
    resolution: TrackResolution,
    catalogProfile: TrackCatalogProfile | null = null,
    hydrateResult?: (result: MediaResult) => Promise<HydratedCandidateResult>
  ): Promise<RankedTrackCandidate | null> {
    const identityCandidates = resolution.candidates.filter((candidate) =>
      identityGate(input, candidate.result)
    );
    if (!identityCandidates.length) return null;
    const baseCandidates = identityCandidates.filter((candidate) =>
      versionAllowed(input, candidate.result)
    );
    const strictCandidates = baseCandidates.filter((candidate) => hardGate(input, candidate.result));
    const requiresRecordingEvidence = exactRecordingFamily(input) || input.performanceSensitive;
    const directCanonicalMatches = strictCandidates.filter((candidate) =>
      candidate.result.direct_match === true &&
      (candidate.result.direct_match_score || 0) >= 90 &&
      canonicalTitle(candidate.result.title) === canonicalTitle(input.title)
    );
    if (!requiresRecordingEvidence && directCanonicalMatches.length === 1) {
      return directCanonicalMatches[0];
    }
    if (
      !requiresRecordingEvidence &&
      directCanonicalMatches.length > 1 &&
      directCanonicalMatches.every((candidate) => !candidate.result.album) &&
      new Set(directCanonicalMatches.map((candidate) =>
        resultCredits(candidate.result).sort().join("|")
      )).size === 1
    ) {
      return directCanonicalMatches[0];
    }
    if (!requiresRecordingEvidence && strictCandidates.length === 1) return strictCandidates[0];
    if (!requiresRecordingEvidence && resolution.status === "resolved") {
      const resolved = strictCandidates.find((candidate) =>
        candidate.result.result_id === resolution.selected?.result.result_id
      );
      if (resolved) return resolved;
    }

    const hydrationLimit = requiresRecordingEvidence ? 4 : 3;
    const hydrated = (await Promise.all(identityCandidates.slice(0, hydrationLimit).map(async (candidate) => ({
      candidate,
      hydrated: await (
        hydrateResult
          ? hydrateResult(candidate.result)
          : this.hydrate(candidate.result, input, resolution.queries, catalogProfile)
      )
    })))).filter((entry) =>
      hardGate(input, entry.hydrated.result) &&
      recordingEvidenceAllowed(input, entry.hydrated.result, catalogProfile)
    );
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
    const canonicalIsrcs = new Set(
      (catalogProfile?.recording?.isrcs || []).map(normalize).filter(Boolean)
    );
    const isrcMatches = canonicalIsrcs.size
      ? hydrated.filter((entry) => {
          const observed = entry.hydrated.result as MediaResult & {
            isrc?: string | null;
            isrcs?: string[];
          };
          return [observed.isrc, ...(observed.isrcs || [])]
            .map(normalize)
            .some((isrc) => canonicalIsrcs.has(isrc));
        })
      : [];
    if (isrcMatches.length) return isrcMatches[0].candidate;
    const canonicalDuration = catalogProfile?.recording?.duration_seconds || null;
    const durationMatches = canonicalDuration
      ? hydrated.filter((entry) =>
          entry.hydrated.result.duration_seconds !== null &&
          entry.hydrated.result.duration_seconds !== undefined &&
          Math.abs(entry.hydrated.result.duration_seconds - canonicalDuration) <= 3
        )
      : [];
    if (durationMatches.length) {
      // Roon may expose the same MusicBrainz recording through several country,
      // service or compilation editions. Once title, credits, version family
      // and canonical duration agree, edition differences are not ambiguity.
      return durationMatches[0].candidate;
    }
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
    queries: string[],
    catalogProfile: TrackCatalogProfile | null = null
  ): Promise<HydratedCandidateResult> {
    const enriched = await this.metadataService.enrichResult(result, {
      title: input.title,
      artist: input.artist,
      album: input.albumHint,
      catalog_profile: catalogProfile,
      verify_release: Boolean(input.albumHint) &&
        (exactRecordingFamily(input) || input.performanceSensitive)
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
    const canonicalArtist = catalogArtistCredit(catalogProfile)
      || result.artist || result.subtitle || input.artist;
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
    const byStatus: Record<string, number> = {};
    const byReason: Record<string, number> = {};
    for (const rejection of session.rejected) {
      byStatus[rejection.status] = (byStatus[rejection.status] || 0) + 1;
      const reason = rejection.reason.split(":")[0];
      byReason[reason] = (byReason[reason] || 0) + 1;
    }
    const recoveryActions = new Set<string>();
    if (Object.keys(byReason).some((reason) => reason.startsWith("musicbrainz_ambiguous"))) {
      recoveryActions.add("Use a more specific album or recording version when manually repairing ambiguous entries.");
    }
    if (Object.keys(byReason).some((reason) => reason.startsWith("musicbrainz_not_found"))) {
      recoveryActions.add("Replace not-found proposals with another known recording.");
    }
    if (Object.keys(byReason).some((reason) => reason.startsWith("roon_binding_required"))) {
      recoveryActions.add("Use manual Roon search only to repair entries that have no playable binding.");
    }
    if (byStatus.duplicate) {
      recoveryActions.add("Use different recordings instead of another edition of the same recording.");
    }
    if (Object.keys(byReason).some((reason) => reason.includes("release_year"))) {
      recoveryActions.add("Replace tracks whose MusicBrainz first-publication year does not satisfy the requested range.");
    }
    const multiplier = RESERVE_MULTIPLIERS[session.selectionComplexity];
    const recommendedCandidates = session.desiredCount
      ? Math.ceil(session.desiredCount * multiplier)
      : null;
    const sum = (field: keyof Pick<
      CandidateResolutionMetrics,
      | "catalog_ms"
      | "musicbrainz_requests"
      | "musicbrainz_cache_hits"
      | "listenbrainz_requests"
      | "listenbrainz_cache_hits"
      | "roon_speculative_ms"
      | "roon_fallback_ms"
      | "roon_searches"
      | "hydration_ms"
    >) => session.candidateMetrics.reduce((total, entry) => total + entry[field], 0);
    return {
      phase,
      desired_count: session.desiredCount || null,
      added_count: scheduled.selected.length,
      missing_count: missing,
      complete: missing === null || missing === 0,
      playlist,
      accepted,
      rejected: session.rejected.slice(-25),
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
      },
      rejection_summary: {
        total: session.rejected.length,
        returned_candidates: Math.min(25, session.rejected.length),
        by_status: byStatus,
        by_reason: byReason,
        recovery_actions: [...recoveryActions]
      },
      performance: {
        elapsed_ms: Date.now() - session.startedAt,
        candidates_started: session.candidateMetrics.length,
        candidates_accepted: session.candidateMetrics.filter((entry) => entry.outcome === "accepted").length,
        candidates_rejected: session.candidateMetrics.filter((entry) => entry.outcome === "rejected").length,
        catalog_ms_total: sum("catalog_ms"),
        musicbrainz_requests: sum("musicbrainz_requests"),
        musicbrainz_cache_hits: sum("musicbrainz_cache_hits"),
        listenbrainz_requests: sum("listenbrainz_requests"),
        listenbrainz_cache_hits: sum("listenbrainz_cache_hits"),
        roon_speculative_ms_total: sum("roon_speculative_ms"),
        roon_fallback_ms_total: sum("roon_fallback_ms"),
        roon_searches: sum("roon_searches"),
        hydration_ms_total: sum("hydration_ms"),
        speculative_bindings_reused: session.candidateMetrics
          .filter((entry) => entry.speculative_binding_reused).length,
        canonical_roon_fallbacks: session.candidateMetrics
          .filter((entry) => entry.roon_fallback_ms > 0).length,
        bindings_created: session.candidateMetrics.filter((entry) => entry.binding_created).length,
        reserve_policy: {
          complexity: session.selectionComplexity,
          multiplier,
          desired_count: session.desiredCount || null,
          recommended_candidates: recommendedCandidates,
          supplied_candidates: session.suppliedCandidates,
          sufficient: recommendedCandidates === null
            ? null
            : session.suppliedCandidates >= recommendedCandidates
        },
        metadata_enrichment: {
          mode: session.enqueueMetadataEnrichment ? "background" : "disabled",
          queued_tracks: scheduled.selected.filter((candidate) =>
            candidate.catalogProfile?.warnings.includes("metadata_enrichment_pending")
          ).length
        }
      },
      ...(session.diagnostics ? {
        diagnostics: {
          rejected_candidates: session.rejected,
          candidate_metrics: session.candidateMetrics
        }
      } : {})
    };
  }
}
