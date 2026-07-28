import express, { NextFunction, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ApplicationContext } from "../app/context";
import { ApiError, sendError } from "../utils/errors";
import { createBridgeV2McpServer } from "../bridge-v2/mcp/server";
import { createHealthRouter } from "./routes/health.routes";
import { createRoonRouter } from "./routes/roon.routes";
import { createZonesRouter } from "./routes/zones.routes";
import { createPlaybackRouter } from "./routes/playback.routes";
import { createVolumeRouter } from "./routes/volume.routes";
import { createLibraryRouter } from "./routes/library.routes";
import { createQueueRouter } from "./routes/queue.routes";
import { createPlaylistsRouter } from "./routes/playlists.routes";
import { createOAuthRouter } from "./routes/oauth.routes";
import { createMediaRouter } from "./routes/media.routes";
import { createGroupingRouter } from "./routes/grouping.routes";
import { createAuthMiddleware } from "./middleware/auth";
import { APP_VERSION } from "../config/version";
import { createAdvancedRouter } from "./routes/advanced.routes";
import { createSafetyRouter } from "./routes/safety.routes";
import { createZonePresetsRouter } from "./routes/zonePresets.routes";
import { createVolumeLimitsRouter } from "./routes/volumeLimits.routes";
import { createWidgetAssetsRouter, createWidgetsRouter } from "./routes/widgets.routes";
import { createActionAuditMiddleware, createObservabilityRouter } from "./routes/observability.routes";
export type ApiContext = ApplicationContext;

export function createServer(context: ApiContext): express.Express {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.use(createHealthRouter(context));
  app.use(createOAuthRouter(context));
  app.use(createWidgetAssetsRouter(context));
  app.get("/privacy", (req, res) => {
    res
      .type("text/plain")
      .send([
        "Roon AI Bridge privacy notice",
        "",
        "This is a self-hosted local bridge for a private Roon installation.",
        "The service does not collect analytics, does not sell data, and does not send data to third parties by itself.",
        "When used from a ChatGPT app, ChatGPT may send only the tool request needed to call this service.",
        "Roon playback, queue, search and playlist requests are processed by this self-hosted service.",
        "Keep your API token private."
      ].join("\n"));
  });
  app.use(createAuthMiddleware(context));
  app.use(createActionAuditMiddleware(context, "http"));
  app.use(createSafetyRouter(context));
  app.use("/", createWidgetsRouter(context));
  app.use("/", createObservabilityRouter(context));

  app.all("/mcp", async (req, res, next) => {
    try {
      context.logger.info("MCP HTTP request received", {
        method: req.method,
        path: req.path
      });
      const server = createBridgeV2McpServer({
        ...context,
        activeApiKey: res.locals.apiKey || null
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      await server.connect(transport);
      res.on("close", () => {
        server.close().catch((error) => {
          context.logger.warn("MCP HTTP server close failed", {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      });
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      context.logger.error("MCP HTTP request failed", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      next(new ApiError("INTERNAL_ERROR", "MCP request failed"));
    }
  });

  app.use("/roon", createRoonRouter(context));
  app.use("/roon", createZonesRouter(context));
  app.use("/roon", createPlaybackRouter(context));
  app.use("/roon", createGroupingRouter(context));
  app.use("/roon", createVolumeRouter(context));
  app.use("/roon", createLibraryRouter(context));
  app.use("/roon", createMediaRouter(context));
  app.use("/roon", createQueueRouter(context));
  app.use("/roon", createAdvancedRouter(context));
  app.use("/", createPlaylistsRouter(context));
  app.use("/", createZonePresetsRouter(context));
  app.use("/", createVolumeLimitsRouter(context));

  app.get("/history", (req, res, next) => {
    context.logger.warn("History endpoint is not implemented yet");
    next(new ApiError("NOT_IMPLEMENTED", `History is not implemented in v${APP_VERSION}`));
  });

  app.get("/preferences", (req, res, next) => {
    context.logger.warn("Preferences endpoint is not implemented yet");
    next(new ApiError("NOT_IMPLEMENTED", `Preferences are not implemented in v${APP_VERSION}`));
  });

  app.use((req, res, next) => {
    next(new ApiError("NOT_IMPLEMENTED", `Endpoint is not implemented in v${APP_VERSION}`, {
      method: req.method,
      path: req.path
    }));
  });

  app.use(
    (error: Error, req: Request, res: Response, next: NextFunction): void => {
      if (res.headersSent) {
        next(error);
        return;
      }

      if (error instanceof ApiError) {
        if (error.code !== "NOT_IMPLEMENTED") {
          context.logger.warn("API validation or Roon error", {
            code: error.code,
            message: error.message,
            details: error.details
          });
        }
        sendError(res, error);
        return;
      }

      context.logger.error("Unhandled API error", {
        message: error.message,
        stack: error.stack
      });

      sendError(
        res,
        new ApiError("INTERNAL_ERROR", "Internal server error", {}, 500)
      );
    }
  );

  return app;
}
