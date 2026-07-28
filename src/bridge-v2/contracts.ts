import { ApiError } from "../utils/errors";

export type OperationStatus =
  | "completed"
  | "in_progress"
  | "needs_input"
  | "ambiguous"
  | "confirmation_required"
  | "not_available"
  | "failed";

export type OperationResult = {
  status: OperationStatus;
  operation: string;
  summary: string;
  verified: boolean;
  data: unknown;
  references: Record<string, unknown>;
  warnings: string[];
  error?: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

export type TargetReference = {
  id?: string;
  name?: string;
};

export type MediaSelector = {
  result_id?: string;
  query?: string;
  type?: "track" | "album" | "artist" | "playlist";
  source_preference?: "highest_quality" | "streaming_first" | "library_first";
};

export function completed(
  operation: string,
  summary: string,
  data: unknown,
  options: {
    verified?: boolean;
    references?: Record<string, unknown>;
    warnings?: string[];
  } = {}
): OperationResult {
  return {
    status: "completed",
    operation,
    summary,
    verified: options.verified ?? false,
    data,
    references: options.references || {},
    warnings: options.warnings || []
  };
}

export function ambiguous(
  operation: string,
  summary: string,
  data: unknown,
  references: Record<string, unknown> = {}
): OperationResult {
  return {
    status: "ambiguous",
    operation,
    summary,
    verified: false,
    data,
    references,
    warnings: []
  };
}

export function normalizeServiceResult(
  operation: string,
  summary: string,
  value: any,
  verified = false
): OperationResult {
  if (value?.requires_confirmation) {
    return {
      status: "confirmation_required",
      operation,
      summary: value.message || "Confirmation is required before continuing.",
      verified: false,
      data: value,
      references: {},
      warnings: Array.isArray(value.warnings) ? value.warnings : []
    };
  }
  return completed(operation, summary, value, {
    verified: Boolean(value?.state_verified ?? value?.verified ?? verified),
    warnings: Array.isArray(value?.warnings) ? value.warnings : []
  });
}

export function failed(operation: string, error: unknown): OperationResult {
  const apiError = error instanceof ApiError
    ? error
    : new ApiError(
        "INTERNAL_ERROR",
        error instanceof Error ? error.message : String(error)
      );
  return {
    status: "failed",
    operation,
    summary: apiError.message,
    verified: false,
    data: null,
    references: {},
    warnings: [],
    error: {
      code: apiError.code,
      message: apiError.message,
      details: apiError.details
    }
  };
}
