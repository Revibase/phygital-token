/**
 * Restoring the wallet blob from the backup API with a discoverable passkey,
 * used when this device has no local blob.
 */
import { writeLocalBlob } from "../storage/blob-store.js";
import { base64ToBytes, bytesEqual } from "../encoding.js";
import { parseBlob, ServiceError, unwrapWallet } from "../keys/wallet-service.js";
import type { ParsedWalletBlob } from "../keys/wallet-format.js";
import { type SignerContext, type Busy } from "./context.js";
import type { SignerPrf } from "../deps.js";

export async function mintRestoreChallenge(ctx: SignerContext): Promise<{
  restore: { challengeId: string; challenge: string };
  fetchChallengeBytes: Uint8Array;
} | null> {
  const { api } = ctx;
  try {
    const restore = await api.issueRestoreChallenge();
    return {
      restore,
      fetchChallengeBytes: base64ToBytes(restore.challenge, 64, "url"),
    };
  } catch {
    return null;
  }
}

export async function finishRestore(
  ctx: SignerContext,
  opts: {
    requestId: string;
    rpId: string;
    restore: { challengeId: string; challenge: string };
    disc: ReturnType<SignerPrf["getDiscoverable"]>;
    busy: Busy;
  },
): Promise<
  | {
      raw: Uint8Array;
      parsed: ParsedWalletBlob;
      seed: Uint8Array;
      publicKey: Uint8Array;
    }
  | "failed"
  | "dismissed"
> {
  const { api, store, fail } = ctx;
  let disc;
  try {
    disc = await opts.disc;
    if (opts.busy.wasDismissed()) return "dismissed";

    let restored;
    try {
      restored = await api.restoreWalletBlob({
        challengeId: opts.restore.challengeId,
        assertion: disc.assertion,
      });
    } catch {
      disc.prfOutput.fill(0);
      fail(opts.requestId, "BLOB_UNAVAILABLE");
      return "failed";
    }
    if (!restored) {
      disc.prfOutput.fill(0);
      fail(opts.requestId, "NOT_FOUND");
      return "failed";
    }

    const raw = base64ToBytes(restored.encryptedWalletBlob, 1024, "url");
    const parsed = parseBlob(raw);
    if (!bytesEqual(parsed.credentialId, disc.credentialId)) {
      disc.prfOutput.fill(0);
      fail(opts.requestId, "WALLET_MISMATCH");
      return "failed";
    }
    const { seed, publicKey } = await unwrapWallet(disc.prfOutput, parsed, opts.rpId);
    disc.prfOutput.fill(0);
    if (!(await writeLocalBlob(raw, store))) {
      seed.fill(0);
      fail(opts.requestId, "INTERNAL_ERROR");
      return "failed";
    }
    return { raw, parsed, seed, publicKey };
  } catch (e) {
    if (disc) disc.prfOutput.fill(0);
    if (opts.busy.wasDismissed()) return "dismissed";
    if (e instanceof ServiceError) {
      fail(opts.requestId, e.code);
      return "failed";
    }
    throw e;
  } finally {
    opts.busy.clear();
  }
}
