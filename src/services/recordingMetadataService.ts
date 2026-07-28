import crypto from "crypto";
import { APP_VERSION } from "../config/version";
import {
  ListenBrainzLookupResult,
  ListenBrainzMetadataService
} from "./listenBrainzMetadataService";
import { MetadataProviderCacheService } from "./metadataProviderCacheService";

export type RecordingCatalogMetadata = {
  recording_id: string;
  title: string;
  artist: string | null;
  artists: string[];
  artist_credit: Array<{
    musicbrainz_id: string | null;
    name: string;
    join_phrase: string;
  }>;
  album: string | null;
  disambiguation: string | null;
  duration_seconds: number | null;
  release_year: number | null;
  original_release_year: number | null;
  isrc: string | null;
  isrcs: string[];
  composers: string[];
  lyricists: string[];
  genres: string[];
  release_candidates: RecordingCatalogReleaseCandidate[];
  confidence: "high" | "medium";
  video?: boolean;
  artist_entities?: Array<{
    musicbrainz_id: string;
    name: string;
    sort_name: string | null;
    disambiguation: string | null;
    type: string | null;
    country: string | null;
    credited_name: string;
    join_phrase: string;
  }>;
  work?: {
    musicbrainz_id: string;
    title: string;
    type: string | null;
    language: string | null;
    iswcs: string[];
    disambiguation: string | null;
    relation_type: string;
    relation_attributes: string[];
  } | null;
  credits?: Array<{
    musicbrainz_id: string | null;
    name: string;
    credited_name: string | null;
    role: "composer" | "lyricist" | "writer" | "arranger";
    attributes: string[];
  }>;
  genre_details?: Array<{
    name: string;
    count: number;
    entity: "recording" | "work";
  }>;
  release_groups?: Array<{
    musicbrainz_id: string;
    title: string;
    first_release_date: string | null;
    primary_type: string | null;
    secondary_types: string[];
    disambiguation: string | null;
  }>;
};

export type RecordingCatalogReleaseCandidate = {
  release_id: string;
  release_group_id: string | null;
  title: string;
  album_artist: string | null;
  date: string | null;
  release_year: number | null;
  country: string | null;
  status: string | null;
  primary_type: string | null;
  secondary_types: string[];
  medium_position: number | null;
  track_position: number | null;
  track_count: number | null;
  cover_art_archive: {
    artwork: boolean;
    front: boolean;
    back: boolean;
  };
};

export type RecordingReleasesCatalogResult = {
  releases: RecordingCatalogReleaseCandidate[];
  truncated: boolean;
  trace: CatalogProviderTrace;
};

export type RecordingReleaseAnchorCatalogResult = {
  releases: RecordingCatalogReleaseCandidate[];
  trace: CatalogProviderTrace;
};

export type ReleaseTrackCatalogMetadata = {
  release_id: string;
  release_group_id: string | null;
  title: string;
  album_artist: string | null;
  date: string | null;
  release_year: number | null;
  country: string | null;
  status: string | null;
  primary_type: string | null;
  secondary_types: string[];
  medium_position: number;
  track_position: number;
  track_number: string | null;
  track_title: string;
  duration_seconds: number | null;
  cover_art_archive: {
    artwork: boolean;
    front: boolean;
    back: boolean;
  };
  barcode?: string | null;
  packaging?: string | null;
  labels?: Array<{
    musicbrainz_id: string | null;
    name: string;
    catalog_number: string | null;
  }>;
  media_format?: string | null;
};

export type ReleaseTrackCatalogResolution = {
  status: "exact" | "conflict" | "not_found";
  reason: string;
  metadata: ReleaseTrackCatalogMetadata | null;
  trace: CatalogProviderTrace;
};

export type RecordingCatalogCandidate = {
  recording_id: string;
  title: string;
  disambiguation: string | null;
  duration_seconds: number | null;
  isrcs: string[];
  releases: string[];
};

export type RecordingCatalogResolution = {
  status: "exact" | "conflict" | "not_found";
  reason: string;
  metadata: RecordingCatalogMetadata | null;
  candidates: RecordingCatalogCandidate[];
  trace: CatalogProviderTrace;
};

export type CatalogProviderTrace = {
  cache_hit: boolean;
  cache_layer: "memory" | "persistent" | null;
  elapsed_ms: number;
  provider_requests: number;
  search_attempts: Array<{
    title: string;
    artist: string;
    album: string | null;
    result_count: number;
  }>;
  candidate_counts: {
    returned: number;
    accepted: number;
    rejected: number;
  };
  rejected_candidates: Array<{
    recording_id: string | null;
    title: string | null;
    disambiguation: string | null;
    reasons: string[];
  }>;
  accepted_warnings: string[];
  listenbrainz?: {
    elapsed_ms: number;
    provider_requests: number;
    cache_hits: number;
    candidate_count: number;
    acr_count: number;
    acrr_count: number;
  };
};

type MutableCatalogProviderTrace = Omit<CatalogProviderTrace, "elapsed_ms">;

type FetchLike = typeof fetch;
type JsonRecord = Record<string, unknown>;

const EXACT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONFLICT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NOT_FOUND_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 1100;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 1000;
const MUSICBRAINZ_PROVIDER = "musicbrainz";
const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "de", "del", "e", "el", "en", "et", "feat", "featuring",
  "in", "is", "la", "las", "le", "los", "of", "the", "un", "una", "une", "y"
]);

function objectValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(objectValue).filter((item): item is JsonRecord => Boolean(item)) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
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

