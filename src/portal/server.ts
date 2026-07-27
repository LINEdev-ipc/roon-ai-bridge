import path from "path";
import express, { NextFunction, Request, Response } from "express";
import { ApplicationContext } from "../app/context";
import { getBearerToken, tokenMatches } from "../api/middleware/auth";
import { createAdvancedRouter } from "../api/routes/advanced.routes";
import { createGroupingRouter } from "../api/routes/grouping.routes";
import { createLibraryRouter } from "../api/routes/library.routes";
import { createMediaRouter } from "../api/routes/media.routes";
import { createActionAuditMiddleware, createObservabilityRouter } from "../api/routes/observability.routes";
import { createPlaybackRouter } from "../api/routes/playback.routes";
import { createPlaylistsRouter } from "../api/routes/playlists.routes";
import { createQueueRouter } from "../api/routes/queue.routes";
import { createRoonRouter } from "../api/routes/roon.routes";
import { createVolumeLimitsRouter } from "../api/routes/volumeLimits.routes";
import { createVolumeRouter } from "../api/routes/volume.routes";
import { createWidgetsRouter } from "../api/routes/widgets.routes";
import { createZonePresetsRouter } from "../api/routes/zonePresets.routes";
import { createZonesRouter } from "../api/routes/zones.routes";
import { ApiError, sendError } from "../utils/errors";
import { createPortalAccessRouter } from "./routes/access.routes";
import { createPortalPublicAuthRouter, createPortalSessionRouter } from "./routes/auth.routes";
import { createPortalAudioAdminRouter } from "./routes/audioAdmin.routes";
import { createPortalConnectionsRouter } from "./routes/connections.routes";
import { createPortalDashboardRouter } from "./routes/dashboard.routes";
import { createPortalSystemRouter } from "./routes/system.routes";

function createPortalAuth(context: ApplicationContext) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = getBearerToken(req);
    if (!provided) {
      next(new ApiError("AUTH_REQUIRED", "Enter an administrator API key"));
      return;
    }

    const staticToken = context.config.portalAdminToken;
    if (staticToken && tokenMatches(provided, staticToken)) {
      next();
      return;
    }

    const portalUser = context.portalAuthService.authenticate(provided);
    if (portalUser) {
      res.locals.portalUser = portalUser;
      res.locals.portalSessionToken = provided;
      next();
      return;
    }

    const managed = context.apiKeyService.authenticate(provided);
    if (!managed) {
      next(new ApiError("AUTH_INVALID", "Invalid or revoked API key"));
      return;
    }
    if (managed.role !== "admin") {
      next(new ApiError("AUTH_FORBIDDEN", "Administrator API key required"));
      return;
    }
    next();
  };
}

function applyPortalSecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data: blob: https://coverartarchive.org https://archive.org; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
}

function mountSharedPortalApi(app: express.Express, context: ApplicationContext): void {
  app.use("/api/roon", createRoonRouter(context));
  app.use("/api/roon", createZonesRouter(context));
  app.use("/api/roon", createPlaybackRouter(context));
  app.use("/api/roon", createGroupingRouter(context));
  app.use("/api/roon", createVolumeRouter(context));
  app.use("/api/roon", createLibraryRouter(context));
  app.use("/api/roon", createMediaRouter(context));
  app.use("/api/roon", createQueueRouter(context));
  app.use("/api/roon", createAdvancedRouter(context));
  app.use("/api", createWidgetsRouter(context));
  app.use("/api", createPlaylistsRouter(context));
  app.use("/api", createZonePresetsRouter(context));
  app.use("/api", createVolumeLimitsRouter(context));
  app.use("/api/admin", createZonePresetsRouter(context));
  app.use("/api/admin", createVolumeLimitsRouter(context));
}

export function createPortalServer(context: ApplicationContext): express.Express {
  const app = express();
  const assetsPath = path.join(process.cwd(), "portal");

  app.disable("x-powered-by");
  app.use(express.json({ limit: "8mb" }));
  app.use(applyPortalSecurityHeaders);
  app.use(createPortalPublicAuthRouter(context));

  app.use("/api", createPortalAuth(context));
  app.use("/api", createActionAuditMiddleware(context, "portal"));
  app.use("/api", createObservabilityRouter(context));
  app.use(createPortalSessionRouter(context));
  app.use(createPortalDashboardRouter(context));
  app.use(createPortalConnectionsRouter(context));
  app.use(createPortalSystemRouter(context));
  app.use(createPortalAccessRouter(context));
  app.use(createPortalAudioAdminRouter(context));
  mountSharedPortalApi(app, context);

  app.use("/api", (req, _res, next) => {
    next(new ApiError("NOT_IMPLEMENTED", "Portal endpoint not found", {
      method: req.method,
      path: req.path
    }));
  });

  app.use(express.static(assetsPath, {
    etag: true,
    maxAge: context.config.nodeEnv === "production" ? "5m" : 0,
    setHeaders: (res, filePath) => {
      if (/\.(?:html|js|css)$/i.test(filePath)) res.setHeader("Cache-Control", "no-store");
    }
  }));

  app.get("*", (_req, res, next) => {
    res.sendFile(
      path.join(assetsPath, "index.html"),
      { headers: { "Cache-Control": "no-store" } },
      (error) => {
        if (error) next(error);
      }
    );
  });

  app.use((error: Error, _req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ApiError) {
      sendError(res, error);
      return;
    }
    context.logger.error("Portal request failed", {
      message: error.message,
      stack: error.stack
    });
    sendError(res, new ApiError("INTERNAL_ERROR", "Portal request failed"));
  });

  return app;
}
