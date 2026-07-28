import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { RoonOutput, RoonZone } from "./roonTypes";
import { getZoneOrThrow } from "./roonZoneService";
import { requireTransport } from "./roonTransportService";
import {
  evaluateZoneVolumePolicy,
  VolumeSafetyLimit,
  ZoneVolumePolicy
} from "../safety/volumeSafety";
import {
  confirmationRequiredResponse,
  dryRunResponse,
  getToolClassification
} from "../safety/actionSafety";
import { roonSdkCall, waitForRoonState } from "./roonSdk";

export type VolumeOutputState = {
  output_id: string;
  display_name: string;
  volume: RoonOutput["volume"];
  normalized_volume: Record<string, unknown> | null;
};

export type VolumeChangeResult = {
  ok: true;
  action?: "roon_set_volume";
  dry_run?: false;
  classification?: ReturnType<typeof getToolClassification>;
  zone_id: string;
  zone_name: string;
  mode: "relative" | "absolute" | "relative_step";
  value: number;
  outputs: VolumeOutputState[];
  volume_policy: ZoneVolumePolicy;
  state_verified: boolean;
};

function volumeCapableOutputs(zone: RoonZone): RoonOutput[] {
  return (zone.outputs || []).filter((output) => output.volume);
}

function volumeLimit(
  output: RoonOutput,
  key: "min" | "max",
  hardKey: "hard_limit_min" | "hard_limit_max"
): number | null {
  const volume = output.volume || {};
  const hard = volume[hardKey] as unknown;
  if (typeof hard === "number" && Number.isFinite(hard)) return hard;
  const soft = volume[key];
  return typeof soft === "number" && Number.isFinite(soft) ? soft : null;
}

function projectedVolume(
  output: RoonOutput,
  mode: "relative" | "absolute" | "relative_step",
  value: number
): number | null {
  const volume = output.volume || {};
  const current = typeof volume.value === "number" ? volume.value : null;
  if (mode === "absolute") return value;
  if (current === null) return null;
  if (mode === "relative_step") {
    const step = typeof volume.step === "number" && volume.step > 0 ? volume.step : 1;
    return current + value * step;
  }
  return current + value;
}

function validateVolume(
  outputs: RoonOutput[],
  mode: "relative" | "absolute" | "relative_step",
  value: number
): void {
  if (outputs.length === 0) {
    throw new ApiError("VOLUME_NOT_SUPPORTED", "Volume is not supported by this zone");
  }

  const incrementalOutputs = outputs.filter(
    (output) => output.volume?.type === "incremental"
  );
  if (
    incrementalOutputs.length > 0 &&
    (mode !== "relative" || Math.abs(value) !== 1)
  ) {
    throw new ApiError(
      "INVALID_VOLUME_VALUE",
      "Incremental outputs require relative volume with a value of -1 or 1",
      {
        outputs: incrementalOutputs.map((output) => output.display_name),
        mode,
        value
      }
    );
  }

  for (const output of outputs) {
    const projected = projectedVolume(output, mode, value);
    if (projected === null) continue;
    const min = volumeLimit(output, "min", "hard_limit_min");
    const max = volumeLimit(output, "max", "hard_limit_max");
    if ((min !== null && projected < min) || (max !== null && projected > max)) {
      throw new ApiError("INVALID_VOLUME_VALUE", "Volume value is outside output range", {
        output_id: output.output_id,
        output_name: output.display_name,
        min,
        max,
        current: output.volume?.value,
        requested_value: value,
        projected_value: projected,
        mode
      });
    }
  }
}

function outputState(output: RoonOutput): VolumeOutputState {
  const volume = output.volume || null;
  const min = typeof volume?.min === "number" ? volume.min : null;
  const max = typeof volume?.max === "number" ? volume.max : null;
  const raw = typeof volume?.value === "number" ? volume.value : null;
  const normalizedPercent =
    volume?.type === "number" && raw !== null && min !== null && max !== null && max > min
      ? Math.round(((raw - min) / (max - min)) * 100)
      : null;
  return {
    output_id: output.output_id,
    display_name: output.display_name,
    volume: output.volume,
    normalized_volume: volume
      ? {
          volume_type: volume.type || null,
          raw_value: raw,
          normalized_percent: normalizedPercent,
          min,
          max,
          step: volume.step ?? null,
          hard_limit: (volume as Record<string, unknown>).hard_limit_max ?? null,
          soft_limit: max
        }
      : null
  };
}

