/**
 * Centralized, security-critical constants for the signer.
 *
 * WHY a single obvious file: every value that defines the trust boundary
 * — the parent origin we accept, the fixed crypto parameters a swapped wallet
 * blob must NOT be able to steer, the allowed programs, and the hard size
 * caps applied BEFORE any expensive parsing — lives here so it can be
 * audited at a glance. Nothing here is attacker-controllable.
 */

import { PUT_CHALLENGE_PREFIX } from "./shared/challenges.js";
import {
  BLOB_MAGIC,
  BLOB_VERSION,
  MAX_BLOB_BYTES,
  MAX_CREDENTIAL_ID_BYTES,
} from "./shared/wallet-blob.js";
import { resolveWebAuthnRpId } from "./shared/webauthn.js";
import { MAX_MESSAGE_BYTES, MAX_TX_BYTES, PROTOCOL_VERSION } from "./shared/protocol.js";

/** postMessage protocol version. Requests with any other value fail closed. */
export { PROTOCOL_VERSION };

/**
 * The ONLY origin we accept postMessage requests from, and the only origin we
 * post results to. Never `"*"`. Set at build time via VITE_PARENT_ORIGIN.
 *
 * NOTE: matching this origin does NOT prove a request is benign — an XSS
 * attacker running on the legitimate parent has the legitimate origin. It is a
 * necessary filter, not the authorization mechanism.
 */
export const EXPECTED_PARENT_ORIGIN: string =
  (import.meta.env?.VITE_PARENT_ORIGIN as string | undefined) ?? "http://localhost:5173";

/** WebAuthn RP ID shared with the app: create runs there, get + PRF here. */
export const resolveRpId: (hostname: string, envRpId?: string) => string = resolveWebAuthnRpId;

export const RP_ID: string = resolveRpId(
  typeof globalThis !== "undefined" && "location" in globalThis
    ? ((globalThis as { location?: { hostname: string } }).location?.hostname ?? "localhost")
    : "localhost",
  import.meta.env?.VITE_RP_ID as string | undefined,
);

// ---------------------------------------------------------------------------
// Fixed cryptographic parameters (IMPLEMENTATION-FIXED, never from the blob).
// A portable wallet blob authenticates these via AAD but does NOT carry them,
// so a malicious parent cannot swap in a different PRF salt / KDF / algorithm
// to coax unexpected decryption behavior.
// ---------------------------------------------------------------------------

/**
 * Preimage of `PRF_SALT`. Never change — existing wallets cannot unwrap.
 * Distinct from the Revibase authority signer, which shares the RP ID.
 */
export const PRF_INPUT_LABEL = "revibase.secure-signer:prf:v1" as const;
/**
 * SHA-256(`PRF_INPUT_LABEL`), baked so `credentials.get()` is never preceded
 * by a digest await (transient user activation).
 */
export const PRF_SALT = Uint8Array.from([
  218, 235, 16, 56, 95, 80, 198, 100, 233, 28, 45, 130, 158, 8, 91, 246, 222, 224, 30, 41, 103, 27,
  154, 147, 96, 7, 161, 93, 110, 167, 118, 73,
]);
/** HKDF-SHA256 `info` binding the derived key to this application + purpose. */
export const HKDF_INFO_LABEL = "revibase.secure-signer:wrap:v1" as const;
/** UTF-8 of `HKDF_INFO_LABEL` — ready for HKDF + AAD, no encode on the wrap path. */
export const HKDF_INFO = new TextEncoder().encode(HKDF_INFO_LABEL);
/** HKDF output / AES key length in bits. */
export const AES_KEY_BITS = 256 as const;
/** AES-GCM IV length in bytes (96-bit, the GCM standard). */
export const AES_GCM_IV_BYTES = 12 as const;
/** AES-GCM authentication tag length in bits. */
export const AES_GCM_TAG_BITS = 128 as const;
/** Ed25519 private seed length in bytes. */
export const ED25519_SEED_BYTES = 32 as const;
/** Ed25519 public key length in bytes. */
export const ED25519_PUBKEY_BYTES = 32 as const;
/** HKDF salt length used inside the blob (random per wallet). */
export const KDF_SALT_BYTES = 32 as const;

/** Domain prefix for the ed25519 proof of possession on a backup PUT. */
export { PUT_CHALLENGE_PREFIX };

// ---------------------------------------------------------------------------
// Portable wallet blob format.
// ---------------------------------------------------------------------------

/** RSS1 magic and the only supported version (unknown versions fail closed). */
export { BLOB_MAGIC, BLOB_VERSION };

// ---------------------------------------------------------------------------
// Hard size caps — applied BEFORE parsing. Values are deliberately tight.
// ---------------------------------------------------------------------------

/** Max total size of an inbound postMessage payload (JSON string bytes). */
export { MAX_MESSAGE_BYTES };
/** Max encoded wallet-blob size and credential id length (contract: wallet-blob). */
export { MAX_BLOB_BYTES, MAX_CREDENTIAL_ID_BYTES };
/** Max serialized transaction size (v1 allows 4096 bytes). */
export { MAX_TX_BYTES };

// ---------------------------------------------------------------------------
// Freshness / replay.
// ---------------------------------------------------------------------------

/** Requests older than this (by client `timestamp`) are rejected as stale. */
export const REQUEST_FRESHNESS_WINDOW_MS = 60_000;
/**
 * Most request ids held for duplicate detection. Ids are kept while their
 * timestamp is fresh; past this many fresh ids, new requests get SIGNER_BUSY.
 */
export const SEEN_REQUEST_IDS_LIMIT = 512;
