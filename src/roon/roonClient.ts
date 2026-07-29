import fs from "fs";
import os from "os";
import path from "path";
import RoonApi = require("node-roon-api");
import RoonApiBrowse = require("node-roon-api-browse");
import RoonApiTransport = require("node-roon-api-transport");
import RoonApiImage = require("node-roon-api-image");
import RoonApiSettings = require("node-roon-api-settings");
import RoonApiStatus = require("node-roon-api-status");
import { AppConfig } from "../config/env";
import { APP_VERSION } from "../config/version";
import { Logger } from "../utils/logger";
import { RoonZone } from "./roonTypes";
import { RoonOutput } from "./roonTypes";
import { SystemManagementService } from "../services/systemManagementService";
import { RoonBrowseApi, RoonImageApi, RoonTransportApi } from "./roonSdk";
import { applyZoneEvent } from "./roonStateCache";

export type RoonClient = {
  start(): void;
  stop(): void;
  getCoreName(): string | null;
  isCoreConnected(): boolean;
  isTransportReady(): boolean;
  isBrowseReady(): boolean;
  isImageReady(): boolean;
  getTransport(): RoonTransportApi | null;
  getBrowse(): RoonBrowseApi | null;
  getImage(): RoonImageApi | null;
  getZones(): RoonZone[];
  getOutputs(): RoonOutput[];
  getKnownOutputs?(): RoonOutput[];
  getOutput(outputId: string): RoonOutput | null;
  getZone(zoneId: string): RoonZone | null;
};

