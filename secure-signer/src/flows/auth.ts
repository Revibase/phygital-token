/**
 * AUTH_START: create a wallet for a new passkey, unlock the local blob, or
 * restore it from backup. Each path ends with an authenticated backup PUT.
 */
import type { ResultPayload } from "../shared/protocol.js";
import { readLocalBlob, writeLocalBlob } from "../storage/blob-store.js";
import { MAX_CREDENTIAL_ID_BYTES, PUT_CHALLENGE_PREFIX } from "../constants.js";
import { base64ToBytes, bytesEqual, bytesToBase64 } from "../encoding.js";
import { RESULT_TYPE } from "../messaging/protocol.js";
import { PrfUnsupported } from "../keys/webauthn.js";
import {
  decryptWallet,
  enrollExistingCredential,
  parseBlob,
  ServiceError,
  unwrapWallet,
} from "../keys/wallet-service.js";
import type { ParsedWalletBlob } from "../keys/wallet-format.js";
import { type SignerContext } from "./context.js";
import { codeOf } from "./errors.js";

export async function pushBackup(
  ctx: SignerContext,
  opts: {
    encryptedWalletBlob: string;
    publicKey: string;
    putChallengeId: string;
    putSignature: string;
    webauthnAttestationObject?: string;
  },
): Promise<void> {
  const { api } = ctx;
  await api.backupWalletBlob({
    encryptedWalletBlob: opts.encryptedWalletBlob,
    publicKey: opts.publicKey,
    challengeId: opts.putChallengeId,
    signature: opts.putSignature,
    ...(opts.webauthnAttestationObject
      ? { webauthnAttestationObject: opts.webauthnAttestationObject }
      : {}),
  });
}

export async function mintBackupChallenge(ctx: SignerContext): Promise<{
  challengeId: string;
  challenge: string;
}> {
  const { api } = ctx;
  try {
    return await api.issueBackupChallenge();
  } catch {
    throw new ServiceError("BLOB_UNAVAILABLE");
  }
}

export async function handleCreate(
  ctx: SignerContext,
  opts: {
    requestId: string;
    credentialIdB64: string;
    webauthnAttestationObject: string;
  },
): Promise<void> {
  const { deps, prf, ui, store, toBase58Pubkey, prefixedChallengeMessage, beginBusy, fail, ok } =
    ctx;
  let credentialId: Uint8Array;
  try {
    credentialId = base64ToBytes(opts.credentialIdB64, MAX_CREDENTIAL_ID_BYTES, "url");
  } catch {
    return fail(opts.requestId, "INVALID_MESSAGE");
  }

  // Mint in parallel with the confirm tap — do not await fetch before WebAuthn.
  const challengePromise = mintBackupChallenge(ctx);
  // Awaited only after the ceremony (or never, on cancel): mark it handled
  // so an early failure isn't an unhandled rejection. Awaiting still throws.
  challengePromise.catch(() => {});
  const choice = await ui.confirmFinishCreate(() => {
    const enrolled = enrollExistingCredential(prf, deps.rpId(), credentialId, {
      messageToSign: challengePromise.then(({ challenge }) => {
        try {
          return prefixedChallengeMessage(
            PUT_CHALLENGE_PREFIX,
            base64ToBytes(challenge, 64, "url"),
          );
        } catch {
          throw new ServiceError("INVALID_MESSAGE");
        }
      }),
    });
    const busy = beginBusy(opts.requestId, "Confirm on this phone to finish setup…", {
      deferUi: true,
    });
    return { busy, enrolled };
  });
  if (!choice.ok) return fail(opts.requestId, "USER_CANCELLED");

  const { busy, enrolled } = choice.started;
  try {
    const created = await enrolled;
    if (busy.wasDismissed()) return;
    if (!created.signature) return fail(opts.requestId, "INTERNAL_ERROR");

    const { challengeId } = await challengePromise;

    const pk = toBase58Pubkey(created.publicKey);
    const blobB64 = bytesToBase64(created.blob, "url");
    try {
      await pushBackup(ctx, {
        encryptedWalletBlob: blobB64,
        publicKey: pk,
        putChallengeId: challengeId,
        putSignature: bytesToBase64(created.signature, "url"),
        webauthnAttestationObject: opts.webauthnAttestationObject,
      });
    } catch {
      return fail(opts.requestId, "BLOB_UNAVAILABLE");
    }
    if (!(await writeLocalBlob(created.blob, store))) {
      return fail(opts.requestId, "INTERNAL_ERROR");
    }
    ok(opts.requestId, RESULT_TYPE.AUTH_START, {
      publicKey: pk,
      created: true,
    } satisfies ResultPayload["AUTH_START"]);
  } catch (e) {
    if (busy.wasDismissed()) return;
    const code = codeOf(e);
    if (code === "PRF_UNSUPPORTED") return fail(opts.requestId, code);
    if (
      code === "AUTHENTICATION_FAILED" ||
      code === "UNSUPPORTED_CREDENTIAL" ||
      code === "USER_CANCELLED"
    ) {
      const again = await ui.showRecoverable(
        "Confirmation didn’t work. Try again, or cancel and start over.",
      );
      if (again === "retry") {
        busy.clear();
        return handleCreate(ctx, opts);
      }
      return fail(opts.requestId, "USER_CANCELLED");
    }
    throw e;
  } finally {
    busy.clear();
  }
}

