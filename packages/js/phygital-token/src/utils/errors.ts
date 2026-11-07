/** Codes carried by `PhygitalTokenError`. */
export type PhygitalTokenErrorCode =
  | "INVALID_PUBLIC_KEY"
  | "WEBAUTHN_UNSUPPORTED"
  | "AUTHENTICATION_CANCELLED"
  | "INVALID_ASSERTION"
  | "INVALID_ARGUMENT";

/**
 * Error thrown for failures a caller or end user can act on. Branch on
 * {@link PhygitalTokenError.code}; `message` is safe to show in UI.
 */
export class PhygitalTokenError extends Error {
  readonly code: PhygitalTokenErrorCode;

  constructor(code: PhygitalTokenErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PhygitalTokenError";
    this.code = code;
  }
}