function lucene(value: string): string {
  return value.replace(/[\\"]/g, "\\$&");
}

function luceneTerm(value: string): string {
  return value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
}

function titleTokens(value: unknown): string[] {
  const all = Array.from(new Set(normalize(value).split(" ").filter(Boolean)));
  const significant = all.filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
  return significant.length ? significant : all;
}

function tokenRatio(expected: unknown, observed: unknown): number {
  const wanted = titleTokens(expected);
  const available = new Set(titleTokens(observed));
  if (!wanted.length) return 0;
  return wanted.filter((token) => available.has(token)).length / wanted.length;
}

function compatibleTitle(expected: unknown, observed: unknown): boolean {
  const left = normalize(expected);
  const right = normalize(observed);
  return Boolean(left && right) && (
    left === right ||
    left.includes(right) ||
    right.includes(left) ||
    tokenRatio(expected, observed) >= 0.8
  );
}

function year(value: unknown): number | null {
  const match = String(value || "").match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  return match ? Number(match[1]) : null;
}

function durationSeconds(value: unknown): number | null {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds >= 30_000 && milliseconds <= 30 * 60_000
    ? Math.round(milliseconds / 1000)
    : null;
}

function integer(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : null;
}

function artistNames(value: unknown): string[] {
  return records(value).flatMap((credit) => {
    const artist = objectValue(credit.artist);
    const name = typeof credit.name === "string"
      ? credit.name
      : typeof artist?.name === "string"
        ? artist.name
        : null;
    return name ? [name] : [];
  });
}

function artistEquivalent(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  const withoutArticle = (value: string) => value.replace(/^the\s+/, "");
  return withoutArticle(normalizedLeft) === withoutArticle(normalizedRight);
}

function artistCredit(value: unknown): RecordingCatalogMetadata["artist_credit"] {
  return records(value).flatMap((credit) => {
    const artist = objectValue(credit.artist);
    const name = typeof credit.name === "string"
      ? credit.name
      : typeof artist?.name === "string"
        ? artist.name
        : null;
    if (!name) return [];
    return [{
      musicbrainz_id: typeof artist?.id === "string" ? artist.id : null,
      name,
      join_phrase: typeof credit.joinphrase === "string" ? credit.joinphrase : ""
    }];
  });
}

function artistEntities(value: unknown): NonNullable<RecordingCatalogMetadata["artist_entities"]> {
  return records(value).flatMap((credit) => {
    const artist = objectValue(credit.artist);
    if (typeof artist?.id !== "string" || typeof artist.name !== "string") return [];
    return [{
      musicbrainz_id: artist.id,
      name: artist.name,
      sort_name: typeof artist["sort-name"] === "string" ? artist["sort-name"] : null,
      disambiguation: typeof artist.disambiguation === "string" && artist.disambiguation
        ? artist.disambiguation
        : null,
      type: typeof artist.type === "string" && artist.type ? artist.type : null,
      country: typeof artist.country === "string" && artist.country ? artist.country : null,
      credited_name: typeof credit.name === "string" && credit.name ? credit.name : artist.name,
      join_phrase: typeof credit.joinphrase === "string" ? credit.joinphrase : ""
    }];
  });
}

function relationAttributes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((attribute) => {
        if (typeof attribute === "string" && attribute.trim()) return [attribute.trim()];
        const record = objectValue(attribute);
        return typeof record?.name === "string" && record.name.trim() ? [record.name.trim()] : [];
      })
    : [];
}

function relationshipCredits(
  relations: JsonRecord[]
): NonNullable<RecordingCatalogMetadata["credits"]> {
  const supported = new Set(["composer", "lyricist", "writer", "arranger"]);
  return relations.flatMap((relation) => {
    const role = String(relation.type || "").toLowerCase();
    if (!supported.has(role)) return [];
    const artist = objectValue(relation.artist);
    if (typeof artist?.name !== "string" || !artist.name.trim()) return [];
    return [{
      musicbrainz_id: typeof artist.id === "string" ? artist.id : null,
      name: artist.name,
      credited_name: typeof relation["target-credit"] === "string" && relation["target-credit"]
        ? String(relation["target-credit"])
        : null,
      role: role as "composer" | "lyricist" | "writer" | "arranger",
      attributes: relationAttributes(relation.attributes)
    }];
  });
}

function releaseGroups(value: unknown): NonNullable<RecordingCatalogMetadata["release_groups"]> {
  const groups = records(value).flatMap((release) => {
    const group = releaseGroup(release);
    if (typeof group?.id !== "string") return [];
    return [{
      musicbrainz_id: group.id,
      title: typeof group.title === "string" && group.title ? group.title : String(release.title || ""),
      first_release_date: typeof group["first-release-date"] === "string" && group["first-release-date"]
        ? group["first-release-date"]
        : null,
      primary_type: typeof group["primary-type"] === "string" ? group["primary-type"] : null,
      secondary_types: strings(group["secondary-types"]),
      disambiguation: typeof group.disambiguation === "string" && group.disambiguation
        ? group.disambiguation
        : null
    }];
  });
  return Array.from(new Map(groups.map((group) => [group.musicbrainz_id, group])).values());
}

function emptyTrace(): MutableCatalogProviderTrace {
  return {
    cache_hit: false,
    cache_layer: null,
    provider_requests: 0,
    search_attempts: [],
    candidate_counts: { returned: 0, accepted: 0, rejected: 0 },
    rejected_candidates: [],
    accepted_warnings: []
  };
}

function completedTrace(trace: MutableCatalogProviderTrace, startedAt: number): CatalogProviderTrace {
  return { ...trace, elapsed_ms: Math.max(0, Date.now() - startedAt) };
}

function cacheTrace(
  previous: CatalogProviderTrace | undefined,
  layer: "memory" | "persistent",
  startedAt: number
): CatalogProviderTrace {
  return {
    ...(previous || completedTrace(emptyTrace(), startedAt)),
    cache_hit: true,
    cache_layer: layer,
    elapsed_ms: Math.max(0, Date.now() - startedAt),
    provider_requests: 0
  };
}

function baseRecordingTitle(value: unknown): string {
  return normalize(value)
    .replace(/\b(?:remaster(?:ed)?|stereo mix|mono mix|mix|lp version|album version|single version|radio edit|single edit)\b(?:\s+(?:19|20)\d{2})?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recordingSearchTitle(value: unknown): string {
  return String(value || "")
    .replace(/\s*[([](?:remaster(?:ed)?|\d{4}\s+remaster(?:ed)?|live|mono|stereo|mix|lp version|album version|single version|radio edit|single edit)(?:\s+\d{4})?[^\])]*[\])]\s*$/iu, "")
    .replace(/\s*[([][^\])]*\b(?:remix|mix|edit|version|session|live|rewound|rework|extended|acoustic|cover|dub)\b[^\])]*[\])]\s*$/iu, "")
    .replace(/\s*[-\u2013\u2014]\s*(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\s*$/iu, "")
    .replace(/\s*[-\u2013\u2014]\s+.*\b(?:remix|mix|edit|version|session|live|rewound|rework|extended|acoustic|cover|dub)\b.*$/iu, "")
    .trim();
}

function variantCoreSearchTitle(value: unknown): string {
  const normalized = recordingSearchTitle(value);
  const withoutDescriptor = normalized
    .replace(/\s*[([][^\])]+[\])]\s*$/u, "")
    .replace(/\s*[-\u2013\u2014]\s+[^-\u2013\u2014]+$/u, "")
    .trim();
  return withoutDescriptor || normalized;
}

