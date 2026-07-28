import { BridgeV2Context } from "../bridge-v2/context";
import { AppConfig } from "../config/env";
import { createDatabase, SqliteDatabase } from "../db/database";
import { createRoonClient } from "../roon/roonClient";
import { RoonMediaService } from "../roon/roonMediaService";
import { ActionLogService } from "../services/actionLogService";
import { ApiKeyService } from "../services/apiKeyService";
import { DiagnosticsService } from "../services/diagnosticsService";
import { ExtensionManagerService } from "../services/extensionManagerService";
import { HomeHistoryService } from "../services/homeHistoryService";
import { ListenBrainzMetadataService } from "../services/listenBrainzMetadataService";
import { MetadataProviderCacheService } from "../services/metadataProviderCacheService";
import { OAuthService } from "../services/oauthService";
import { OutputVolumeSettingsService } from "../services/outputVolumeSettingsService";
import { PlaylistService } from "../services/playlistService";
import { PlaylistBuildService } from "../services/playlistBuildService";
import { PlaylistCatalogDiagnosticsService } from "../services/playlistCatalogDiagnosticsService";
import { PlaylistMetadataEnrichmentService } from "../services/playlistMetadataEnrichmentService";
import { PlaylistRepairService } from "../services/playlistRepairService";
import { PortalAuthService } from "../services/portalAuthService";
import { RecordingMetadataService } from "../services/recordingMetadataService";
import { TrackCatalogService } from "../services/trackCatalogService";
import { SystemManagementService } from "../services/systemManagementService";
import { createObservedLogger, TechnicalLogService } from "../services/technicalLogService";
import { ToolAccessService } from "../services/toolAccessService";
import { VolumeLimitService } from "../services/volumeLimitService";
import { ZonePresetService } from "../services/zonePresetService";
import { createLogger } from "../utils/logger";
import { ApplicationContext } from "./context";

export type ApplicationRuntime = {
  context: ApplicationContext;
  database: SqliteDatabase;
  shutdown(): void;
};

export function createApplication(config: AppConfig): ApplicationRuntime {
  const baseLogger = createLogger(config.logLevel);
  const database = createDatabase(config);
  const technicalLogService = new TechnicalLogService(database);
  const logger = createObservedLogger(baseLogger, technicalLogService);
  const systemManagementService = new SystemManagementService(config, logger);
  const homeHistoryService = new HomeHistoryService(database);
  const roonClient = createRoonClient(
    config,
    logger,
    systemManagementService,
    (zones) => {
      const recorded = homeHistoryService.observeZones(zones);
      if (recorded > 0) logger.info("Listening history updated", { recorded });
    }
  );
  const playlistService = new PlaylistService(config, database);
  const oauthService = new OAuthService(config);
  const mediaService = new RoonMediaService(roonClient, config.roonStreamingSource);
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
  const trackCatalogService = new TrackCatalogService(
    database,
    recordingMetadataService,
    mediaService,
    metadataProviderCacheService,
    logger
  );
  const playlistCatalogDiagnosticsService = new PlaylistCatalogDiagnosticsService(
    playlistService,
    recordingMetadataService,
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
  const apiKeyService = new ApiKeyService(config, database);
  const toolAccessService = new ToolAccessService(database);
  const portalAuthService = new PortalAuthService(config, database);
  const zonePresetService = new ZonePresetService(config, database);
  const outputVolumeSettingsService = new OutputVolumeSettingsService(config, database);
  const volumeLimitService = new VolumeLimitService(config, database);
  const actionLogService = new ActionLogService(database);
  const extensionManagerService = new ExtensionManagerService(config, technicalLogService);

  const manifestContext: BridgeV2Context = {
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
    volumeLimitService,
    actionLogService,
    technicalLogService,
    toolAccessService
  };
  const diagnosticsService = new DiagnosticsService(
    config,
    database,
    roonClient,
    actionLogService,
    technicalLogService,
    extensionManagerService,
    manifestContext
  );

  let shutDown = false;
  return {
    database,
    shutdown() {
      if (shutDown) return;
      shutDown = true;
      logger.info("Stopping application services");
      systemManagementService.stopAutomaticChecks();
      roonClient.stop();
      logger.info("Application services stopped; closing database");
      database.close();
    },
    context: {
      config,
      logger,
      roonClient,
      playlistService,
      playlistBuildService,
      playlistMetadataEnrichmentService,
      playlistRepairService,
      playlistCatalogDiagnosticsService,
      trackCatalogService,
      recordingMetadataService,
      metadataProviderCacheService,
      oauthService,
      mediaService,
      apiKeyService,
      portalAuthService,
      systemManagementService,
      zonePresetService,
      outputVolumeSettingsService,
      volumeLimitService,
      actionLogService,
      homeHistoryService,
      technicalLogService,
      extensionManagerService,
      diagnosticsService,
      toolAccessService
    }
  };
}
