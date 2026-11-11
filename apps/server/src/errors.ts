import {
  ErrorResponseSchema,
  type ErrorCode,
  type ErrorResponse
} from "@multiplayer-game/protocol";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, string | number | boolean | null>
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface SafeHttpError {
  readonly statusCode: number;
  readonly response: ErrorResponse;
}

export function toSafeHttpError(error: unknown, requestId: string): SafeHttpError {
  let statusCode = 500;
  let code: ErrorCode = "INTERNAL_ERROR";
  let message = "An unexpected error occurred.";
  let details: Record<string, string | number | boolean | null> | undefined;

  if (error instanceof HttpError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    switch (error.statusCode) {
      case 401:
        statusCode = 401;
        code = "UNAUTHENTICATED";
        message = "Authentication is required.";
        break;
      case 403:
        statusCode = 403;
        code = "FORBIDDEN";
        message = "This action is not permitted.";
        break;
      case 404:
        statusCode = 404;
        code = "NOT_FOUND";
        message = "Resource not found.";
        break;
      case 413:
        statusCode = 413;
        code = "PAYLOAD_TOO_LARGE";
        message = "Request payload is too large.";
        break;
      case 409:
        statusCode = 409;
        code = "REVISION_CONFLICT";
        message = "The resource has changed.";
        break;
      case 422:
        statusCode = 422;
        code = "INVALID_SETTINGS";
        message = "Request data is invalid.";
        break;
      case 429:
        statusCode = 429;
        code = "RATE_LIMITED";
        message = "Too many requests.";
        break;
      default:
        statusCode = 400;
        code = "BAD_REQUEST";
        message = "Request validation failed.";
    }
  }

  return {
    statusCode,
    response: ErrorResponseSchema.parse({
      error: {
        code,
        message,
        requestId,
        ...(details ? { details } : {})
      }
    })
  };
}
