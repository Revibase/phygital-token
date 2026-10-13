/** Mapping thrown errors to protocol error codes. */
import type { ErrorCode } from "../messaging/protocol.js";
import { PrfUnsupported, WebAuthnUnsupported } from "../keys/webauthn.js";
import { ServiceError } from "../keys/wallet-service.js";

/**
 * The user closed the OS passkey sheet (NotAllowedError/AbortError), which
 * `decryptWallet` reports as AUTHENTICATION_FAILED with the DOMException as
 * its cause. Sign and export report it as USER_CANCELLED. Unlock keeps
 * AUTHENTICATION_FAILED, since a removed passkey looks the same to the browser
 * and the app's lost-passkey path depends on it.
 */
export function promptDismissed(e: unknown): boolean {
  const cause = e instanceof ServiceError ? e.cause : e;
  return (
    cause instanceof DOMException &&
    (cause.name === "NotAllowedError" || cause.name === "AbortError")
  );
}

export function codeOf(e: unknown): ErrorCode {
  if (e instanceof ServiceError) return e.code;
  if (e instanceof PrfUnsupported) return "PRF_UNSUPPORTED";
  if (e instanceof WebAuthnUnsupported) return "UNSUPPORTED_CREDENTIAL";
  if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) {
    return "USER_CANCELLED";
  }
  return "INTERNAL_ERROR";
}
