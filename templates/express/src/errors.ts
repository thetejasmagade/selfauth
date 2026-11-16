import type { ErrorCode, ErrorDetail, ErrorEnvelope } from "./auth/types.ts";

/**
 * Error raised by handlers; rendered with the spec's error envelope
 * (ERR-FORMAT-001). Only `import type` is used from @selfauth/spec, so the
 * application has no runtime dependency on SelfAuth packages.
 */
export class HttpError extends Error {
  override name = "HttpError";
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: ErrorDetail[] | undefined;

  constructor(status: number, code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function envelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: ErrorDetail[],
): ErrorEnvelope {
  return { error: { code, message, requestId, ...(details ? { details } : {}) } };
}