export async function changeZoneVolume(
  roonClient: RoonClient,
  zoneId: string,
  mode: "relative" | "absolute" | "relative_step",
  value: number,
  options: { dryRun?: boolean; confirm?: boolean; volumeLimits?: VolumeSafetyLimit[] } = {}
): Promise<VolumeChangeResult | Record<string, unknown>> {
  const zone = getZoneOrThrow(roonClient, zoneId);
  const outputs = volumeCapableOutputs(zone);

  validateVolume(outputs, mode, value);
  const volumePolicy = evaluateZoneVolumePolicy(zone, outputs, mode, value, options.volumeLimits);
  const before = {
    zone_id: zone.zone_id,
    zone_name: zone.display_name,
    outputs: outputs.map(outputState)
  };
  const after = {
    zone_id: zone.zone_id,
    zone_name: zone.display_name,
    outputs: outputs.map((output) => ({
      ...outputState(output),
      projected_value: volumePolicy.outputs.find(
        (policy) => policy.output_id === output.output_id
      )?.projected_value ?? null
    }))
  };

  if (options.dryRun) {
    return dryRunResponse(
      "roon_set_volume",
      { before, after, volume_policy: volumePolicy },
      {
        before,
        after,
        extra: { volume_policy: volumePolicy }
      }
    );
  }

  if (volumePolicy.requires_confirmation && !options.confirm) {
    const primaryPolicy =
      volumePolicy.outputs.find((policy) => policy.requires_confirmation) ||
      volumePolicy.outputs[0];
    return confirmationRequiredResponse(
      "roon_set_volume",
      "volume_above_safe_limit",
      "Requested volume exceeds the configured safe limit.",
      {
        zone_id: zoneId,
        mode,
        requested_value: value,
        safe_limit: primaryPolicy?.safe_limit ?? volumePolicy.safe_limit,
        current_value: primaryPolicy?.current_value ?? null,
        projected_value: primaryPolicy?.projected_value ?? null,
        hard_limit: primaryPolicy?.hard_limit ?? volumePolicy.hard_limit
      },
      {
        zone_id: zoneId,
        mode,
        value
      },
      "Requested volume exceeds the configured safe limit."
    );
  }

  const transport = requireTransport(roonClient);
  const expectedValues = new Map(
    outputs
      .map((output) => [output.output_id, projectedVolume(output, mode, value)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== null)
  );
  const appliedOutputIds: string[] = [];
  for (const output of outputs) {
    try {
      await roonSdkCall<void>(
        "Roon volume change",
        (callback) => transport.change_volume(output, mode, value, callback),
        { output_id: output.output_id, mode, value }
      );
      appliedOutputIds.push(output.output_id);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(error.code, error.message, {
          ...error.details,
          applied_output_ids: appliedOutputIds,
          partially_applied: appliedOutputIds.length > 0
        }, error.status);
      }
      throw error;
    }
  }

  const verifiedZone = expectedValues.size > 0
    ? await waitForRoonState(
        () => roonClient.getZone(zoneId),
        (candidate) => Array.from(expectedValues.entries()).every(([outputId, expected]) => {
          const actual = candidate.outputs?.find((output) => output.output_id === outputId)?.volume?.value;
          return typeof actual === "number" && Math.abs(actual - expected) < 0.001;
        })
      )
    : null;
  const refreshedZone = verifiedZone || roonClient.getZone(zoneId) || zone;
  return {
    ok: true,
    action: "roon_set_volume",
    dry_run: false,
    classification: getToolClassification("roon_set_volume"),
    zone_id: zoneId,
    zone_name: refreshedZone.display_name,
    mode,
    value,
    outputs: volumeCapableOutputs(refreshedZone).map(outputState),
    volume_policy: volumePolicy,
    state_verified: Boolean(verifiedZone)
  };
}
