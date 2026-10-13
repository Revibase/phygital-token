/** SIGN_MESSAGE: only the parent site's sign-in message, for this wallet. */
import type { ResultPayload } from "../shared/protocol.js";
import { readLocalBlob } from "../storage/blob-store.js";
import { MAX_SIGN_MESSAGE_BYTES } from "../shared/protocol.js";
import { base64ToBytes, bytesToBase64 } from "../encoding.js";
import { RESULT_TYPE } from "../messaging/protocol.js";
import { digestHex } from "../messaging/state.js";
import { decryptWallet, signAndScrub } from "../keys/wallet-service.js";
import { type SignerContext } from "./context.js";
import { promptDismissed } from "./errors.js";
import { finishRestore, mintRestoreChallenge } from "./restore.js";

/**
 * The app's sign-in message, and nothing else: line 1 must name the parent
 * site and line 2 must be this wallet's address, so the signature can't be
 * replayed as a sign-in to another site or for another account.
 */
export function signInMessageProblem(
  ctx: SignerContext,
  text: string,
  walletAddress: string | null,
): boolean {
  const { deps } = ctx;
  const [first, second] = text.split("\n");
  const host = new URL(deps.parentOrigin).host;
  if (first !== `${host} wants you to sign in with your Solana account:`) return true;
  return walletAddress !== null && second !== walletAddress;
}

export async function handleSignMessage(
  ctx: SignerContext,
  requestId: string,
  rpId: string,
  messageB64: string,
): Promise<void> {
  const { deps, prf, ui, state, store, now, toBase58Pubkey, beginBusy, fail, ok } = ctx;
  let message: Uint8Array;
  let text: string;
  try {
    message = base64ToBytes(messageB64, MAX_SIGN_MESSAGE_BYTES, "std");
    text = new TextDecoder("utf-8", { fatal: true }).decode(message);
  } catch {
    return fail(requestId, "INVALID_MESSAGE");
  }
  const site = new URL(deps.parentOrigin).host;
  const digest = await digestHex(message);
  const local = await readLocalBlob(store);

  let seed: Uint8Array;
  let publicKey: Uint8Array;

  if (local) {
    if (signInMessageProblem(ctx, text, toBase58Pubkey(local.parsed.publicKey))) {
      return fail(requestId, "POLICY_REJECTED");
    }
    const choice = await ui.confirmSignMessage(text, site, () => {
      const unlocked = decryptWallet(prf, rpId, local.parsed);
      const busy = beginBusy(requestId, "Use Face ID or Touch ID to approve", { deferUi: true });
      return { busy, unlocked };
    });
    if (!choice.ok) return fail(requestId, "USER_CANCELLED");
    state.authorize({
      operation: "SIGN_PENDING",
      requestId,
      walletPublicKey: local.parsed.publicKey,
      messageDigest: digest,
      createdAt: now(),
    });
    const { busy, unlocked } = choice.started;
    try {
      const result = await unlocked;
      if (busy.wasDismissed()) {
        result.seed.fill(0);
        return;
      }
      seed = result.seed;
      publicKey = result.publicKey;
    } catch (e) {
      if (busy.wasDismissed()) return;
      if (promptDismissed(e)) return fail(requestId, "USER_CANCELLED");
      throw e;
    } finally {
      busy.clear();
    }
  } else {
    if (signInMessageProblem(ctx, text, null)) return fail(requestId, "POLICY_REJECTED");
    const minted = await mintRestoreChallenge(ctx);
    if (!minted) return fail(requestId, "BLOB_UNAVAILABLE");
    const choice = await ui.confirmSignMessage(text, site, () => {
      const disc = prf.getDiscoverable(rpId, minted.fetchChallengeBytes);
      const busy = beginBusy(requestId, "Use Face ID or Touch ID to approve", { deferUi: true });
      return { busy, disc };
    });
    if (!choice.ok) return fail(requestId, "USER_CANCELLED");
    const restored = await finishRestore(ctx, {
      requestId,
      rpId,
      restore: minted.restore,
      disc: choice.started.disc,
      busy: choice.started.busy,
    });
    if (restored === "failed" || restored === "dismissed") return;
    if (signInMessageProblem(ctx, text, toBase58Pubkey(restored.publicKey))) {
      restored.seed.fill(0);
      return fail(requestId, "POLICY_REJECTED");
    }
    state.authorize({
      operation: "SIGN_PENDING",
      requestId,
      walletPublicKey: restored.publicKey,
      messageDigest: digest,
      createdAt: now(),
    });
    seed = restored.seed;
    publicKey = restored.publicKey;
  }

  try {
    const auth = state.consumeAuthorization({
      operation: "SIGN_PENDING",
      requestId,
      messageDigest: await digestHex(message),
    });
    if (!auth) {
      seed.fill(0);
      return fail(requestId, "INTERNAL_ERROR");
    }
    const signature = await signAndScrub(message, seed);
    ok(requestId, RESULT_TYPE.SIGN_MESSAGE, {
      signature: bytesToBase64(signature, "std"),
      publicKey: toBase58Pubkey(publicKey),
    } satisfies ResultPayload["SIGN_MESSAGE"]);
  } catch (e) {
    seed.fill(0);
    throw e;
  }
}
