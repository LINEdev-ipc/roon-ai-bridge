import { Router } from "express";
import { ApiContext } from "../server";
import { MediaType } from "../../roon/roonMediaService";
import { WidgetService } from "../../services/widgetService";
import { verifyWidgetAssetSignature, WidgetAssetKind } from "../../services/widgetAssetService";
import { ApiError } from "../../utils/errors";

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTypes(value: unknown): MediaType[] | undefined {
  if (!value) return undefined;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as MediaType[];
}

function widgetService(context: ApiContext): WidgetService {
  return new WidgetService({
    roonClient: context.roonClient,
    playlistService: context.playlistService,
    mediaService: context.mediaService,
    volumeLimitService: context.volumeLimitService,
    publicBaseUrl: context.config.publicBaseUrl
  });
}

export function createWidgetsRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/widgets/now-playing", (req, res, next) => {
    try {
      res.json(widgetService(context).getNowPlaying({
        selected_zone_id: typeof req.query.zone_id === "string" ? req.query.zone_id : undefined
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/widgets/now-playing/action", async (req, res, next) => {
    try {
      res.json(await widgetService(context).nowPlayingAction(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.get("/widgets/playlists", (req, res, next) => {
    try {
      res.json(widgetService(context).getPlaylists({
        limit: parseNumber(req.query.limit, 25),
        offset: parseNumber(req.query.offset, 0)
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/widgets/playlists/:playlist_id", (req, res, next) => {
    try {
      res.json(widgetService(context).getPlaylistDetail({
        playlist_id: req.params.playlist_id,
        limit: parseNumber(req.query.limit, 25),
        offset: parseNumber(req.query.offset, 0)
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/widgets/playlists/action", async (req, res, next) => {
    try {
      res.json(await widgetService(context).playlistAction(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.get("/widgets/search", async (req, res, next) => {
    try {
      res.json(await widgetService(context).getMediaSearch({
        query: typeof req.query.q === "string" ? req.query.q : "",
        types: parseTypes(req.query.types),
        zone_id: typeof req.query.zone_id === "string" ? req.query.zone_id : undefined,
        count: parseNumber(req.query.count, 10)
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/widgets/search", async (req, res, next) => {
    try {
      res.json(await widgetService(context).getMediaSearch(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post("/widgets/search/action", async (req, res, next) => {
    try {
      res.json(await widgetService(context).mediaSearchAction(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/albums/:result_id", (req, res, next) => {
    try {
      res.json(widgetService(context).getMediaEntity({ result_id: req.params.result_id }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/artists/:result_id", (req, res, next) => {
    try {
      res.json(widgetService(context).getMediaEntity({ result_id: req.params.result_id }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/roon/images/:image_key", async (req, res, next) => {
    try {
      const image = await widgetService(context).getImage(req.params.image_key, {
        width: parseNumber(req.query.width, 320),
        height: parseNumber(req.query.height, 320)
      });
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.type(image.contentType).send(image.bytes);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function requireWidgetAssetSignature(
  context: ApiContext,
  kind: WidgetAssetKind,
  assetId: string,
  expires: unknown,
  signature: unknown
): void {
  if (!verifyWidgetAssetSignature(context.config, kind, assetId, expires, signature)) {
    throw new ApiError("AUTH_INVALID", "Invalid or expired widget asset URL", {}, 403);
  }
}

export function createWidgetAssetsRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/mcp", async (req, res, next) => {
    if (typeof req.query.widget_asset !== "string") return next();

    try {
      const kind = req.query.widget_asset;
      const assetId = typeof req.query.asset_id === "string" ? req.query.asset_id : "";
      if ((kind !== "roon-image" && kind !== "playlist-cover") || !assetId) {
        throw new ApiError("INVALID_IMAGE_REQUEST", "Invalid widget asset request", {}, 400);
      }

      requireWidgetAssetSignature(
        context,
        kind,
        assetId,
        req.query.expires,
        req.query.signature
      );

      if (kind === "roon-image") {
        const image = await widgetService(context).getImage(assetId, {
          width: parseNumber(req.query.width, 640),
          height: parseNumber(req.query.height, 640)
        });
        res.setHeader("Cache-Control", "private, max-age=3600");
        res.type(image.contentType).send(image.bytes);
        return;
      }

      const cover = context.playlistService.getCustomCover(assetId);
      res.setHeader("Content-Type", cover.content_type);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(cover.bytes);
    } catch (error) {
      next(error);
    }
  });

  router.get("/widget-assets/roon-images/:image_key", async (req, res, next) => {
    try {
      requireWidgetAssetSignature(
        context,
        "roon-image",
        req.params.image_key,
        req.query.expires,
        req.query.signature
      );
      const image = await widgetService(context).getImage(req.params.image_key, {
        width: parseNumber(req.query.width, 640),
        height: parseNumber(req.query.height, 640)
      });
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.type(image.contentType).send(image.bytes);
    } catch (error) {
      next(error);
    }
  });

  router.get("/widget-assets/playlist-covers/:cover_id", (req, res, next) => {
    try {
      requireWidgetAssetSignature(
        context,
        "playlist-cover",
        req.params.cover_id,
        req.query.expires,
        req.query.signature
      );
      const cover = context.playlistService.getCustomCover(req.params.cover_id);
      res.setHeader("Content-Type", cover.content_type);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(cover.bytes);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