export async function handleLocalUnlock(
  ctx: SignerContext,
  opts: {
    requestId: string;
    rpId: string;
    raw: Uint8Array;
    parsed: ParsedWalletBlob;
  },
): Promise<void> {
  const { prf, ui, store, toBase58Pubkey, signChallenge, beginBusy, fail, ok } = ctx;
  const challengePromise = mintBackupChallenge(ctx);
  challengePromise.catch(() => {}); // see handleCreate
  const choice = await ui.confirmImport(() => {
    const unlocked = decryptWallet(prf, opts.rpId, opts.parsed);
    const busy = beginBusy(opts.requestId, "Use Face ID or Touch ID to approve", {
      deferUi: true,
    });
    return { busy, unlocked };
  });
  if (!choice.ok) return fail(opts.requestId, "USER_CANCELLED");

  const { busy, unlocked } = choice.started;
  try {
    const { seed, publicKey } = await unlocked;
    if (busy.wasDismissed()) {
      seed.fill(0);
      return;
    }
    const { challengeId, challenge } = await challengePromise;
    const putSignature = await signChallenge(challenge, seed, PUT_CHALLENGE_PREFIX);
    if (!putSignature) {
      seed.fill(0);
      return fail(opts.requestId, "INTERNAL_ERROR");
    }

    const pk = toBase58Pubkey(publicKey);
    try {
      await pushBackup(ctx, {
        encryptedWalletBlob: bytesToBase64(opts.raw, "url"),
        publicKey: pk,
        putChallengeId: challengeId,
        putSignature,
      });
    } catch {
      seed.fill(0);
      return fail(opts.requestId, "BLOB_UNAVAILABLE");
    }

    seed.fill(0);
    if (!(await writeLocalBlob(opts.raw, store))) {
      return fail(opts.requestId, "INTERNAL_ERROR");
    }
    ok(opts.requestId, RESULT_TYPE.AUTH_START, {
      publicKey: pk,
      created: false,
    } satisfies ResultPayload["AUTH_START"]);
  } catch (e) {
    if (busy.wasDismissed()) return;
    const code = codeOf(e);
    if (code === "PRF_UNSUPPORTED") return fail(opts.requestId, code);
    if (code === "AUTHENTICATION_FAILED" || code === "DECRYPTION_FAILED") {
      const again = await ui.showRecoverable(
        "Unlock didn’t work. Try again, or cancel if this wallet was removed from this phone.",
      );
      if (again === "retry") {
        return handleLocalUnlock(ctx, opts);
      }
      return fail(opts.requestId, "AUTHENTICATION_FAILED");
    }
    throw e;
  } finally {
    busy.clear();
  }
}

