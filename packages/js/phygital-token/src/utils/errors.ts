export type PhygitalTokenErrorCode =
  | "INVALID_PUBLIC_KEY"
  | "RP_ID_REQUIRED"
  | "RECOVERY_SOURCE_REQUIRED"
  | "WEBAUTHN_UNSUPPORTED"
  | "AUTHENTICATION_CANCELLED"
  | "INVALID_CREDENTIAL_ID"
  | "PASSKEY_RECOVERY_FAILED"
  | "PASSKEY_NOT_RECOGNIZED"
  | "PASSKEY_AMBIGUOUS"
  | "INVALID_ASSERTION"
  | "MESSAGE_MISMATCH"
  | "SLOT_HASH_UNAVAILABLE";

/**
 * Error thrown for failures a caller or end user can act on. Branch on
 * {@link PhygitalTokenError.code}; `message` is safe to show in UI.
 */
export class PhygitalTokenError extends Error {
  readonly code: PhygitalTokenErrorCode;

  constructor(
    code: PhygitalTokenErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "PhygitalTokenError";
    this.code = code;
  }
}
