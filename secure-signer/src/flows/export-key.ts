/** EXPORT_PRIVATE_KEY: reveal the secret key on the trusted screen, after a passkey check. */
import type { ResultPayload } from "../shared/protocol.js";
import { readLocalBlob } from "../storage/blob-store.js";
import { RESULT_TYPE } from "../messaging/protocol.js";
import { decryptWallet } from "../keys/wallet-service.js";
import { type SignerContext } from "./context.js";
import { promptDismissed } from "./errors.js";
import { finishRestore, mintRestoreChallenge } from "./restore.js";

export async function handleExportPrivateKey(
  ctx: SignerContext,
  requestId: string,
  rpId: string,
): Promise<void> {
  const { prf, ui, store, b58, toBase58Pubkey, beginBusy, fail, ok } = ctx;
  const local = await readLocalBlob(store);
  let seed: Uint8Array;
  let publicKey: Uint8Array;

  if (local) {
    const choice = await ui.confirmExportPrivateKey(() => {
      const unlocked = decryptWallet(prf, rpId, local.parsed);
      const busy = beginBusy(requestId, "Use Face ID or Touch ID to approve", {
        deferUi: true,
      });
      return { busy, unlocked };
    });
    if (!choice.ok) return fail(requestId, "USER_CANCELLED");

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
    const minted = await mintRestoreChallenge(ctx);
    if (!minted) return fail(requestId, "BLOB_UNAVAILABLE");

    const choice = await ui.confirmExportPrivateKey(() => {
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
    seed = restored.seed;
    publicKey = restored.publicKey;
  }

  try {
    const secret = new Uint8Array(64);
    secret.set(seed, 0);
    secret.set(publicKey, 32);
    const secretB58 = b58.decode(secret);
    seed.fill(0);
    secret.fill(0);
    await ui.showExportedSecret(secretB58, toBase58Pubkey(publicKey));
    ok(requestId, RESULT_TYPE.EXPORT_PRIVATE_KEY, {
      completed: true,
    } satisfies ResultPayload["EXPORT_PRIVATE_KEY"]);
  } catch (e) {
    seed.fill(0);
    throw e;
  }
}
