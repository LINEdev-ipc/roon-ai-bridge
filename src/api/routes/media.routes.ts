import { Router } from "express";
import {
  MediaActionMode,
  MediaType,
  SourcePreference
} from "../../roon/roonMediaService";
import { ApiError } from "../../utils/errors";
import { ApiContext } from "../server";

const MEDIA_TYPES = new Set<MediaType>(["track", "album", "artist", "playlist"]);
const SOURCE_PREFERENCES = new Set<SourcePreference>([
  "highest_quality",
  "streaming_first",
  "library_first"
]);
const ACTION_MODES = new Set<MediaActionMode>(["replace_queue", "play_next", "append"]);

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseTypes(value: unknown): MediaType[] | undefined {
  if (value === undefined) return undefined;
  const values = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const invalid = values.filter((item) => !MEDIA_TYPES.has(item as MediaType));
  if (invalid.length > 0) {
    throw new ApiError("INVALID_SEARCH_QUERY", "Unsupported media type", {
      invalid,
      allowed: Array.from(MEDIA_TYPES)
    });
  }
  return values as MediaType[];
}

function parseSourcePreference(value: unknown): SourcePreference {
  const preference = optionalString(value) || "highest_quality";
  if (!SOURCE_PREFERENCES.has(preference as SourcePreference)) {
    throw new ApiError("INVALID_SEARCH_QUERY", "Unsupported source preference", {
      allowed: Array.from(SOURCE_PREFERENCES)
    });
  }
  return preference as SourcePreference;
}

function parseMode(value: unknown): MediaActionMode {
  const mode = optionalString(value) || "replace_queue";
  if (!ACTION_MODES.has(mode as MediaActionMode)) {
    throw new ApiError("UNSUPPORTED_COMMAND", "Unsupported media action mode", {
      allowed: Array.from(ACTION_MODES)
    });
  }
  return mode as MediaActionMode;
}

function parseCount(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, max)) : fallback;
}

function parseOffset(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function createMediaRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/media/search", async (req, res, next) => {
    try {
      const query = optionalString(req.query.q) || "";
      const types = parseTypes(req.query.types);
      const sourcePreference = parseSourcePreference(req.query.source_preference);
      const count = parseCount(req.query.count, 10, 100);

      context.logger.info("Typed media search received", {
        query,
        types,
        sourcePreference,
        count
      });

      res.json(
        await context.mediaService.search({
          query,
          types,
          zoneId: optionalString(req.query.zone_id),
          count,
          sourcePreference
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/search", async (req, res, next) => {
    try {
      res.json(
        await context.mediaService.search({
          query: optionalString(req.body?.query) || "",
          types: Array.isArray(req.body?.types) ? req.body.types : parseTypes(req.body?.types),
          zoneId: optionalString(req.body?.zone_id),
          count: parseCount(req.body?.count, 10, 25),
          sourcePreference: parseSourcePreference(req.body?.source_preference),
          strategy: req.body?.strategy
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/search/expand", async (req, res, next) => {
    try {
      res.json(
        await context.mediaService.expandSearch({
          originalQuery: optionalString(req.body?.original_query) || "",
          previousQuery: optionalString(req.body?.previous_query),
          types: Array.isArray(req.body?.types) ? req.body.types : parseTypes(req.body?.types),
          strategy: req.body?.strategy || "all",
          count: parseCount(req.body?.count, 25, 25),
          zoneId: optionalString(req.body?.zone_id),
          sourcePreference: parseSourcePreference(req.body?.source_preference)
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/:result_id", (req, res, next) => {
    try {
      res.json(context.mediaService.get(req.params.result_id));
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/:result_id/catalog", async (req, res, next) => {
    try {
      const media = context.mediaService.get(req.params.result_id);
      if (media.media_type !== "track") {
        throw new ApiError("INVALID_SEARCH_QUERY", "Catalog metadata is available for track results", {
          result_id: req.params.result_id,
          media_type: media.media_type
        });
      }
      res.json(await context.trackCatalogService.describeRoonTrack(media));
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/:result_id/releases", async (req, res, next) => {
    try {
      res.json(
        await context.mediaService.listArtistReleases(
          req.params.result_id,
          optionalString(req.query.zone_id),
          parseCount(req.query.count, 100, 250)
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/:result_id/artist-detail", async (req, res, next) => {
    try {
      res.json(
        await context.mediaService.getArtistDetail(
          req.params.result_id,
          optionalString(req.query.zone_id),
          parseCount(req.query.count, 100, 250)
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/:result_id/album-detail", async (req, res, next) => {
    try {
      res.json(
        await context.mediaService.getAlbumDetail(
          req.params.result_id,
          optionalString(req.query.zone_id),
          parseCount(req.query.count, 100, 200)
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/:result_id/playlist-detail", async (req, res, next) => {
    try {
      res.json(
        await context.mediaService.getPlaylistDetail(
          req.params.result_id,
          optionalString(req.query.zone_id),
          parseCount(req.query.count, 100, 100),
          parseOffset(req.query.offset)
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/:result_id/play", async (req, res, next) => {
    try {
      const zoneId = optionalString(req.body?.zone_id) || "";
      const mode = parseMode(req.body?.mode);
      context.logger.info("Media action received", {
        resultId: req.params.result_id,
        zoneId,
        mode
      });
      const artistMode = req.body?.artist_mode === "radio" ? "radio" : "catalog";
      res.json(
        await context.mediaService.play(
          req.params.result_id,
          zoneId,
          mode,
          artistMode
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/:result_id/radio", async (req, res, next) => {
    try {
      const zoneId = optionalString(req.body?.zone_id) || "";
      context.logger.info("Artist radio request received", {
        resultId: req.params.result_id,
        zoneId
      });
      res.json(await context.mediaService.startRadio(req.params.result_id, zoneId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
