/**
 * SIGN_TRANSACTION: decode, check the policy, show the confirm screen, then sign
 * exactly the reviewed message bytes once.
 */
import type { ResultPayload } from "../shared/protocol.js";
import { readLocalBlob } from "../storage/blob-store.js";
import { MAX_TX_BYTES } from "../constants.js";
import { base64ToBytes, bytesToBase64 } from "../encoding.js";
import { RESULT_TYPE } from "../messaging/protocol.js";
import { digestHex } from "../messaging/state.js";
import { decodeTransaction } from "../tx/decode.js";
import { evaluatePolicy, previewPolicy } from "../tx/policy.js";
import { decryptWallet, signAndScrub } from "../keys/wallet-service.js";
import { type SignerContext } from "./context.js";
import { promptDismissed } from "./errors.js";
import { finishRestore, mintRestoreChallenge } from "./restore.js";

export async function handleSign(
  ctx: SignerContext,
  requestId: string,
  rpId: string,
  txB64: string,
): Promise<void> {
  const { prf, ui, state, store, now, toBase58Pubkey, withFeePayers, beginBusy, fail, ok } = ctx;
  ui.setCeremonyBusy("Reviewing transaction…");

  let tx;
  try {
    tx = decodeTransaction(base64ToBytes(txB64, MAX_TX_BYTES, "std"));
  } catch {
    return fail(requestId, "MALFORMED_TRANSACTION");
  }

  const frozen = tx.messageBytes.slice();
  const digest = await digestHex(frozen);
  const local = await readLocalBlob(store);

  let seed: Uint8Array;
  let publicKey: Uint8Array;

  if (local) {
    const policy = evaluatePolicy(tx, local.parsed.publicKey);
    if (!policy.ok) return fail(requestId, policy.code);

    const choice = await ui.confirmSignTransaction(await withFeePayers(policy.summary), () => {
      const unlocked = decryptWallet(prf, rpId, local.parsed);
      const busy = beginBusy(requestId, "Use Face ID or Touch ID to approve", {
        deferUi: true,
      });
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
    const preview = previewPolicy(tx);
    if (!preview.ok) return fail(requestId, preview.code);

    const minted = await mintRestoreChallenge(ctx);
    if (!minted) return fail(requestId, "BLOB_UNAVAILABLE");

    const choice = await ui.confirmSignTransaction(await withFeePayers(preview.summary), () => {
      const disc = prf.getDiscoverable(rpId, minted.fetchChallengeBytes);
      const busy = beginBusy(requestId, "Use Face ID or Touch ID to approve", {
        deferUi: true,
      });
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

    const policy = evaluatePolicy(tx, restored.publicKey);
    if (!policy.ok) {
      restored.seed.fill(0);
      return fail(requestId, policy.code);
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
      messageDigest: await digestHex(frozen),
    });
    if (!auth) {
      seed.fill(0);
      return fail(requestId, "INTERNAL_ERROR");
    }

    const signature = await signAndScrub(frozen, seed);

    ok(requestId, RESULT_TYPE.SIGN_TRANSACTION, {
      signature: bytesToBase64(signature, "std"),
      publicKey: toBase58Pubkey(publicKey),
    } satisfies ResultPayload["SIGN_TRANSACTION"]);
  } catch (e) {
    seed.fill(0);
    throw e;
  }
}
