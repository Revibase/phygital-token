/**
 * The Revibase app ↔ secure-signer postMessage protocol.
 *
 * Trust model: the signer iframe is the trust boundary; the host (web app) is
 * treated as possibly XSS-compromised. The signer strictly validates every
 * inbound message (its `validateInbound`, fail-closed) and posts only to the
 * expected parent origin; the host accepts messages only from the signer
 * origin and its own iframe. Secrets (PRF output, seed) never cross.
 *
 * Host → signer:  a `SignerRequest` (`protocolVersion`, random `requestId`,
 *                 `timestamp` for freshness/replay).
 * Signer → host:  the matching result (`RESULT_TYPE[request.type]`) or an
 *                 `ErrorMessage` for that `requestId`, plus frame lifecycle
 *                 messages (`SIGNER_READY`, `SIGNER_HEIGHT`).
 */

/** Requests with any other value fail closed (`UNSUPPORTED_PROTOCOL`). */
export const PROTOCOL_VERSION = 1 as const;

/** Max serialized inbound message (JSON string bytes); larger fails `INVALID_MESSAGE`. */
export const MAX_MESSAGE_BYTES = 16 * 1024;
/** Max serialized transaction (legacy and v0 fit in 1232 bytes). */
export const MAX_TX_BYTES = 4096;
/** Max message for `SIGN_MESSAGE` (UTF-8 bytes). */
export const MAX_SIGN_MESSAGE_BYTES = 2048;
/** `requestId` the signer accepts (the host sends 32 random hex chars). */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** Codes the signer returns in `ErrorMessage.code` (a runtime list, so hosts can check coverage). */
export const SIGNER_ERROR_CODES = [
  "INVALID_MESSAGE",
  "UNSUPPORTED_PROTOCOL",
  "UNSUPPORTED_VERSION",
  "MALFORMED_TRANSACTION",
  "INVALID_WALLET_BLOB",
  "UNSUPPORTED_CREDENTIAL",
  "POLICY_REJECTED",
  "USER_CANCELLED",
  "AUTHENTICATION_FAILED",
  "DECRYPTION_FAILED",
  "WALLET_MISMATCH",
  "REPLAY_REJECTED",
  "INTERNAL_ERROR",
  "BLOB_UNAVAILABLE",
  /** Another request is still active in this frame (e.g. abandoned by the host). */
  "SIGNER_BUSY",
  /** The passkey picked for a restore has no backup here (e.g. another app's passkey). */
  "NOT_FOUND",
  /** This browser or authenticator can't do WebAuthn PRF. */
  "PRF_UNSUPPORTED",
] as const;
export type SignerErrorCode = (typeof SIGNER_ERROR_CODES)[number];

/** Codes only the host produces (the frame never answered). */
export const HOST_ERROR_CODES = ["TIMEOUT", "SIGNER_UNAVAILABLE"] as const;
export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];

export const REQUEST_TYPES = [
  "SIGN_TRANSACTION",
  "SIGN_MESSAGE",
  "EXPORT_PRIVATE_KEY",
  "AUTH_START",
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/** The result message type answering each request type. */
export const RESULT_TYPE = {
  SIGN_TRANSACTION: "SIGN_TRANSACTION_RESULT",
  SIGN_MESSAGE: "SIGN_MESSAGE_RESULT",
  EXPORT_PRIVATE_KEY: "EXPORT_PRIVATE_KEY_RESULT",
  AUTH_START: "AUTH_COMPLETE",
} as const satisfies Record<RequestType, string>;

interface RequestCommon {
  protocolVersion: number;
  requestId: string;
  timestamp: number;
}

/** A validated host → signer request (extra keys are rejected by the signer). */
export type SignerRequest = RequestCommon &
  (
    | {
        type: "SIGN_TRANSACTION";
        /** base64 (standard) serialized legacy or v0 transaction. */
        transaction: string;
      }
    | {
        type: "SIGN_MESSAGE";
        /** base64 (standard) UTF-8 text: the app's sign-in message. */
        message: string;
      }
    | { type: "EXPORT_PRIVATE_KEY" }
    | {
        type: "AUTH_START";
        authMode?: "create" | "unlock";
        /** create: base64url credential id of the passkey the host just registered. */
        credentialId?: string;
        /** create: base64url attestationObject of that registration. */
        webauthnAttestationObject?: string;
      }
  );

/** Payload of each result, keyed by request type (sent as `{ type, requestId, ...payload }`). */
export type ResultPayload = {
  AUTH_START: { publicKey: string; created: boolean };
  /** `signature`: base64 (standard) 64-byte ed25519 signature over the exact message bytes. */
  SIGN_TRANSACTION: { signature: string; publicKey: string };
  /** `signature`: base64 (standard) 64-byte ed25519 signature over the message bytes. */
  SIGN_MESSAGE: { signature: string; publicKey: string };
  /** The secret is shown inside the frame only; the host learns nothing else. */
  EXPORT_PRIVATE_KEY: { completed: true };
};
export type ErrorMessage = {
  type: "ERROR";
  protocolVersion: typeof PROTOCOL_VERSION;
  /** Absent when the request id itself was missing or invalid. */
  requestId?: string;
  code: SignerErrorCode;
};

/** Sent once the frame has booted and is listening. */
export type SignerReadyMessage = { type: "SIGNER_READY"; protocolVersion: typeof PROTOCOL_VERSION };
/** Content height, so the host can size the iframe. */
export type SignerHeightMessage = { type: "SIGNER_HEIGHT"; height: number };