export function createRoonClient(
  config: AppConfig,
  logger: Logger,
  systemManagement?: SystemManagementService,
  onZonesChanged?: (zones: RoonZone[]) => void
): RoonClient {
  const stateFile = path.join(config.dataDir, "roonstate.json");
  let currentCore: any | null = null;
  let transport: RoonTransportApi | null = null;
  let browse: RoonBrowseApi | null = null;
  let image: RoonImageApi | null = null;
  let transportReady = false;
  let browseReady = false;
  let imageReady = false;
  let zonesById = new Map<string, RoonZone>();
  let outputsById = new Map<string, RoonOutput>();
  let knownOutputsById = new Map<string, RoonOutput>();
  let started = false;
  let stopped = false;
  let directConnection: any | null = null;
  let directReconnectTimer: NodeJS.Timeout | null = null;

  function portalWebsite(): string {
    const address = Object.values(os.networkInterfaces())
      .flatMap((entries) => entries || [])
      .find((entry) => entry.family === "IPv4" && !entry.internal)
      ?.address || "localhost";
    return `http://${address}:${config.portalPort}`;
  }

  function ensureDataDir(): void {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }

  function readRoonState(): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      return {};
    }
  }

  function writeRoonState(state: Record<string, unknown>): void {
    ensureDataDir();
    fs.writeFileSync(stateFile, JSON.stringify(state || {}, null, 2));
  }

  function mergeZoneChanges(event: string | false, data: any): void {
    zonesById = applyZoneEvent(zonesById, event, data);
  }

  function mergeOutputChanges(event: string, data: any): void {
    if (event === "Subscribed" && Array.isArray(data?.outputs)) {
      outputsById = new Map(
        data.outputs.map((output: RoonOutput) => [output.output_id, output])
      );
      knownOutputsById = new Map(
        data.outputs.map((output: RoonOutput) => [
          output.output_id,
          { ...output, currently_available: true, last_seen: new Date().toISOString() }
        ])
      );
      return;
    }
    for (const output of data?.outputs_added || []) {
      outputsById.set(output.output_id, output);
      knownOutputsById.set(output.output_id, {
        ...output,
        currently_available: true,
        last_seen: new Date().toISOString()
      });
    }
    for (const output of data?.outputs_changed || []) {
      outputsById.set(output.output_id, output);
      knownOutputsById.set(output.output_id, {
        ...output,
        currently_available: true,
        last_seen: new Date().toISOString()
      });
    }
    for (const outputId of data?.outputs_removed || []) {
      const known = knownOutputsById.get(outputId);
      if (known) knownOutputsById.set(outputId, { ...known, currently_available: false });
      outputsById.delete(outputId);
    }
  }

  ensureDataDir();

  const roon = new RoonApi({
    extension_id: config.roonExtensionId,
    display_name: config.roonExtensionName,
    display_version: APP_VERSION,
    publisher: "LINE-dev",
    email: "local@localhost",
    website: portalWebsite(),
    log_level: process.env.ROON_LOG_LEVEL || "none",
    force_server: true,
    get_persisted_state: readRoonState,
    set_persisted_state: writeRoonState,
    moo_onerror: (moo: any) => {
      logger.error("Roon API connection error", {
        coreId: moo?.core?.core_id || null
      });
    },
    core_paired: (core: any) => {
      currentCore = core;
      transport = core.services.RoonApiTransport;
      browse = core.services.RoonApiBrowse || null;
      image = core.services.RoonApiImage || null;
      transportReady = Boolean(transport);
      browseReady = Boolean(browse);
      imageReady = Boolean(image);

      logger.info("Authorization completed and core connected", {
        coreId: core.core_id,
        coreName: core.display_name,
        transportReady,
        browseReady
      });
      statusService.set_status(
        `Connected to ${core.display_name}; portal ${config.portalPort}`,
        false
      );

      if (!transport) {
        logger.error("Roon transport service is not available");
        return;
      }

      transport.subscribe_zones((event: string | false, data: any) => {
        mergeZoneChanges(event, data);
        if (event !== "Unsubscribed" && onZonesChanged) {
          try {
            onZonesChanged(Array.from(zonesById.values()));
          } catch (error) {
            logger.error("Listening history update failed", {
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
        const seekOnly = event === "Changed" &&
          Array.isArray(data?.zones_seek_changed) &&
          !data?.zones_added?.length &&
          !data?.zones_changed?.length &&
          !data?.zones_removed?.length;
        const log = seekOnly ? logger.debug : logger.info;
        log("Zones changed", {
          event,
          zonesCount: zonesById.size,
          added: data?.zones_added?.length,
          changed: data?.zones_changed?.length,
          removed: data?.zones_removed?.length
        });
      });

      transport.subscribe_outputs((event: string | false, data: any) => {
        mergeOutputChanges(String(event), data);
        logger.info("Outputs changed", {
          event,
          outputsCount: outputsById.size,
          added: data?.outputs_added?.length,
          changed: data?.outputs_changed?.length,
          removed: data?.outputs_removed?.length
        });
      });

      transport.get_outputs((error: string | false, body: any) => {
        if (error || !Array.isArray(body?.outputs)) return;
        outputsById = new Map(
          body.outputs.map((output: RoonOutput) => [output.output_id, output])
        );
        for (const output of body.outputs) {
          knownOutputsById.set(output.output_id, {
            ...output,
            currently_available: true,
            last_seen: new Date().toISOString()
          });
        }
      });
    },
    core_unpaired: (core: any) => {
      logger.warn("Core disconnected or unpaired", {
        coreId: core.core_id,
        coreName: core.display_name
      });
      currentCore = null;
      transport = null;
      browse = null;
      image = null;
      transportReady = false;
      browseReady = false;
      imageReady = false;
      zonesById = new Map();
      outputsById = new Map();
      knownOutputsById = new Map(
        Array.from(knownOutputsById.entries()).map(([outputId, output]) => [
          outputId,
          { ...output, currently_available: false }
        ])
      );
      statusService.set_status("Roon Core disconnected", true);
    }
  });

  const managementValues = () => {
    const info = systemManagement?.getSystemInfo() as any;
    const firstAddress = info?.addresses?.[0];
    return {
      bridge_port: config.port,
      portal_port: config.portalPort,
      allow_beta_updates: config.updateChannel === "beta",
      service_address:
        firstAddress?.portal_url || `http://localhost:${config.portalPort}`,
      action: "none"
    };
  };

  const managementLayout = (values = managementValues()) => ({
    values,
    layout: [
      {
        type: "string",
        title: "Service address (informational)",
        maxlength: 256,
        setting: "service_address"
      },
      {
        type: "integer",
        title: "Bridge API port",
        min: 1,
        max: 65535,
        setting: "bridge_port"
      },
      {
        type: "integer",
        title: "Administration portal port",
        min: 1,
        max: 65535,
        setting: "portal_port"
      },
      {
        type: "boolean",
        title: "Allow beta updates",
        setting: "allow_beta_updates"
      },
      {
        type: "dropdown",
        title: "Operation applied when settings are saved",
        values: [
          { value: "none", title: "No operation" },
          { value: "check_update", title: "Check for updates" },
          { value: "restart", title: "Restart RoonIA" },
          { value: "update", title: "Update to selected channel" }
        ],
        setting: "action"
      }
    ],
    has_error: false
  });

  const settingsService = new RoonApiSettings(roon, {
    get_settings: (callback: (settings: unknown) => void) => {
      callback(managementLayout());
    },
    save_settings: (req: any, isDryRun: boolean, settings: any) => {
      try {
        const requested = settings?.values || {};
        const bridgePort = Number(requested.bridge_port);
        const portalPort = Number(requested.portal_port);
        const allowBetaUpdates = requested.allow_beta_updates === true;
        const action = String(requested.action || "none");
        if (!systemManagement) throw new Error("System management is unavailable");
        if (
          !Number.isInteger(bridgePort) ||
          !Number.isInteger(portalPort) ||
          bridgePort < 1 ||
          bridgePort > 65535 ||
          portalPort < 1 ||
          portalPort > 65535 ||
          bridgePort === portalPort
        ) {
          throw new Error("Ports must be different integers from 1 to 65535");
        }
        const layout = managementLayout({
          ...managementValues(),
          bridge_port: bridgePort,
          portal_port: portalPort,
          allow_beta_updates: allowBetaUpdates,
          action: "none"
        });
        req.send_complete("Success", { settings: layout });
        if (isDryRun) return;
        systemManagement.saveRuntimeConfig({
          api_port: bridgePort,
          portal_port: portalPort,
          allow_beta_updates: allowBetaUpdates
        });
        settingsService.update_settings(layout);
        if (action === "check_update") {
          systemManagement.checkForUpdates().then((result) => {
            statusService.set_status(
              result.error
                ? `Update check failed: ${result.error}`
                : result.update_available
                  ? `Update available: ${result.latest_version}`
                  : `RoonIA ${APP_VERSION} is up to date`,
              Boolean(result.error)
            );
          });
        } else if (action === "update") {
          systemManagement.requestUpdate({ allow_beta_updates: allowBetaUpdates });
          statusService.set_status("Update requested; waiting for LXC updater", false);
        } else if (action === "restart") {
          systemManagement.requestRestart();
        }
      } catch (error) {
        req.send_complete("NotValid", {
          settings: {
            ...managementLayout(settings?.values),
            has_error: true
          },
          message: error instanceof Error ? error.message : String(error)
        });
      }
    },
    button_pressed: (req: any) => req.send_complete("Success")
  });
  const statusService = new RoonApiStatus(roon);
  statusService.set_status(`RoonIA ${APP_VERSION} starting`, false);

  const requiredServices = config.enableBrowse
    ? [RoonApiTransport, RoonApiBrowse]
    : [RoonApiTransport];

  roon.init_services({
    required_services: requiredServices,
    optional_services: [RoonApiImage],
    provided_services: [settingsService, statusService]
  });

  return {
    start() {
      if (started && !stopped) return;
      started = true;
      stopped = false;
      if (config.roonCoreHost && config.roonCorePort) {
        const connectDirectly = (): void => {
          if (stopped || directConnection) return;
          logger.info("Connecting directly to Roon Core", {
            host: config.roonCoreHost,
            port: config.roonCorePort
          });
          directConnection = (roon as any).ws_connect({
            host: config.roonCoreHost,
            port: config.roonCorePort,
            onclose: () => {
              directConnection = null;
              if (stopped) return;
              logger.warn("Direct Roon Core connection closed; retrying", {
                retryInMs: 5_000
              });
              directReconnectTimer = setTimeout(() => {
                directReconnectTimer = null;
                connectDirectly();
              }, 5_000);
            },
            onerror: () => {
              logger.error("Direct Roon Core connection error", {
                host: config.roonCoreHost,
                port: config.roonCorePort
              });
            }
          });
        };
        logger.info(
          "Authorization pending: enable the extension in Roon Settings > Setup > Extensions"
        );
        connectDirectly();
        return;
      }
      logger.info("Starting Roon Core discovery");
      logger.info(
        "Authorization pending: enable the extension in Roon Settings > Setup > Extensions"
      );
      roon.start_discovery();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      logger.info("Stopping Roon Core discovery and connections");
      try {
        if (directReconnectTimer) {
          clearTimeout(directReconnectTimer);
          directReconnectTimer = null;
        }
        try {
          directConnection?.transport?.close?.();
        } finally {
          directConnection = null;
        }
        (roon as any).stop_discovery?.();
      } finally {
        (roon as any).disconnect_all?.();
        currentCore = null;
        transport = null;
        browse = null;
        image = null;
        transportReady = false;
        browseReady = false;
        imageReady = false;
        zonesById = new Map();
        outputsById = new Map();
      }
    },
    getCoreName() {
      return currentCore ? currentCore.display_name : null;
    },
    isCoreConnected() {
      return Boolean(currentCore);
    },
    isTransportReady() {
      return transportReady;
    },
    isBrowseReady() {
      return browseReady;
    },
    isImageReady() {
      return imageReady;
    },
    getTransport() {
      return transport;
    },
    getBrowse() {
      return browse;
    },
    getImage() {
      return image;
    },
    getZones() {
      return Array.from(zonesById.values());
    },
    getOutputs() {
      return Array.from(outputsById.values());
    },
    getKnownOutputs() {
      return Array.from(knownOutputsById.values());
    },
    getOutput(outputId: string) {
      return outputsById.get(outputId) || null;
    },
    getZone(zoneId: string) {
      return zonesById.get(zoneId) || null;
    }
  };
}
