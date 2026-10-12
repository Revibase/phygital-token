/**
 * HTTP contract of the passkey-wallet backup routes on the app worker
 * (`portal.revibase.com/api/signer/*`), used by the secure-signer.
 * Every error response is `{ error, code }` with a non-2xx status.
 */

/** A single-use server challenge (32 random bytes, base64url). */
export type ChallengeResponse = { challengeId: string; challenge: string };

export type WalletBlobRestoreRequest = { challengeId: string; assertion: Record<string, unknown> };
export type WalletBlobRestoreResponse = {
  /** base64url RSS1 blob (see ./wallet-blob). */
  encryptedWalletBlob: string;
  publicKey: string;
};

/** `signature`: base64url ed25519 over `challengeMessage(PUT_CHALLENGE_PREFIX, challenge)`. */
export type WalletBlobPutRequest = {
  encryptedWalletBlob: string;
  publicKey: string;
  challengeId: string;
  signature: string;
  /** Required on first backup: binds the COSE key to the blob's credential. */
  webauthnAttestationObject?: string;
};
export type WalletBlobPutResponse = { ok: true; created: boolean };

export const SIGNER_API_ROUTES = {
  backupChallenge: "/api/signer/backup-challenge",
  restoreChallenge: "/api/signer/restore-challenge",
  restore: "/api/signer/restore",
  blob: "/api/signer/blob",
} as const;