export async function handleRemoteUnlock(
  ctx: SignerContext,
  opts: { requestId: string; rpId: string },
): Promise<void> {
  const { prf, ui, api, store, toBase58Pubkey, signChallenge, beginBusy, fail, ok } = ctx;
  // Restore challenge is the WebAuthn challenge — mint before the confirm tap
  // so `getDiscoverable` can start in the click handler.
  let restore: { challengeId: string; challenge: string };
  let backup: { challengeId: string; challenge: string };
  try {
    [restore, backup] = await Promise.all([
      api.issueRestoreChallenge(),
      api.issueBackupChallenge(),
    ]);
  } catch {
    return fail(opts.requestId, "BLOB_UNAVAILABLE");
  }

  let fetchChallengeBytes: Uint8Array;
  try {
    fetchChallengeBytes = base64ToBytes(restore.challenge, 64, "url");
  } catch {
    return fail(opts.requestId, "INVALID_MESSAGE");
  }

  const choice = await ui.confirmImport(() => {
    const disc = prf.getDiscoverable(opts.rpId, fetchChallengeBytes);
    const busy = beginBusy(opts.requestId, "Use Face ID or Touch ID to approve", {
      deferUi: true,
    });
    return { busy, disc };
  });
  if (!choice.ok) return fail(opts.requestId, "USER_CANCELLED");

  let { busy } = choice.started;
  let disc;
  try {
    disc = await choice.started.disc;
    if (busy.wasDismissed()) return;
  } catch (e) {
    busy.clear();
    if (busy.wasDismissed()) return;
    if (e instanceof PrfUnsupported) return fail(opts.requestId, "PRF_UNSUPPORTED");
    // No passkey picked (none on this phone, or cancelled): the app offers "Try again" or "Create".
    return fail(opts.requestId, "AUTHENTICATION_FAILED");
  }
  busy.clear();
  busy = beginBusy(opts.requestId, "Restoring your wallet…");

  let restored;
  try {
    restored = await api.restoreWalletBlob({
      challengeId: restore.challengeId,
      assertion: disc.assertion,
    });
  } catch {
    disc.prfOutput.fill(0);
    busy.clear();
    return fail(opts.requestId, "BLOB_UNAVAILABLE");
  }
  if (!restored) {
    // A passkey this signer never backed up (e.g. another Revibase app's).
    disc.prfOutput.fill(0);
    busy.clear();
    return fail(opts.requestId, "NOT_FOUND");
  }

  try {
    const raw = base64ToBytes(restored.encryptedWalletBlob, 1024, "url");
    const parsed = parseBlob(raw);
    if (!bytesEqual(parsed.credentialId, disc.credentialId)) {
      disc.prfOutput.fill(0);
      return fail(opts.requestId, "WALLET_MISMATCH");
    }
    const { seed, publicKey } = await unwrapWallet(disc.prfOutput, parsed, opts.rpId);
    disc.prfOutput.fill(0);
    if (busy.wasDismissed()) {
      seed.fill(0);
      return;
    }
    // Persist LS before PUT so a later backup failure cannot empty this device.
    if (!(await writeLocalBlob(raw, store))) {
      seed.fill(0);
      return fail(opts.requestId, "INTERNAL_ERROR");
    }
    const putSignature = await signChallenge(backup.challenge, seed, PUT_CHALLENGE_PREFIX);
    if (!putSignature) {
      seed.fill(0);
      return fail(opts.requestId, "INTERNAL_ERROR");
    }

    const pk = toBase58Pubkey(publicKey);
    seed.fill(0);

    try {
      await pushBackup(ctx, {
        encryptedWalletBlob: bytesToBase64(raw, "url"),
        publicKey: pk,
        putChallengeId: backup.challengeId,
        putSignature,
      });
    } catch {
      return fail(opts.requestId, "BLOB_UNAVAILABLE");
    }
    busy.clear();
    ok(opts.requestId, RESULT_TYPE.AUTH_START, {
      publicKey: pk,
      created: false,
    } satisfies ResultPayload["AUTH_START"]);
  } catch (e) {
    disc.prfOutput.fill(0);
    if (busy.wasDismissed()) return;
    throw e;
  } finally {
    busy.clear();
  }
}

export async function handleAuth(
  ctx: SignerContext,
  opts: {
    requestId: string;
    rpId: string;
    authMode: "create" | "unlock" | undefined;
    credentialIdB64: string | undefined;
    webauthnAttestationObject: string | undefined;
  },
): Promise<void> {
  const { store, fail } = ctx;
  const { requestId, rpId, authMode, credentialIdB64, webauthnAttestationObject } = opts;

  if (authMode === "create") {
    if (!credentialIdB64 || !webauthnAttestationObject) {
      return fail(requestId, "INVALID_MESSAGE");
    }
    return handleCreate(ctx, {
      requestId,
      credentialIdB64,
      webauthnAttestationObject,
    });
  }

  const local = await readLocalBlob(store);
  if (local) {
    return handleLocalUnlock(ctx, {
      requestId,
      rpId,
      raw: local.raw,
      parsed: local.parsed,
    });
  }

  return handleRemoteUnlock(ctx, { requestId, rpId });
}
