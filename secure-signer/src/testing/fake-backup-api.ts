/**
 * In-memory stand-in for the app worker's passkey-wallet backup API, for
 * dispatcher tests.
 *
 * It keeps the contract's shape (single-use challenges, blob keyed by
 * credential id, 404 → null) and records every request body so tests can scan
 * for leaks and check the ed25519 PUT proof. Server-side verification itself
 * (WebAuthn assertion, attestation binding) is exercised against the real API
 * in the integration suites, not re-implemented here.
 */

import type { BackupApi } from "../dispatcher.js";
import { MAX_BLOB_BYTES, PUT_CHALLENGE_PREFIX } from "../constants.js";
import { ed25519Verify, randomBytes } from "../crypto.js";
import { base64ToBytes, bytesToBase64, utf8ToBytes } from "../encoding.js";
import { decodeWalletBlob } from "../wallet-format.js";

type Challenge = { challengeId: string; challenge: string };
type PutParams = Parameters<BackupApi["backupWalletBlob"]>[0];

export type BackupCall =
  | { op: "issueBackupChallenge" }
  | { op: "issueRestoreChallenge" }
  | { op: "restore"; body: { challengeId: string; assertion: Record<string, unknown> } }
  | { op: "put"; body: PutParams; proofValid: boolean };

export class FakeBackupApi implements BackupApi {
  readonly calls: BackupCall[] = [];
  /** Stored ciphertext keyed by base64url credential id. */
  readonly blobs = new Map<string, { encryptedWalletBlob: string; publicKey: string }>();
  /** One-shot failures (thrown as `Error(code)`, like the real client). */
  readonly failNext: {
    issueBackupChallenge?: string;
    issueRestoreChallenge?: string;
    restore?: string;
    put?: string;
  } = {};
  /** Force the next restore response (e.g. a blob for another credential). */
  restoreOverride: { encryptedWalletBlob: string; publicKey: string } | null | undefined;
  /** Return a challenge that is not valid base64url on the next issue of this kind. */
  malformedNext: "backup" | "restore" | null = null;

  private readonly backupChallenges = new Map<string, Uint8Array>();
  private readonly restoreChallenges = new Set<string>();
  private n = 0;

  async issueBackupChallenge(): Promise<Challenge> {
    this.calls.push({ op: "issueBackupChallenge" });
    this.takeFailure("issueBackupChallenge");
    const challengeId = `backup-${++this.n}`;
    const challenge = randomBytes(32);
    this.backupChallenges.set(challengeId, challenge);
    if (this.malformedNext === "backup") {
      this.malformedNext = null;
      return { challengeId, challenge: "@@not-base64url@@" };
    }
    return { challengeId, challenge: bytesToBase64(challenge, "url") };
  }

  async issueRestoreChallenge(): Promise<Challenge> {
    this.calls.push({ op: "issueRestoreChallenge" });
    this.takeFailure("issueRestoreChallenge");
    const challengeId = `restore-${++this.n}`;
    this.restoreChallenges.add(challengeId);
    if (this.malformedNext === "restore") {
      this.malformedNext = null;
      return { challengeId, challenge: "@@not-base64url@@" };
    }
    return { challengeId, challenge: bytesToBase64(randomBytes(32), "url") };
  }

  async restoreWalletBlob(params: {
    challengeId: string;
    assertion: Record<string, unknown>;
  }): Promise<{ encryptedWalletBlob: string; publicKey: string } | null> {
    this.calls.push({ op: "restore", body: params });
    this.takeFailure("restore");
    if (!this.restoreChallenges.delete(params.challengeId)) {
      throw new Error("challenge_invalid");
    }
    if (this.restoreOverride !== undefined) {
      const forced = this.restoreOverride;
      this.restoreOverride = undefined;
      return forced;
    }
    const rawId = String(params.assertion["rawId"] ?? "");
    return this.blobs.get(rawId) ?? null;
  }

  async backupWalletBlob(params: PutParams): Promise<void> {
    const blob = decodeWalletBlob(
      base64ToBytes(params.encryptedWalletBlob, MAX_BLOB_BYTES, "url"),
    );
    const challenge = this.backupChallenges.get(params.challengeId);
    this.backupChallenges.delete(params.challengeId);
    let proofValid = false;
    if (challenge) {
      const prefix = utf8ToBytes(PUT_CHALLENGE_PREFIX);
      const message = new Uint8Array(prefix.length + challenge.length);
      message.set(prefix, 0);
      message.set(challenge, prefix.length);
      proofValid = await ed25519Verify(
        base64ToBytes(params.signature, 64, "url"),
        message,
        blob.publicKey,
      );
    }
    this.calls.push({ op: "put", body: params, proofValid });
    this.takeFailure("put");
    if (!proofValid) throw new Error("invalid_proof");
    this.blobs.set(bytesToBase64(blob.credentialId, "url"), {
      encryptedWalletBlob: params.encryptedWalletBlob,
      publicKey: params.publicKey,
    });
  }

  puts(): Array<Extract<BackupCall, { op: "put" }>> {
    return this.calls.filter((c): c is Extract<BackupCall, { op: "put" }> => c.op === "put");
  }

  private takeFailure(op: keyof FakeBackupApi["failNext"]): void {
    const code = this.failNext[op];
    if (code === undefined) return;
    delete this.failNext[op];
    throw new Error(code);
  }
}
