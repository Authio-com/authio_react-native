/**
 * Typed error thrown by every Authio SDK entry point. Wraps both HTTP
 * failures (status, requestId, server-provided code/message) and local
 * preconditions (missing module, cancelled prompt, bad input).
 */
export class AuthioError extends Error {
  /** Server-provided error code (e.g. ``invalid_credential``) or one of
   * the local codes documented in {@link AuthioErrorCode}. */
  public readonly code: string;
  /** HTTP status when the error originated server-side, 0 otherwise. */
  public readonly status: number;
  /** Authio request ID for correlation with server logs. */
  public readonly requestId?: string;
  /** Optional structured payload from the server. */
  public readonly details?: unknown;

  constructor(args: {
    code: string;
    message: string;
    status?: number;
    requestId?: string;
    details?: unknown;
  }) {
    super(args.message);
    this.name = "AuthioError";
    this.code = args.code;
    this.status = args.status ?? 0;
    this.requestId = args.requestId;
    this.details = args.details;
    Object.setPrototypeOf(this, AuthioError.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      requestId: this.requestId,
      details: this.details,
    };
  }
}

/** Stable error codes the SDK itself emits (not from the server). */
export const AuthioErrorCode = {
  MissingPublishableKey: "missing_publishable_key",
  PasskeyModuleMissing: "passkey_module_missing",
  PasskeyUnsupported: "passkey_unsupported",
  PasskeyCancelled: "passkey_cancelled",
  OAuthCancelled: "oauth_cancelled",
  OAuthInvalidCallback: "oauth_invalid_callback",
  OAuthOpenerMissing: "oauth_opener_missing",
  MagicLinkInvalidCallback: "magic_link_invalid_callback",
  StorageUnavailable: "storage_unavailable",
  NetworkError: "network_error",
  ServerError: "server_error",
  InvalidArgument: "invalid_argument",
} as const;

export type AuthioErrorCodeT =
  (typeof AuthioErrorCode)[keyof typeof AuthioErrorCode];
