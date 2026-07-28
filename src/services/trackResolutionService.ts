import {
  MediaResult,
  RoonMediaService,
  scoreSearchResult,
  SourcePreference,
  VersionHint
} from "../roon/roonMediaService";

export type TrackResolutionRequest = {
  query: string;
  preferredResultId?: string | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  releaseYear?: number | null;
  versionHint?: VersionHint | null;
  sourcePreference?: SourcePreference;
  count?: number;
  includeExactQuery?: boolean;
};

export type RankedTrackCandidate = {
  result: MediaResult;
  identity_score: number;
  match_score: number;
  source_rank: number;
  quality_rank: number;
  reasons: string[];
  penalties: string[];
  recording_key: string;
};

export type TrackResolution = {
  status: "resolved" | "ambiguous" | "missing";
  reason: "selected_supplied_result" | "selected_equivalent_recording" | "multiple_recordings" | "low_identity_confidence" | "no_results";
  selected: RankedTrackCandidate | null;
  candidates: RankedTrackCandidate[];
  queries: string[];
};

const MIN_IDENTITY_SCORE = 90;
const AMBIGUOUS_IDENTITY_DELTA = 10;

function normalize(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function baseVersion(version: VersionHint | null | undefined): "studio" | "live" | "remix" | "edit" | "cover" | "alternate" {
  if (!version || version === "studio" || version === "remaster") return "studio";
  if (version === "live" || version === "remix" || version === "edit" || version === "cover") return version;
  return "alternate";
}

function baseTitle(value: string): string {
  return normalize(String(value || "")
    .replace(/\s*[([]\s*\d{2,3}\s*[\])]\s*$/u, " "))
    .replace(
      /\b(?:live|en vivo|directo|concert|remaster(?:ed|ing)?|remix|mix|rework|refix|dub|radio edit|edit|acoustic|unplugged|cover|tribute|version|alternate|binaural|3d)\b.*$/giu,
      ""
    )
    .trim();
}

function artistCredits(result: MediaResult): string[] {
  return Array.from(new Set([
    ...(result.artists || []).map((artist) => artist.title),
    result.artist,
    result.album_artist,
    result.subtitle
  ].filter((value): value is string => Boolean(value)).map(normalize).filter(Boolean)));
}

function artistMatchScore(expected: string, result: MediaResult): number {
  const requested = normalize(expected);
  const requestedTokens = requested.split(" ").filter((token) => token.length > 2);
  let best = -40;
  for (const credit of artistCredits(result)) {
    if (credit === requested) best = Math.max(best, 35);
    else if (credit.includes(requested) || requested.includes(credit)) best = Math.max(best, 30);
    else {
      const matched = requestedTokens.filter((token) => credit.includes(token)).length;
      const ratio = requestedTokens.length ? matched / requestedTokens.length : 0;
      if (ratio >= 0.75) best = Math.max(best, 20);
    }
  }
  return best;
}

function identityScore(result: MediaResult, request: TrackResolutionRequest): { score: number; reasons: string[]; penalties: string[] } {
  const reasons: string[] = [];
  const penalties: string[] = [];
  let score = result.playable && result.roon_item_key ? 5 : -35;
  if (score > 0) reasons.push("playable_reference");
  else penalties.push("not_playable");

  const expectedTitle = normalize(request.title || request.query);
  const resultTitle = normalize(result.title);
  if (resultTitle === expectedTitle) {
    score += 60;
    reasons.push("exact_title");
  } else if (baseTitle(result.title) === baseTitle(request.title || request.query)) {
    score += 52;
    reasons.push("same_base_title");
  } else if (resultTitle.includes(expectedTitle) || expectedTitle.includes(resultTitle)) {
    score += 22;
    reasons.push("partial_title");
    penalties.push("title_not_exact");
  } else {
    score -= 50;
    penalties.push("title_mismatch");
  }

  if (request.artist) {
    const artistScore = artistMatchScore(request.artist, result);
    score += artistScore;
    if (artistScore >= 30) reasons.push("exact_artist");
    else if (artistScore > 0) reasons.push("partial_artist");
    else penalties.push("artist_mismatch");
  }

  if (request.album) {
    const expectedAlbum = normalize(request.album);
    const resultAlbum = normalize(result.album);
    if (resultAlbum === expectedAlbum) {
      score += 10;
      reasons.push("exact_album");
    } else if (resultAlbum && (resultAlbum.includes(expectedAlbum) || expectedAlbum.includes(resultAlbum))) {
      score += 5;
      reasons.push("partial_album");
    } else {
      score -= 5;
      penalties.push("album_mismatch");
    }
  }

  if (request.releaseYear && result.release_year) {
    const delta = Math.abs(request.releaseYear - result.release_year);
    if (delta === 0) {
      score += 6;
      reasons.push("exact_release_year");
    } else if (delta <= 1) {
      score += 3;
      reasons.push("near_release_year");
    } else {
      score -= 3;
      penalties.push("release_year_mismatch");
    }
  }

  const requestedVersion = request.versionHint === "unknown"
    ? null
    : baseVersion(request.versionHint);
  if (requestedVersion) {
    const actualVersion = baseVersion(result.version_hint);
    if (actualVersion === requestedVersion) {
      score += requestedVersion === "studio" ? 15 : 12;
      reasons.push(`requested_${requestedVersion}_version`);
    } else {
      score -= actualVersion === "live" || actualVersion === "remix" || actualVersion === "cover" ? 40 : 20;
      penalties.push(`unexpected_${actualVersion}_version`);
    }
  }

  return { score: Math.max(0, Math.min(130, score)), reasons, penalties };
}

function qualityRank(result: MediaResult): number {
  const quality = result.quality;
  if (!quality) return 0;
  const format = normalize(quality.format || quality.label);
  const codec = /\b(?:flac|alac|mqa|dsd)\b/.test(format)
    ? 100_000
    : /\b(?:mp3|aac|ogg)\b/.test(format)
      ? -10_000
      : 0;
  return codec + (quality.bit_depth || 0) * 1_000 + Math.round((quality.sample_rate_hz || 0) / 100);
}

function sourceRank(result: MediaResult, preference: SourcePreference): number {
  if (preference === "library_first") {
    return result.source === "library" ? 300 : result.source === "tidal" ? 200 : result.source === "qobuz" ? 180 : 0;
  }
  if (preference === "streaming_first") {
    return result.source === "tidal" ? 300 : result.source === "qobuz" ? 250 : result.source === "library" ? 100 : 0;
  }
  return result.source === "tidal" ? 200 : result.source === "qobuz" ? 180 : result.source === "library" ? 100 : 0;
}

function recordingKey(result: MediaResult): string {
  const primaryArtist = artistCredits(result)[0] || "unknown";
  const isrc = normalize(String((result as MediaResult & { isrc?: string | null }).isrc || ""));
  const duration = result.duration_seconds ? `duration:${Math.round(result.duration_seconds)}` : "";
  const releaseAnchor = isrc || duration || normalize(result.album) || `unverified:${result.result_id}`;
  return [baseTitle(result.title), primaryArtist, baseVersion(result.version_hint), releaseAnchor].join("|");
}

function compareCandidates(left: RankedTrackCandidate, right: RankedTrackCandidate, preference: SourcePreference): number {
  const identity = right.identity_score - left.identity_score;
  if (identity !== 0) return identity;
  if (preference === "highest_quality") {
    return right.quality_rank - left.quality_rank || right.source_rank - left.source_rank || right.match_score - left.match_score;
  }
  return right.source_rank - left.source_rank || right.quality_rank - left.quality_rank || right.match_score - left.match_score;
}

function candidateIdentity(result: MediaResult): string {
  return [
    result.result_id,
    normalize(result.title),
    artistCredits(result).join("/"),
    normalize(result.album),
    result.version_hint,
    result.source,
    result.quality?.label || ""
  ].join("|");
}

export class TrackResolutionService {
  constructor(private readonly mediaService: RoonMediaService) {}

  async resolve(request: TrackResolutionRequest): Promise<TrackResolution> {
    const sourcePreference = request.sourcePreference || "streaming_first";
    const exactQuery = [request.title, request.artist].filter(Boolean).join(" ").trim();
    const queries = Array.from(new Set([
      request.includeExactQuery === false ? "" : exactQuery,
      request.query.trim()
    ].filter(Boolean)));
    const executedQueries: string[] = [];
    const results: MediaResult[] = [];
    const seen = new Set<string>();
    if (request.preferredResultId) {
      try {
        const preferred = this.mediaService.get(request.preferredResultId);
        if (preferred.media_type === "track") {
          seen.add(candidateIdentity(preferred));
          results.push(preferred);
          if (identityScore(preferred, request).score >= MIN_IDENTITY_SCORE) {
            const ranked = this.rank(results, request, sourcePreference);
            return {
              status: "resolved",
              reason: "selected_supplied_result",
              selected: ranked[0],
              candidates: ranked,
              queries: []
            };
          }
        }
      } catch {
        // Search references are intentionally short-lived. An expired reference
        // falls back to deterministic title/artist discovery.
      }
    }

    for (const query of queries) {
      executedQueries.push(query);
      const payload = await this.mediaService.search({
        query,
        types: ["track"],
        count: Math.max(10, Math.min(request.count || 25, 25)),
        sourcePreference,
        strategy: {
          avoid_live: !request.versionHint || request.versionHint === "studio" || request.versionHint === "remaster",
          avoid_remix: !request.versionHint || request.versionHint === "studio" || request.versionHint === "remaster",
          avoid_cover: !request.versionHint || request.versionHint === "studio" || request.versionHint === "remaster",
          prefer_original_album: !request.versionHint || request.versionHint === "studio"
        }
      });
      for (const result of payload.results.filter((candidate) => candidate.media_type === "track")) {
        const identity = candidateIdentity(result);
        if (seen.has(identity)) continue;
        seen.add(identity);
        results.push(result);
      }
      if (results.some((result) => identityScore(result, request).score >= MIN_IDENTITY_SCORE)) break;
    }

    if (!results.length) {
      return {
        status: "missing",
        reason: "no_results",
        selected: null,
        candidates: [],
        queries: executedQueries
      };
    }

    const ranked = this.rank(results, request, sourcePreference);
    return this.classify(ranked, request, executedQueries);
  }

  reconcile(
    request: TrackResolutionRequest,
    results: MediaResult[],
    queries: string[] = []
  ): TrackResolution {
    if (!results.length) {
      return { status: "missing", reason: "no_results", selected: null, candidates: [], queries };
    }
    const ranked = this.rank(
      results,
      request,
      request.sourcePreference || "streaming_first"
    );
    return this.classify(ranked, request, queries);
  }

  private classify(
    ranked: RankedTrackCandidate[],
    request: TrackResolutionRequest,
    queries: string[]
  ): TrackResolution {
    const best = ranked[0];
    const titleOnlyAmbiguity = !request.artist && ranked.find((candidate) =>
      candidate.result.result_id !== best?.result.result_id &&
      candidate.recording_key !== best?.recording_key &&
      baseTitle(candidate.result.title) === baseTitle(request.title || request.query) &&
      candidate.identity_score >= MIN_IDENTITY_SCORE - 15
    );
    if (best && titleOnlyAmbiguity) {
      return { status: "ambiguous", reason: "multiple_recordings", selected: null, candidates: ranked.slice(0, 5), queries };
    }
    if (!best || best.identity_score < MIN_IDENTITY_SCORE) {
      return { status: "missing", reason: "low_identity_confidence", selected: null, candidates: ranked.slice(0, 5), queries };
    }

    const competingRecording = ranked.find((candidate) =>
      candidate.recording_key !== best.recording_key &&
      candidate.identity_score >= MIN_IDENTITY_SCORE &&
      best.identity_score - candidate.identity_score <= AMBIGUOUS_IDENTITY_DELTA
    );
    if (competingRecording) {
      return { status: "ambiguous", reason: "multiple_recordings", selected: null, candidates: ranked.slice(0, 5), queries };
    }

    return { status: "resolved", reason: "selected_equivalent_recording", selected: best, candidates: ranked.slice(0, 5), queries };
  }

  private rank(
    results: MediaResult[],
    request: TrackResolutionRequest,
    sourcePreference: SourcePreference
  ): RankedTrackCandidate[] {
    return results.map((result): RankedTrackCandidate => {
      const identity = identityScore(result, request);
      const generic = scoreSearchResult(result, {
        query: request.query,
        title: request.title,
        artist: request.artist,
        album: request.album,
        sourcePreference
      });
      return {
        result,
        identity_score: identity.score,
        match_score: generic.score,
        source_rank: sourceRank(result, sourcePreference),
        quality_rank: qualityRank(result),
        reasons: Array.from(new Set([...identity.reasons, ...generic.reasons])),
        penalties: Array.from(new Set([...identity.penalties, ...generic.penalties])),
        recording_key: recordingKey(result)
      };
    }).sort((left, right) => compareCandidates(left, right, sourcePreference));
  }
}
