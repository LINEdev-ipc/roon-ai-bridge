import { loadConfig } from "../../config/env";
import { createRoonClient } from "../../roon/roonClient";
import { PlaylistService } from "../../services/playlistService";
import { RoonMediaService } from "../../roon/roonMediaService";
import { createStderrLogger } from "../../utils/logger";
import { createDatabase } from "../../db/database";
import { ListenBrainzMetadataService } from "../../services/listenBrainzMetadataService";
import { MetadataProviderCacheService } from "../../services/metadataProviderCacheService";
import { PlaylistCatalogDiagnosticsService } from "../../services/playlistCatalogDiagnosticsService";
import { PlaylistBuildService } from "../../services/playlistBuildService";
import { PlaylistMetadataEnrichmentService } from "../../services/playlistMetadataEnrichmentService";
import { PlaylistRepairService } from "../../services/playlistRepairService";
import { RecordingMetadataService } from "../../services/recordingMetadataService";
import { TrackCatalogService } from "../../services/trackCatalogService";
import { SystemManagementService } from "../../services/systemManagementService";
import { ZonePresetService } from "../../services/zonePresetService";
import { VolumeLimitService } from "../../services/volumeLimitService";
import { startBridgeV2McpServer } from "./server";

const config = {
  ...loadConfig(),
  enableBrowse: true,
  enableMcp: true
};
const logger = createStderrLogger(config.logLevel);

logger.info("MCP configuration loaded", {
  dataDir: config.dataDir,
  browseEnabled: config.enableBrowse,
  mcpEnabled: config.enableMcp
});

const systemManagementService = new SystemManagementService(config, logger);
const roonClient = createRoonClient(config, logger, systemManagementService);
const database = createDatabase(config);
const playlistService = new PlaylistService(config, database);
const metadataProviderCacheService = new MetadataProviderCacheService(database);
metadataProviderCacheService.purgeExpired();
const listenBrainzMetadataService = new ListenBrainzMetadataService(
  fetch,
  metadataProviderCacheService
);
const recordingMetadataService = new RecordingMetadataService(fetch, {
  cache: metadataProviderCacheService,
  listenBrainz: listenBrainzMetadataService
});
const playlistCatalogDiagnosticsService = new PlaylistCatalogDiagnosticsService(
  playlistService,
  recordingMetadataService,
  metadataProviderCacheService,
  logger
);
const mediaService = new RoonMediaService(roonClient, config.roonStreamingSource);
const trackCatalogService = new TrackCatalogService(
  database,
  recordingMetadataService,
  mediaService,
  metadataProviderCacheService,
  logger
);
const playlistMetadataEnrichmentService = new PlaylistMetadataEnrichmentService(
  playlistService,
  mediaService,
  logger,
  "streaming_first",
  recordingMetadataService
);
const playlistRepairService = new PlaylistRepairService(
  playlistService,
  mediaService,
  playlistMetadataEnrichmentService,
  logger,
  trackCatalogService
);
const playlistBuildService = new PlaylistBuildService(
  playlistService,
  mediaService,
  logger,
  "streaming_first",
  playlistMetadataEnrichmentService,
  trackCatalogService
);
const zonePresetService = new ZonePresetService(config, database);
const volumeLimitService = new VolumeLimitService(config, database);

roonClient.start();

startBridgeV2McpServer({
  config,
  logger,
  roonClient,
  playlistService,
  playlistBuildService,
  playlistMetadataEnrichmentService,
  playlistRepairService,
  playlistCatalogDiagnosticsService,
  trackCatalogService,
  mediaService,
  systemManagementService,
  zonePresetService,
  volumeLimitService
}).catch((error) => {
  logger.error("MCP server failed", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exitCode = 1;
});
