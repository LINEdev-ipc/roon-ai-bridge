import crypto from "crypto";
import { APP_VERSION } from "../config/version";
import { MetadataProviderCacheService } from "./metadataProviderCacheService";

export type ListenBrainzRecordingCandidate = {
  recording_mbid: string;
  release_mbid: string | null;
  recording_name: string | null;
  release_name: string | null;
  artist_credit_name: string | null;
  artist_mbids: string[];
  sources: Array<"acr" | "acrr">;
};

export type ListenBrainzLookupResult = {
  candidates: ListenBrainzRecordingCandidate[];
  acr_mbids: string[];
  acrr_mbids: string[];
  provider_requests: number;
  cache_hits: number;
  elapsed_ms: number;
  warnings: string[];
};

type JsonRecord = Record<string, unknown>;
type Dataset = "acr-lookup" | "acrr-lookup";

const PROVIDER = "listenbrainz";
const POSITIVE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2000;

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

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is JsonRecord =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export class ListenBrainzMetadataService {
  private readonly memory = new Map<string, { expiresAt: number; candidates: ListenBrainzRecordingCandidate[] }>();
  private readonly inFlight = new Map<string, Promise<ListenBrainzRecordingCandidate[]>>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly cache?: MetadataProviderCacheService
  ) {}

  async lookup(input: {
    title: string;
    artist: string;
    album?: string | null;
  }): Promise<ListenBrainzLookupResult> {
    const startedAt = Date.now();
    let providerRequests = 0;
    let cacheHits = 0;
    const warnings: string[] = [];
    const datasets: Dataset[] = input.album
      ? ["acr-lookup", "acrr-lookup"]
      : ["acr-lookup"];
    const results = await Promise.all(datasets.map(async (dataset) => {
      const key = this.cacheKey(dataset, input);
      const memory = this.memory.get(key);
      if (memory && memory.expiresAt > Date.now()) {
        cacheHits += 1;
        return memory.candidates;
      }
      const persisted = this.cache?.get<ListenBrainzRecordingCandidate[]>(PROVIDER, key);
      if (persisted) {
        cacheHits += 1;
        const candidates = persisted.payload;
        this.memory.set(key, {
          expiresAt: Date.parse(persisted.expires_at),
          candidates
        });
        return candidates;
      }
      const active = this.inFlight.get(key);
      if (active) {
        cacheHits += 1;
        return active;
      }
      const request = (async () => {
        providerRequests += 1;
        try {
          const url = new URL(`https://labs.api.listenbrainz.org/${dataset}/json`);
          url.searchParams.set("artist_credit_name", input.artist);
          url.searchParams.set("recording_name", input.title);
          if (dataset === "acrr-lookup" && input.album) {
            url.searchParams.set("release_name", input.album);
          }
          const response = await this.fetchImpl(url, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
              Accept: "application/json",
              "User-Agent": `RoonAI-Bridge/${APP_VERSION} (https://github.com/LINEdev-ipc/roon-ai-bridge)`
            }
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          const source = dataset === "acrr-lookup" ? "acrr" : "acr";
          const candidates = rows(body).flatMap((row): ListenBrainzRecordingCandidate[] => {
            const recordingMbid = optionalString(row.recording_mbid);
            if (!recordingMbid) return [];
            return [{
              recording_mbid: recordingMbid,
              release_mbid: optionalString(row.release_mbid),
              recording_name: optionalString(row.recording_name),
              release_name: optionalString(row.release_name),
              artist_credit_name: optionalString(row.artist_credit_name),
              artist_mbids: strings(row.artist_mbids),
              sources: [source]
            }];
          });
          const expiresAt = Date.now() + (candidates.length ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS);
          this.memory.set(key, { expiresAt, candidates });
          this.cache?.set({
            provider: PROVIDER,
            cacheKey: key,
            entityType: "recording_lookup",
            status: candidates.length ? "exact" : "not_found",
            payload: candidates,
            ttlMs: candidates.length ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
          });
          return candidates;
        } catch (error) {
          warnings.push(`${dataset}:${error instanceof Error ? error.message : String(error)}`);
          return [];
        } finally {
          this.inFlight.delete(key);
        }
      })();
      this.inFlight.set(key, request);
      return request;
    }));

    const merged = new Map<string, ListenBrainzRecordingCandidate>();
    for (const candidate of results.flat()) {
      const current = merged.get(candidate.recording_mbid);
      merged.set(candidate.recording_mbid, current ? {
        ...current,
        release_mbid: current.release_mbid || candidate.release_mbid,
        recording_name: current.recording_name || candidate.recording_name,
        release_name: current.release_name || candidate.release_name,
        artist_credit_name: current.artist_credit_name || candidate.artist_credit_name,
        artist_mbids: unique([...current.artist_mbids, ...candidate.artist_mbids]),
        sources: Array.from(new Set([...current.sources, ...candidate.sources]))
      } : candidate);
    }
    const candidates = [...merged.values()];
    return {
      candidates,
      acr_mbids: candidates.filter((candidate) => candidate.sources.includes("acr"))
        .map((candidate) => candidate.recording_mbid),
      acrr_mbids: candidates.filter((candidate) => candidate.sources.includes("acrr"))
        .map((candidate) => candidate.recording_mbid),
      provider_requests: providerRequests,
      cache_hits: cacheHits,
      elapsed_ms: Date.now() - startedAt,
      warnings
    };
  }

  private cacheKey(
    dataset: Dataset,
    input: { title: string; artist: string; album?: string | null }
  ): string {
    return crypto.createHash("sha256").update(JSON.stringify({
      dataset,
      title: normalize(input.title),
      artist: normalize(input.artist),
      album: dataset === "acrr-lookup" ? normalize(input.album) : ""
    })).digest("hex");
  }
}
