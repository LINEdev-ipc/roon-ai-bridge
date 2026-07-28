export type ToolClassification = {
  read_only: boolean;
  safe_mutation: boolean;
  destructive: boolean;
  audible: boolean;
  queue_mutation: boolean;
  volume_mutation: boolean;
  requires_confirmation_by_default: boolean;
};

export type MutationResponseOptions = {
  before?: unknown;
  after?: unknown;
  planned_changes?: unknown;
  warnings?: string[];
  extra?: Record<string, unknown>;
};

const readOnly: ToolClassification = {
  read_only: true,
  safe_mutation: false,
  destructive: false,
  audible: false,
  queue_mutation: false,
  volume_mutation: false,
  requires_confirmation_by_default: false
};

const safeMutation: ToolClassification = {
  read_only: false,
  safe_mutation: true,
  destructive: false,
  audible: false,
  queue_mutation: false,
  volume_mutation: false,
  requires_confirmation_by_default: false
};

export const TOOL_CLASSIFICATION: Record<string, ToolClassification> = {
  roon_get_state: readOnly,
  roon_search_media: readOnly,
  roon_get_media_entity: readOnly,
  roon_get_queue: readOnly,
  roon_list_playlists: readOnly,
  roon_list_temporary_playlists: readOnly,
  roon_get_playlist: readOnly,
  roon_prepare_playlist_cover: readOnly,
  roon_analyze_playlist: readOnly,
  roon_export_playlist: readOnly,
  roon_get_configuration: readOnly,
  roon_run_diagnostics: readOnly,
  roon_show_now_playing: readOnly,
  roon_show_zones: readOnly,
  roon_show_queue: readOnly,
  roon_show_media: readOnly,
  roon_show_playlist: readOnly,
  roon_show_playlist_library: readOnly,

  roon_control_playback: { ...safeMutation, audible: true },
  roon_set_volume: { ...safeMutation, volume_mutation: true },
  roon_control_output: { ...safeMutation, audible: true, volume_mutation: true },
  roon_set_playback_options: safeMutation,
  roon_set_grouping: { ...safeMutation, audible: true },
  roon_transfer_playback: { ...safeMutation, audible: true, queue_mutation: true },
  roon_play_media: { ...safeMutation, audible: true, queue_mutation: true },
  roon_enqueue_media: { ...safeMutation, queue_mutation: true },
  roon_start_radio: { ...safeMutation, audible: true, queue_mutation: true },
  roon_play_queue_item: { ...safeMutation, audible: true, queue_mutation: true },
  roon_save_playlist: safeMutation,
  roon_create_temporary_playlist: safeMutation,
  roon_promote_temporary_playlist: safeMutation,
  roon_set_playlist_cover: safeMutation,
  roon_play_playlist: { ...safeMutation, audible: true, queue_mutation: true },
  roon_play_playlist_track: { ...safeMutation, audible: true, queue_mutation: true },
  roon_rebuild_playlist: safeMutation,
  roon_save_configuration: safeMutation,
  roon_apply_zone_preset: { ...safeMutation, audible: true, volume_mutation: true },
  roon_edit_playlist_tracks: {
    read_only: false,
    safe_mutation: false,
    destructive: true,
    audible: false,
    queue_mutation: false,
    volume_mutation: false,
    requires_confirmation_by_default: true
  },
  roon_delete_playlist: {
    read_only: false,
    safe_mutation: false,
    destructive: true,
    audible: false,
    queue_mutation: false,
    volume_mutation: false,
    requires_confirmation_by_default: true
  },
  roon_import_playlist: {
    read_only: false,
    safe_mutation: false,
    destructive: true,
    audible: false,
    queue_mutation: false,
    volume_mutation: false,
    requires_confirmation_by_default: true
  },
  roon_delete_configuration: {
    read_only: false,
    safe_mutation: false,
    destructive: true,
    audible: false,
    queue_mutation: false,
    volume_mutation: false,
    requires_confirmation_by_default: true
  }
};

export function getToolClassification(action: string): ToolClassification {
  return TOOL_CLASSIFICATION[action] || safeMutation;
}

export function mutationSuccess(
  action: string,
  result: unknown,
  options: MutationResponseOptions = {}
): Record<string, unknown> {
  return {
    ok: true,
    action,
    dry_run: false,
    classification: getToolClassification(action),
    before: options.before ?? null,
    after: options.after ?? result,
    warnings: options.warnings || [],
    ...(result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : { result }),
    ...(options.extra || {})
  };
}

export function dryRunResponse(
  action: string,
  plannedChanges: unknown,
  options: MutationResponseOptions = {}
): Record<string, unknown> {
  return {
    ok: true,
    dry_run: true,
    would_execute: true,
    action,
    classification: getToolClassification(action),
    planned_changes: plannedChanges,
    before: options.before ?? null,
    after: options.after ?? null,
    warnings: options.warnings || [],
    ...(options.extra || {})
  };
}

export function confirmationRequiredResponse(
  action: string,
  reason: string,
  message: string,
  plannedAction: Record<string, unknown>,
  originalArguments: Record<string, unknown>,
  humanSummary = message
): Record<string, unknown> {
  return {
    ok: false,
    requires_confirmation: true,
    confirmation_reason: reason,
    action,
    message,
    human_summary: humanSummary,
    classification: getToolClassification(action),
    planned_action: plannedAction,
    confirm_payload: {
      tool: action,
      arguments: {
        ...originalArguments,
        dry_run: false,
        confirm: true
      }
    }
  };
}

export function safetyPolicyPayload(volumeLimits: unknown): Record<string, unknown> {
  return {
    version: 1,
    volume_limits: volumeLimits,
    tool_classification: TOOL_CLASSIFICATION,
    confirmation_policy: {
      destructive_requires_confirmation: true,
      volume_above_safe_limit_requires_confirmation: true,
      playback_requires_confirmation: false
    }
  };
}