function releaseKey(value: unknown): string {
  return normalize(String(value || "")
    .replace(/\s*[([]\s*(?:(?:19|20)\d{2}|live|(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|[^)\]]*\bedition)\s*[\])]\s*$/iu, " "))
    .replace(/\b(?:super deluxe(?: edition)?|deluxe edition|expanded edition)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function releaseSearchAlias(value: string): string {
  return value
    .replace(/\s*[([](?:19|20)\d{2}[\])]\s*$/u, " ")
    .replace(/\s*\((?:super\s+)?deluxe(?:\s+edition)?\)\s*/gi, " ")
    .replace(/\s*:\s*/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
}

type VariantProfile = {
  live: boolean;
  remix: boolean;
  dub: boolean;
  acoustic: boolean;
  edit: boolean;
  atmosphere: boolean;
  demo: boolean;
  alternate: boolean;
  albumVersion: boolean;
  original: boolean;
  remaster: boolean;
  year: number | null;
};

function variantProfile(value: unknown, hint?: string | null): VariantProfile {
  const text = normalize([value, hint].filter(Boolean).join(" "));
  const dub = /\b(?:dub mix|dub version|version dub|dubs)\b/.test(text);
  const acoustic = /\b(?:acoustic|unplugged|acustico)\b/.test(text);
  const masteringMix = /\boriginal(?:\s+\w+){0,3}\s+mix\b|\b(?:stereo|mono)\s+mix\b/.test(text);
  const namedMix = /\b(?:remix(?:es)?|rework|remodel|rewound)\b/.test(text) ||
    (
      /\bmix(?:es)?\b/.test(text) &&
      !masteringMix
    );
  return {
    live: /\b(?:live|concert|en vivo|directo)\b/.test(text),
    remix: namedMix,
    dub,
    acoustic,
    edit: /\b(?:single edit|radio edit|edit)\b/.test(text),
    atmosphere: /\b(?:atmos|dolby atmos|5 1|binaural|3d)\b/.test(text),
    demo: /\b(?:demo|session|take)\b/.test(text),
    alternate: /\b(?:alternate|alternative)\b/.test(text),
    albumVersion: /\b(?:lp version|album version)\b/.test(text),
    original: /\boriginal (?:studio|album|stereo|mono)? ?(?:mix|version)?\b/.test(text),
    remaster: /\bremaster(?:ed)?\b/.test(text),
    year: year(text)
  };
}

function recordingVariantProfile(value: unknown, hint?: string | null): VariantProfile {
  const withoutMastering = [value, hint]
    .filter(Boolean)
    .join(" ")
    .replace(/\b(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\b/giu, " ");
  const profile = variantProfile(withoutMastering);
  return { ...profile, remaster: false, year: null };
}

function variantStrength(requested: VariantProfile, candidateText: string): number | null {
  const candidate = variantProfile(candidateText);
  if (requested.year && candidate.year !== requested.year) return null;
  const acousticLivePerformance =
    requested.acoustic && candidate.acoustic && candidate.live;
  if (
    requested.live !== candidate.live &&
    (requested.live || candidate.live) &&
    !acousticLivePerformance
  ) {
    return null;
  }
  if (requested.remix !== candidate.remix && (requested.remix || candidate.remix)) return null;
  if (requested.dub !== candidate.dub && (requested.dub || candidate.dub)) return null;
  const liveAcousticPerformance =
    requested.live && candidate.live && candidate.acoustic;
  if (
    requested.acoustic !== candidate.acoustic &&
    (requested.acoustic || candidate.acoustic) &&
    !liveAcousticPerformance
  ) {
    return null;
  }
  if (requested.edit !== candidate.edit && (requested.edit || candidate.edit)) return null;
  if (requested.demo !== candidate.demo && (requested.demo || candidate.demo)) return null;
  if (requested.atmosphere !== candidate.atmosphere && (requested.atmosphere || candidate.atmosphere)) return null;
  if (!requested.alternate && candidate.alternate) return null;
  if (requested.albumVersion) return candidate.original ? 8 : candidateText.trim() ? 3 : 4;
  if (requested.year) return 8;
  if (requested.remaster && !candidate.remaster && !candidate.year) return null;
  if (requested.original) return candidate.original ? 8 : null;
  if (
    requested.live || requested.remix || requested.dub || requested.acoustic ||
    requested.edit || requested.demo || requested.atmosphere || requested.alternate
  ) return 7;
  if (candidate.original) return 6;
  return candidateText.trim() ? 3 : 5;
}

function releaseTitles(recording: JsonRecord): string[] {
  return records(recording.releases)
    .map((release) => typeof release.title === "string" ? release.title : "")
    .filter(Boolean);
}

function releaseGroup(release: JsonRecord): JsonRecord | null {
  return objectValue(release["release-group"]);
}

function coverArtArchive(value: unknown): { artwork: boolean; front: boolean; back: boolean } {
  const cover = objectValue(value);
  return {
    artwork: cover?.artwork === true,
    front: cover?.front === true,
    back: cover?.back === true
  };
}

function releaseCandidate(release: JsonRecord): RecordingCatalogReleaseCandidate | null {
  if (typeof release.id !== "string" || typeof release.title !== "string") return null;
  const group = releaseGroup(release);
  const media = records(release.media);
  const matchingMedium = media.find((medium) => integer(medium["track-offset"]) !== null) || media[0] || null;
  const trackOffset = integer(matchingMedium?.["track-offset"]);
  return {
    release_id: release.id,
    release_group_id: typeof group?.id === "string" ? group.id : null,
    title: release.title,
    album_artist: artistNames(release["artist-credit"])[0] || null,
    date: typeof release.date === "string" && release.date ? release.date : null,
    release_year: year(release.date),
    country: typeof release.country === "string" && release.country ? release.country : null,
    status: typeof release.status === "string" && release.status ? release.status : null,
    primary_type: typeof group?.["primary-type"] === "string" ? String(group["primary-type"]) : null,
    secondary_types: strings(group?.["secondary-types"]),
    medium_position: integer(matchingMedium?.position),
    track_position: trackOffset === null ? null : trackOffset + 1,
    track_count: integer(matchingMedium?.["track-count"]),
    cover_art_archive: coverArtArchive(release["cover-art-archive"])
  };
}

function compatibleReleases(recording: JsonRecord, album?: string | null): JsonRecord[] {
  const releases = records(recording.releases);
  if (!album) return releases;
  const expected = releaseKey(album);
  return releases.filter((release) => releaseKey(release.title) === expected);
}

function candidateSnapshot(recording: JsonRecord): RecordingCatalogCandidate {
  return {
    recording_id: String(recording.id || ""),
    title: String(recording.title || ""),
    disambiguation: typeof recording.disambiguation === "string" && recording.disambiguation.trim()
      ? recording.disambiguation
      : null,
    duration_seconds: durationSeconds(recording.length),
    isrcs: strings(recording.isrcs),
    releases: Array.from(new Set(releaseTitles(recording))).slice(0, 12)
  };
}

function setMusicBrainzIncludes(url: URL, includes: string[]): void {
  // URLSearchParams encodes a literal "+" as %2B, which MusicBrainz rejects.
  // Spaces serialize as the literal "+" separator required by its inc syntax.
  url.searchParams.set("inc", includes.join(" "));
}

export class RecordingMetadataService {
  private readonly cache = new Map<string, { expiresAt: number; value: RecordingCatalogResolution }>();
  private readonly releaseTrackCache = new Map<string, { expiresAt: number; value: ReleaseTrackCatalogResolution }>();
  private readonly recordingReleasesCache = new Map<string, { expiresAt: number; value: RecordingReleasesCatalogResult }>();
  private readonly recordingReleaseAnchorCache = new Map<string, {
    expiresAt: number;
    value: RecordingReleaseAnchorCatalogResult;
  }>();
  private requestChain: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  private readonly persistentCache?: MetadataProviderCacheService;
  private readonly minRequestIntervalMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly listenBrainz?: ListenBrainzMetadataService;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    options: {
      cache?: MetadataProviderCacheService;
      listenBrainz?: ListenBrainzMetadataService;
      minRequestIntervalMs?: number;
      maxRetries?: number;
      retryBaseMs?: number;
      sleep?: (milliseconds: number) => Promise<void>;
    } = {}
  ) {
    this.persistentCache = options.cache;
    this.listenBrainz = options.listenBrainz;
    this.minRequestIntervalMs = Math.max(0, options.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS);
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryBaseMs = Math.max(0, options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private async waitForRequestSlot(): Promise<void> {
    let releaseRequest: () => void = () => undefined;
    const previous = this.requestChain;
    this.requestChain = new Promise<void>((resolve) => { releaseRequest = resolve; });
    await previous;
    try {
      const waitMs = Math.max(0, this.minRequestIntervalMs - (Date.now() - this.lastRequestAt));
      if (waitMs) await this.sleep(waitMs);
      this.lastRequestAt = Date.now();
    } finally {
      releaseRequest();
    }
  }

  private retryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    }
    return this.retryBaseMs * (2 ** attempt);
  }

  private async requestJson(url: URL, trace?: MutableCatalogProviderTrace): Promise<JsonRecord> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForRequestSlot();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      let receivedResponse = false;
      try {
        if (trace) trace.provider_requests += 1;
        const response = await this.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": `RoonAI-Bridge/${APP_VERSION} (https://github.com/LINEdev-ipc/roon-ai-bridge)`
          },
          signal: controller.signal
        });
        receivedResponse = true;
        if (response.ok) return await response.json() as JsonRecord;
        const retryable = response.status === 429 || response.status === 503;
        if (!retryable || attempt === this.maxRetries) {
          throw new Error(`MusicBrainz returned HTTP ${response.status}`);
        }
        await this.sleep(this.retryDelay(response, attempt));
      } catch (error) {
        const networkRetryLimit = Math.min(this.maxRetries, 1);
        if (receivedResponse || attempt >= networkRetryLimit) {
          const failure = error instanceof Error ? error : new Error(String(error));
          Object.assign(failure, {
            musicbrainz_provider_requests: trace?.provider_requests || 0
          });
          throw failure;
        }
        await this.sleep(this.retryBaseMs * (2 ** attempt));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error("MusicBrainz request failed after retries");
  }

  private cacheKey(input: {
    recording_id?: string | null;
    title: string;
    artist: string;
    album?: string | null;
    album_observation?: string | null;
    require_release_match?: boolean;
    version_hint?: string | null;
    isrc?: string | null;
    duration_seconds?: number | null;
    release_year_observation?: number | null;
    metadata_depth?: "identity" | "full";
  }): string {
    const material = [
      normalize(input.recording_id),
      normalize(input.title), normalize(input.artist), releaseKey(input.album),
      releaseKey(input.album_observation),
      input.require_release_match ? "required-release" : "observed-release",
      normalize(input.version_hint), normalize(input.isrc), input.duration_seconds || "",
      input.release_year_observation || "",
      input.metadata_depth || "full"
    ].join("|");
    return `recording-resolution:v9:${crypto.createHash("sha256").update(material).digest("hex")}`;
  }

  private remember(cacheKey: string, value: RecordingCatalogResolution): RecordingCatalogResolution {
    const ttlMs = value.status === "exact"
      ? EXACT_CACHE_TTL_MS
      : value.status === "conflict"
        ? CONFLICT_CACHE_TTL_MS
        : NOT_FOUND_CACHE_TTL_MS;
    this.cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value });
    this.persistentCache?.set({
      provider: MUSICBRAINZ_PROVIDER,
      cacheKey,
      entityType: "recording_resolution",
      status: value.status,
      payload: value,
      ttlMs
    });
    return value;
  }

  private releaseTrackCacheKey(releaseId: string, recordingId: string): string {
    return `release-track:v2:${crypto.createHash("sha256").update(`${releaseId}|${recordingId}`).digest("hex")}`;
  }

  private rememberReleaseTrack(cacheKey: string, value: ReleaseTrackCatalogResolution): ReleaseTrackCatalogResolution {
    const ttlMs = value.status === "exact"
      ? EXACT_CACHE_TTL_MS
      : value.status === "conflict"
        ? CONFLICT_CACHE_TTL_MS
        : NOT_FOUND_CACHE_TTL_MS;
    this.releaseTrackCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value });
    this.persistentCache?.set({
      provider: MUSICBRAINZ_PROVIDER,
      cacheKey,
      entityType: "release_track_resolution",
      status: value.status,
      payload: value,
      ttlMs
    });
    return value;
  }

  private recordingReleasesCacheKey(recordingId: string): string {
    return `recording-releases:v1:${crypto.createHash("sha256").update(recordingId).digest("hex")}`;
  }

  private rememberRecordingReleases(
    cacheKey: string,
    value: RecordingReleasesCatalogResult
  ): RecordingReleasesCatalogResult {
    this.recordingReleasesCache.set(cacheKey, { expiresAt: Date.now() + EXACT_CACHE_TTL_MS, value });
    this.persistentCache?.set({
      provider: MUSICBRAINZ_PROVIDER,
      cacheKey,
      entityType: "recording_releases",
      status: value.truncated ? "partial" : "exact",
      payload: value,
      ttlMs: EXACT_CACHE_TTL_MS
    });
    return value;
  }

  private recordingReleaseAnchorCacheKey(recordingId: string, releaseTitle: string): string {
    const material = `${recordingId}|${releaseKey(releaseTitle)}`;
    return `recording-release-anchor:v1:${crypto.createHash("sha256").update(material).digest("hex")}`;
  }

  private rememberRecordingReleaseAnchor(
    cacheKey: string,
    value: RecordingReleaseAnchorCatalogResult
  ): RecordingReleaseAnchorCatalogResult {
    const ttlMs = value.releases.length ? EXACT_CACHE_TTL_MS : NOT_FOUND_CACHE_TTL_MS;
    this.recordingReleaseAnchorCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value });
    this.persistentCache?.set({
      provider: MUSICBRAINZ_PROVIDER,
      cacheKey,
      entityType: "recording_release_anchor",
      status: value.releases.length ? "exact" : "not_found",
      payload: value,
      ttlMs
    });
    return value;
  }

  async findRecordingReleasesByTitle(
    recordingId: string,
    releaseTitle: string
  ): Promise<RecordingReleaseAnchorCatalogResult> {
    const startedAt = Date.now();
    const cacheKey = this.recordingReleaseAnchorCacheKey(recordingId, releaseTitle);
    const cached = this.recordingReleaseAnchorCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, trace: cacheTrace(cached.value.trace, "memory", startedAt) };
    }
    const persisted = this.persistentCache?.get<RecordingReleaseAnchorCatalogResult>(
      MUSICBRAINZ_PROVIDER,
      cacheKey
    );
    if (persisted) {
      this.recordingReleaseAnchorCache.set(cacheKey, {
        expiresAt: Date.parse(persisted.expires_at),
        value: persisted.payload
      });
      return { ...persisted.payload, trace: cacheTrace(persisted.payload.trace, "persistent", startedAt) };
    }

    const trace = emptyTrace();
    const url = new URL("https://musicbrainz.org/ws/2/recording");
    url.searchParams.set("query", `rid:${lucene(recordingId)} AND release:"${lucene(releaseTitle)}"`);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "100");
    const response = await this.requestJson(url, trace);
    const recording = records(response.recordings).find((candidate) => candidate.id === recordingId) || null;
    const releases = recording
      ? compatibleReleases(recording, releaseTitle)
        .map(releaseCandidate)
        .filter((release): release is RecordingCatalogReleaseCandidate => Boolean(release))
      : [];
    const mapped = Array.from(new Map(releases.map((release) => [release.release_id, release])).values());
    trace.search_attempts.push({
      title: `recording:${recordingId}`,
      artist: "",
      album: releaseTitle,
      result_count: mapped.length
    });
    trace.candidate_counts = { returned: mapped.length, accepted: mapped.length, rejected: 0 };
    return this.rememberRecordingReleaseAnchor(cacheKey, {
      releases: mapped,
      trace: completedTrace(trace, startedAt)
    });
  }

  async listRecordingReleases(recordingId: string): Promise<RecordingReleasesCatalogResult> {
    const startedAt = Date.now();
    const cacheKey = this.recordingReleasesCacheKey(recordingId);
    const cached = this.recordingReleasesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, trace: cacheTrace(cached.value.trace, "memory", startedAt) };
    }
    const persisted = this.persistentCache?.get<RecordingReleasesCatalogResult>(MUSICBRAINZ_PROVIDER, cacheKey);
    if (persisted) {
      this.recordingReleasesCache.set(cacheKey, {
        expiresAt: Date.parse(persisted.expires_at),
        value: persisted.payload
      });
      return { ...persisted.payload, trace: cacheTrace(persisted.payload.trace, "persistent", startedAt) };
    }

    const trace = emptyTrace();
    const releases: JsonRecord[] = [];
    let offset = 0;
    let total = 0;
    const maximum = 300;
    do {
      const url = new URL("https://musicbrainz.org/ws/2/release");
      url.searchParams.set("recording", recordingId);
      setMusicBrainzIncludes(url, ["release-groups", "media", "artist-credits"]);
      url.searchParams.set("fmt", "json");
      url.searchParams.set("limit", "100");
      url.searchParams.set("offset", String(offset));
      const response = await this.requestJson(url, trace);
      const page = records(response.releases);
      releases.push(...page);
      total = Number(response["release-count"] ?? response.count ?? page.length) || page.length;
      trace.search_attempts.push({
        title: `recording:${recordingId}`,
        artist: "",
        album: null,
        result_count: page.length
      });
      offset += page.length;
      if (!page.length) break;
    } while (offset < total && offset < maximum);

    const mapped = Array.from(new Map(releases
      .map(releaseCandidate)
      .filter((release): release is RecordingCatalogReleaseCandidate => Boolean(release))
      .map((release) => [release.release_id, release])).values());
    trace.candidate_counts = { returned: mapped.length, accepted: mapped.length, rejected: 0 };
    return this.rememberRecordingReleases(cacheKey, {
      releases: mapped,
      truncated: offset < total,
      trace: completedTrace(trace, startedAt)
    });
  }

  async lookupReleaseTrack(releaseId: string, recordingId: string): Promise<ReleaseTrackCatalogResolution> {
    const startedAt = Date.now();
    const cacheKey = this.releaseTrackCacheKey(releaseId, recordingId);
    const cached = this.releaseTrackCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, trace: cacheTrace(cached.value.trace, "memory", startedAt) };
    }
    const persisted = this.persistentCache?.get<ReleaseTrackCatalogResolution>(MUSICBRAINZ_PROVIDER, cacheKey);
    if (persisted) {
      this.releaseTrackCache.set(cacheKey, {
        expiresAt: Date.parse(persisted.expires_at),
        value: persisted.payload
      });
      return { ...persisted.payload, trace: cacheTrace(persisted.payload.trace, "persistent", startedAt) };
    }

    const trace = emptyTrace();

    const url = new URL(`https://musicbrainz.org/ws/2/release/${releaseId}`);
    setMusicBrainzIncludes(url, ["recordings", "artist-credits", "release-groups", "labels"]);
    url.searchParams.set("fmt", "json");
    const detail = await this.requestJson(url, trace);
    const group = releaseGroup(detail);
    const matches = records(detail.media).flatMap((medium) => records(medium.tracks).flatMap((track) => {
      const recording = objectValue(track.recording);
      if (recording?.id !== recordingId) return [];
      return [{ medium, track }];
    }));
    if (!matches.length) {
      return this.rememberReleaseTrack(cacheKey, {
        status: "not_found",
        reason: "recording_not_present_on_release",
        metadata: null,
        trace: completedTrace(trace, startedAt)
      });
    }
    if (matches.length !== 1) {
      return this.rememberReleaseTrack(cacheKey, {
        status: "conflict",
        reason: "recording_occurs_multiple_times_on_release",
        metadata: null,
        trace: completedTrace(trace, startedAt)
      });
    }
    const { medium, track } = matches[0];
    const labels = records(detail["label-info"]).flatMap((entry) => {
      const label = objectValue(entry.label);
      if (typeof label?.name !== "string" || !label.name.trim()) return [];
      return [{
        musicbrainz_id: typeof label.id === "string" ? label.id : null,
        name: label.name,
        catalog_number: typeof entry["catalog-number"] === "string" && entry["catalog-number"]
          ? entry["catalog-number"]
          : null
      }];
    });
    return this.rememberReleaseTrack(cacheKey, {
      status: "exact",
      reason: "unique_recording_track_on_release",
      metadata: {
        release_id: String(detail.id || releaseId),
        release_group_id: typeof group?.id === "string" ? group.id : null,
        title: String(detail.title || ""),
        album_artist: artistNames(detail["artist-credit"])[0] || null,
        date: typeof detail.date === "string" && detail.date ? detail.date : null,
        release_year: year(detail.date),
        country: typeof detail.country === "string" && detail.country ? detail.country : null,
        status: typeof detail.status === "string" && detail.status ? detail.status : null,
        primary_type: typeof group?.["primary-type"] === "string" ? String(group["primary-type"]) : null,
        secondary_types: strings(group?.["secondary-types"]),
        medium_position: integer(medium.position) || 1,
        track_position: integer(track.position) || 1,
        track_number: typeof track.number === "string" && track.number ? track.number : null,
        track_title: String(track.title || objectValue(track.recording)?.title || ""),
        duration_seconds: durationSeconds(track.length),
        cover_art_archive: coverArtArchive(detail["cover-art-archive"]),
        barcode: typeof detail.barcode === "string" && detail.barcode ? detail.barcode : null,
        packaging: typeof detail.packaging === "string" && detail.packaging ? detail.packaging : null,
        labels,
        media_format: typeof medium.format === "string" && medium.format ? medium.format : null
      },
      trace: completedTrace(trace, startedAt)
    });
  }

  private async search(
    title: string,
    artist: string,
    album: string | null | undefined,
    trace: MutableCatalogProviderTrace
  ): Promise<JsonRecord[]> {
    const recordingTerms = titleTokens(title).map(luceneTerm).join(" AND ");
    const terms = [
      `recording:(${recordingTerms})`,
      `artistname:"${lucene(artist)}"`,
      album ? `release:"${lucene(album)}"` : ""
    ].filter(Boolean).concat("video:false");
    const url = new URL("https://musicbrainz.org/ws/2/recording");
    url.searchParams.set("query", terms.join(" AND "));
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "100");
    const response = await this.requestJson(url, trace);
    const result = records(response.recordings);
    trace.search_attempts.push({ title, artist, album: album || null, result_count: result.length });
    return result;
  }

  async lookup(input: {
    recording_id?: string | null;
    title: string;
    artist: string;
    album?: string | null;
    album_observation?: string | null;
    require_release_match?: boolean;
    version_hint?: string | null;
    isrc?: string | null;
    duration_seconds?: number | null;
    release_year_observation?: number | null;
    metadata_depth?: "identity" | "full";
  }): Promise<RecordingCatalogResolution> {
    const startedAt = Date.now();
    const cacheKey = this.cacheKey(input);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, trace: cacheTrace(cached.value.trace, "memory", startedAt) };
    }
    const persisted = this.persistentCache?.get<RecordingCatalogResolution>(MUSICBRAINZ_PROVIDER, cacheKey);
    if (persisted) {
      this.cache.set(cacheKey, { expiresAt: Date.parse(persisted.expires_at), value: persisted.payload });
      return { ...persisted.payload, trace: cacheTrace(persisted.payload.trace, "persistent", startedAt) };
    }

    const trace = emptyTrace();

    const expectedTitle = baseRecordingTitle(input.title);
    const expectedArtist = normalize(input.artist);
    const requestedVariant = recordingVariantProfile(input.title, input.version_hint);
    const identityOnly = input.metadata_depth === "identity";
    const expectedIsrc = normalize(input.isrc);
    let detail: JsonRecord;
    let selectedSnapshot: RecordingCatalogCandidate;
    let resolutionReason = "unique_compatible_recording";
    let anchoredArtistMismatch = false;
    let listenBrainz: ListenBrainzLookupResult | null = null;

    if (input.recording_id) {
      const detailUrl = new URL(`https://musicbrainz.org/ws/2/recording/${input.recording_id}`);
      setMusicBrainzIncludes(detailUrl, [
        "artist-credits", "isrcs", "releases", "release-groups", "media", "work-rels", "genres", "tags"
      ]);
      detailUrl.searchParams.set("fmt", "json");
      detail = await this.requestJson(detailUrl, trace);
      const rejectionReasons: string[] = [];
      if (baseRecordingTitle(detail.title) !== expectedTitle) rejectionReasons.push("title_mismatch");
      const disambiguation = typeof detail.disambiguation === "string" ? detail.disambiguation : "";
      const variantEvidence = [
        detail.title,
        disambiguation,
        ...releaseTitles(detail)
      ].filter(Boolean).join(" ");
      if (variantStrength(requestedVariant, variantEvidence) === null) {
        rejectionReasons.push("variant_mismatch");
      }
      const detailedIsrcs = strings(detail.isrcs);
      if (expectedIsrc && detailedIsrcs.length && !detailedIsrcs.some((isrc) => normalize(isrc) === expectedIsrc)) {
        rejectionReasons.push("isrc_mismatch");
      }
      const requiredRelease = input.album ||
        (input.require_release_match ? input.album_observation : null);
      if (requiredRelease && !compatibleReleases(detail, requiredRelease).length) {
        rejectionReasons.push("release_mismatch");
      }
      const detailedArtists = artistNames(detail["artist-credit"]);
      anchoredArtistMismatch = detailedArtists.length > 0
        && !detailedArtists.some((artist) => artistEquivalent(artist, expectedArtist));
      if (anchoredArtistMismatch) trace.accepted_warnings.push("artist_credit_differs_from_intent");
      trace.candidate_counts = { returned: 1, accepted: rejectionReasons.length ? 0 : 1, rejected: rejectionReasons.length ? 1 : 0 };
      if (rejectionReasons.length) {
        trace.rejected_candidates.push({
          recording_id: typeof detail.id === "string" ? detail.id : input.recording_id,
          title: typeof detail.title === "string" ? detail.title : null,
          disambiguation: disambiguation || null,
          reasons: rejectionReasons
        });
        return this.remember(cacheKey, {
          status: "not_found",
          reason: "stored_recording_mbid_failed_verification",
          metadata: null,
          candidates: [],
          trace: completedTrace(trace, startedAt)
        });
      }
      selectedSnapshot = candidateSnapshot(detail);
      resolutionReason = anchoredArtistMismatch
        ? "verified_recording_mbid_with_distinct_artist_credit"
        : "verified_recording_mbid";
    } else {
      const versionSpecific = requestedVariant.live || requestedVariant.remix ||
        requestedVariant.dub || requestedVariant.acoustic ||
        requestedVariant.edit || requestedVariant.demo || requestedVariant.atmosphere ||
        requestedVariant.alternate;
      const searchTitle = versionSpecific
        ? input.title
        : recordingSearchTitle(input.title) || input.title;
      const releaseTitle = input.album || input.album_observation || null;
      const releaseAlias = releaseTitle ? releaseSearchAlias(releaseTitle) : null;
      const searchRelease = input.album ||
        (input.require_release_match || versionSpecific ? releaseTitle : null);
      let requiredRelease = (input.album || input.require_release_match) ? releaseTitle : null;
      let usedCoreTitleFallback = false;
      const listenBrainzPromise = this.listenBrainz?.lookup({
        title: input.title,
        artist: input.artist,
        album: releaseTitle
      }) || Promise.resolve(null);
      let recordings = await this.search(
        searchTitle,
        input.artist,
        searchRelease ? releaseAlias : null,
        trace
      );
      if (!recordings.length && searchRelease && releaseAlias) {
        recordings = await this.search(searchTitle, input.artist, null, trace);
        if (!input.require_release_match) requiredRelease = null;
        trace.accepted_warnings.push("explicit_release_did_not_identify_recording");
      }
      const coreSearchTitle = versionSpecific
        ? variantCoreSearchTitle(input.title)
        : recordingSearchTitle(input.title);
      if (
        !recordings.length &&
        versionSpecific &&
        coreSearchTitle &&
        normalize(coreSearchTitle) !== normalize(searchTitle)
      ) {
        recordings = await this.search(
          coreSearchTitle,
          input.artist,
          input.require_release_match ? releaseAlias : null,
          trace
        );
        if (!input.require_release_match) requiredRelease = null;
        usedCoreTitleFallback = true;
        trace.accepted_warnings.push("version_search_used_core_title_fallback");
      }
      listenBrainz = await listenBrainzPromise;
      if (listenBrainz) {
        trace.listenbrainz = {
          elapsed_ms: listenBrainz.elapsed_ms,
          provider_requests: listenBrainz.provider_requests,
          cache_hits: listenBrainz.cache_hits,
          candidate_count: listenBrainz.candidates.length,
          acr_count: listenBrainz.acr_mbids.length,
          acrr_count: listenBrainz.acrr_mbids.length
        };
        trace.accepted_warnings.push(...listenBrainz.warnings.map((warning) => `listenbrainz:${warning}`));
      }
      const acr = new Set(listenBrainz?.acr_mbids || []);
      const acrr = new Set(listenBrainz?.acrr_mbids || []);
      const rank = (values: JsonRecord[], requiredAlbum: string | null) => values.flatMap((recording) => {
        const reasons: string[] = [];
        if (typeof recording.id !== "string" || typeof recording.title !== "string") reasons.push("invalid_recording_shape");
        const titleExact = typeof recording.title === "string" &&
          baseRecordingTitle(recording.title) === expectedTitle;
        const titleCompatible = typeof recording.title === "string" &&
          compatibleTitle(input.title, recording.title);
        const medleyMismatch = typeof recording.title === "string" &&
          /\/|\bmedley\b|\babertura\b/iu.test(recording.title) &&
          !/\/|\bmedley\b|\babertura\b/iu.test(input.title);
        if (!titleExact && (!titleCompatible || medleyMismatch)) reasons.push("title_mismatch");
        const artists = artistNames(recording["artist-credit"]);
        if (artists.length && !artists.some((artist) => artistEquivalent(artist, expectedArtist))) reasons.push("artist_mismatch");
        const releases = compatibleReleases(recording, requiredAlbum);
        if (requiredAlbum && !releases.length) reasons.push("release_mismatch");
        const isrcs = strings(recording.isrcs);
        if (expectedIsrc && !isrcs.some((isrc) => normalize(isrc) === expectedIsrc)) reasons.push("isrc_mismatch");
        const duration = durationSeconds(recording.length);
        if (input.duration_seconds && duration && Math.abs(duration - input.duration_seconds) > 2) reasons.push("duration_mismatch");
        const disambiguation = typeof recording.disambiguation === "string" ? recording.disambiguation : "";
        const variantEvidence = versionSpecific
          ? `${recording.title} ${disambiguation} ${releaseTitles(recording).join(" ")}`
          : `${recording.title} ${disambiguation}`;
        const strength = variantStrength(requestedVariant, variantEvidence);
        if (strength === null) reasons.push("variant_mismatch");
        if (reasons.length) {
          if (trace.rejected_candidates.length < 12) {
            trace.rejected_candidates.push({
              recording_id: typeof recording.id === "string" ? recording.id : null,
              title: typeof recording.title === "string" ? recording.title : null,
              disambiguation: disambiguation || null,
              reasons
            });
          }
          return [];
        }
        const releaseNames = releaseTitles(recording);
        const albumExact = Boolean(releaseTitle) && releaseNames.some((title) =>
          releaseKey(title) === releaseKey(releaseTitle)
        );
        const albumCompatible = albumExact || Boolean(releaseTitle) && releaseNames.some((title) =>
          compatibleTitle(releaseTitle, title)
        );
        const recordingId = String(recording.id);
        const nativeScore = Number(recording.score) || 0;
        const observedYear = input.release_year_observation || null;
        const candidateYears = records(recording.releases)
          .map((release) => year(release.date))
          .filter((value): value is number => value !== null);
        const yearDistance = observedYear && candidateYears.length
          ? Math.min(...candidateYears.map((candidateYear) =>
              Math.abs(candidateYear - observedYear)
            ))
          : null;
        const score = (titleExact ? 100 : 78) +
          60 +
          strength! * 4 +
          Math.round(nativeScore / 5) +
          (albumExact ? 42 : albumCompatible ? 28 : 0) +
          (acrr.has(recordingId) ? 18 : 0) +
          (acr.has(recordingId) ? 10 : 0) +
          (acrr.has(recordingId) && acr.has(recordingId) ? 12 : 0) +
          (yearDistance === 0 ? 12 : yearDistance === 1 ? 8 : yearDistance !== null && yearDistance <= 3 ? 3 : 0);
        return [{ recording, strength: strength!, searchScore: nativeScore, score }];
      }).sort((left, right) =>
        right.score - left.score ||
        right.strength - left.strength ||
        right.searchScore - left.searchScore
      );
      let ranked = rank(recordings, requiredRelease);
      if (
        !ranked.length &&
        versionSpecific &&
        !usedCoreTitleFallback &&
        coreSearchTitle &&
        normalize(coreSearchTitle) !== normalize(searchTitle)
      ) {
        const fallbackRecordings = await this.search(
          coreSearchTitle,
          input.artist,
          input.require_release_match ? releaseAlias : null,
          trace
        );
        const mergedRecordings = new Map<string, JsonRecord>();
        for (const recording of [...recordings, ...fallbackRecordings]) {
          if (typeof recording.id === "string") mergedRecordings.set(recording.id, recording);
        }
        recordings = [...mergedRecordings.values()];
        if (!input.require_release_match) requiredRelease = null;
        ranked = rank(recordings, requiredRelease);
        trace.accepted_warnings.push("version_search_used_core_title_fallback");
      }
      trace.candidate_counts = { returned: recordings.length, accepted: ranked.length, rejected: recordings.length - ranked.length };
      const snapshots = ranked.slice(0, 8).map(({ recording }) => candidateSnapshot(recording));
      if (!ranked.length) {
        return this.remember(cacheKey, {
          status: "not_found",
          reason: "no_compatible_recording",
          metadata: null,
          candidates: [],
          trace: completedTrace(trace, startedAt)
        });
      }
      const top = ranked[0];
      const topSnapshot = candidateSnapshot(top.recording);
      const competing = ranked.slice(1).find((candidate) => {
        const snapshot = candidateSnapshot(candidate.recording);
        const sharedIsrc = topSnapshot.isrcs.some((isrc) => snapshot.isrcs.includes(isrc));
        const equivalentDuration = topSnapshot.duration_seconds !== null &&
          snapshot.duration_seconds !== null &&
          Math.abs(topSnapshot.duration_seconds - snapshot.duration_seconds) <= 2;
        const sameSemanticIdentity = compatibleTitle(topSnapshot.title, snapshot.title) &&
          (sharedIsrc || equivalentDuration);
        return !sameSemanticIdentity && top.score - candidate.score < 20;
      });
      if (competing) {
        return this.remember(cacheKey, {
          status: "conflict",
          reason: "multiple_compatible_recordings",
          metadata: null,
          candidates: snapshots,
          trace: completedTrace(trace, startedAt)
        });
      }
      const selected = top.recording;
      if (input.album_observation && releaseTitle && releaseTitles(selected).some((title) =>
        compatibleTitle(releaseTitle, title)
      )) {
        resolutionReason = "unique_compatible_recording_from_release_observation";
      }
      if (identityOnly) {
        detail = selected;
        selectedSnapshot = candidateSnapshot(selected);
        resolutionReason = `${resolutionReason}_identity_only`;
        trace.accepted_warnings.push("metadata_enrichment_pending");
      } else {
        const detailUrl = new URL(`https://musicbrainz.org/ws/2/recording/${selected.id}`);
        setMusicBrainzIncludes(detailUrl, [
          "artist-credits", "isrcs", "releases", "release-groups", "media", "work-rels", "genres", "tags"
        ]);
        detailUrl.searchParams.set("fmt", "json");
        detail = await this.requestJson(detailUrl, trace);
        selectedSnapshot = candidateSnapshot(detail);
      }
    }
    const workRelation = records(detail.relations).find((relation) => objectValue(relation.work));
    const work = objectValue(workRelation?.work);
    let workDetail: JsonRecord | null = null;
    if (!identityOnly && typeof work?.id === "string") {
      const workUrl = new URL(`https://musicbrainz.org/ws/2/work/${work.id}`);
      setMusicBrainzIncludes(workUrl, ["artist-rels", "genres", "tags"]);
      workUrl.searchParams.set("fmt", "json");
      workDetail = await this.requestJson(workUrl, trace);
    }

    const relations = records(workDetail?.relations);
    const namesFor = (types: string[]) => Array.from(new Set(relations.flatMap((relation) => {
      if (!types.includes(String(relation.type || ""))) return [];
      const artist = objectValue(relation.artist);
      return typeof artist?.name === "string" ? [artist.name] : [];
    })));
    const recordingGenres = records(detail.genres);
    const workGenres = records(workDetail?.genres);
    const genres = Array.from(new Set([...recordingGenres, ...workGenres]
      .filter((genre) => Number(genre.count) > 0 && typeof genre.name === "string")
      .sort((left, right) => Number(right.count) - Number(left.count))
      .map((genre) => String(genre.name)))).slice(0, 8);
    const releaseCandidates = records(detail.releases)
      .map(releaseCandidate)
      .filter((release): release is RecordingCatalogReleaseCandidate => Boolean(release));
    const detailedReleases = compatibleReleases(detail, input.album);
    const releaseYears = detailedReleases
      .filter((release) => normalize(release.status) === "official" || !release.status)
      .map((release) => year(release.date))
      .filter((value): value is number => value !== null);
    const allReleaseYears = records(detail.releases)
      .filter((release) => normalize(release.status) === "official" || !release.status)
      .map((release) => year(release.date))
      .filter((value): value is number => value !== null);
    const disambiguation = typeof detail.disambiguation === "string" && detail.disambiguation.trim()
      ? detail.disambiguation
      : null;
    const isrcs = strings(detail.isrcs);
    const composers = namesFor(["composer", "writer"]);
    const lyricists = namesFor(["lyricist"]);
    const structuredCredits = relationshipCredits(relations);
    const workId = typeof workDetail?.id === "string"
      ? workDetail.id
      : typeof work?.id === "string"
        ? work.id
        : null;
    const metadata: RecordingCatalogMetadata = {
      recording_id: String(detail.id || input.recording_id || selectedSnapshot.recording_id),
      title: String(detail.title || selectedSnapshot.title),
      artist: artistNames(detail["artist-credit"])[0] || input.artist || null,
      artists: artistNames(detail["artist-credit"]),
      artist_credit: artistCredit(detail["artist-credit"]),
      album: input.album || (typeof detailedReleases[0]?.title === "string" ? detailedReleases[0].title : null),
      disambiguation,
      duration_seconds: durationSeconds(detail.length),
      release_year: releaseYears.length ? Math.min(...releaseYears) : null,
      original_release_year: allReleaseYears.length ? Math.min(...allReleaseYears) : null,
      isrc: isrcs[0] || null,
      isrcs,
      composers,
      lyricists,
      genres,
      release_candidates: releaseCandidates,
      confidence: anchoredArtistMismatch ? "medium" : input.recording_id || input.album || expectedIsrc ? "high" : "medium",
      video: detail.video === true,
      artist_entities: artistEntities(detail["artist-credit"]),
      work: workId ? {
        musicbrainz_id: workId,
        title: typeof workDetail?.title === "string"
          ? workDetail.title
          : typeof work?.title === "string"
            ? work.title
            : String(detail.title || ""),
        type: typeof workDetail?.type === "string" && workDetail.type ? workDetail.type : null,
        language: typeof workDetail?.language === "string" && workDetail.language ? workDetail.language : null,
        iswcs: strings(workDetail?.iswcs),
        disambiguation: typeof workDetail?.disambiguation === "string" && workDetail.disambiguation
          ? workDetail.disambiguation
          : null,
        relation_type: typeof workRelation?.type === "string" && workRelation.type
          ? workRelation.type
          : "performance",
        relation_attributes: relationAttributes(workRelation?.attributes)
      } : null,
      credits: structuredCredits,
      genre_details: [
        ...recordingGenres.flatMap((genre) =>
          typeof genre.name === "string" && Number(genre.count) > 0
            ? [{ name: genre.name, count: Number(genre.count), entity: "recording" as const }]
            : []
        ),
        ...workGenres.flatMap((genre) =>
          typeof genre.name === "string" && Number(genre.count) > 0
            ? [{ name: genre.name, count: Number(genre.count), entity: "work" as const }]
            : []
        )
      ],
      release_groups: releaseGroups(detail.releases)
    };
    const value: RecordingCatalogResolution = {
      status: "exact",
      reason: resolutionReason,
      metadata,
      candidates: [selectedSnapshot],
      trace: completedTrace(trace, startedAt)
    };
    return this.remember(cacheKey, value);
  }
}
