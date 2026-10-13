/**
 * Signer request dispatcher: every sensitive flow (create, unlock, restore,
 * sign, export) and the message gate in front of them.
 *
 * All side effects are injected (`SignerDeps`) so the exact production control
 * flow runs headlessly in tests: WebAuthn/PRF, the trusted UI, the backup API,
 * storage, the parent channel and the clock. `main.ts` wires the browser
 * implementations; nothing here touches `window`, `document` or `fetch`.
 */

import type { ResultPayload } from "./shared/protocol.js";
import { getAddressDecoder, getBase58Decoder } from "@solana/kit";
import type * as BackupApiModule from "./storage/api-backup.js";
import {
  CookieVaultStore,
  readLocalBlob,
  writeLocalBlob,
  type BlobStore,
} from "./storage/blob-store.js";
import { MAX_CREDENTIAL_ID_BYTES, MAX_TX_BYTES, PUT_CHALLENGE_PREFIX } from "./constants.js";
import { MAX_SIGN_MESSAGE_BYTES } from "./shared/protocol.js";
import { base64ToBytes, bytesEqual, bytesToBase64, utf8ToBytes } from "./encoding.js";
import { ed25519Sign } from "./keys/crypto.js";
import {
  errorResponse,
  RESULT_TYPE,
  validateInbound,
  type ErrorCode,
  type InboundRequest,
} from "./messaging/protocol.js";
import { digestHex, SignerState } from "./messaging/state.js";
import { decodeTransaction } from "./tx/decode.js";
import { evaluatePolicy, previewPolicy, type TransactionSummary } from "./tx/policy.js";
import type * as UiModule from "./ui/ui.js";
import {
  PrfUnsupported,
  WebAuthnUnsupported,
  type DiscoverablePrfResult,
} from "./keys/webauthn.js";
import {
  decryptWallet,
  enrollExistingCredential,
  parseBlob,
  ServiceError,
  signAndScrub,
  unwrapWallet,
  type PrfProvider,
} from "./keys/wallet-service.js";
import type { ParsedWalletBlob } from "./keys/wallet-format.js";

/** The trusted in-iframe UI (ui/ui.ts) as used by the dispatcher. */
export type SignerUi = Pick<
  typeof UiModule,
  | "renderIdle"
  | "setBusyDismiss"
  | "setCeremonyBusy"
  | "confirmImport"
  | "confirmFinishCreate"
  | "showRecoverable"
  | "confirmSignTransaction"
  | "confirmSignMessage"
  | "confirmExportPrivateKey"
  | "showExportedSecret"
>;

/** Signer → app worker backup calls (api-backup.ts). */
export type BackupApi = Pick<
  typeof BackupApiModule,
  "issueBackupChallenge" | "issueRestoreChallenge" | "restoreWalletBlob" | "backupWalletBlob"
>;

/** PRF provider plus the discoverable (no allowCredentials) restore ceremony. */
export interface SignerPrf extends PrfProvider {
  getDiscoverable(rpId: string, challenge: Uint8Array): Promise<DiscoverablePrfResult>;
}

export interface SignerDeps {
  /** Revibase's fee payers, to name them on the confirm screen (display only). */
  feePayers?: () => Promise<readonly string[] | null>;
  prf: SignerPrf;
  ui: SignerUi;
  api: BackupApi;
  /** Post a message to the parent (main.ts pins the target origin). */
  post: (message: Record<string, unknown>) => void;
  /** The only origin requests are accepted from. */
  parentOrigin: string;
  /** The only window requests are accepted from (`window.parent`). */
  parent: unknown;
  rpId: () => string;
  /** Ciphertext store; omitted ⇒ this origin's `/vault` partitioned cookie. */
  store?: BlobStore | null;
  now?: () => number;
  /** Schedules deferred busy UI (setTimeout 0 in the browser). */
  defer?: (fn: () => void) => void;
}

export interface InboundEvent {
  origin: string;
  source: unknown;
  data: unknown;
}

export function createSignerDispatcher(deps: SignerDeps): {
  handleMessage: (event: InboundEvent) => void;
} {
  const addr = getAddressDecoder();
  const b58 = getBase58Decoder();
  const now = deps.now ?? (() => Date.now());
  const defer = deps.defer ?? ((fn: () => void) => void setTimeout(fn, 0));
  const prf = deps.prf;
  const ui = deps.ui;
  const api = deps.api;
  const state = new SignerState(now);
  const store = deps.store === undefined ? new CookieVaultStore() : deps.store;
  const withFeePayers = async (summary: TransactionSummary): Promise<TransactionSummary> => {
    if (summary.feePayer === summary.walletAddress || !deps.feePayers) return summary;
    const known = await deps.feePayers().catch(() => null);
    return known ? { ...summary, revibaseFeePayers: known } : summary;
  };

  const toBase58Pubkey = (bytes: Uint8Array): string => addr.decode(bytes);

  function prefixedChallengeMessage(prefix: string, challengeBytes: Uint8Array): Uint8Array {
    const p = utf8ToBytes(prefix);
    const out = new Uint8Array(p.length + challengeBytes.length);
    out.set(p, 0);
    out.set(challengeBytes, p.length);
    return out;
  }

  async function signChallenge(
    challengeB64: string | undefined,
    seed: Uint8Array,
    prefix: string,
  ): Promise<string | undefined> {
    if (!challengeB64) return undefined;
    try {
      const challengeBytes = base64ToBytes(challengeB64, 64, "url");
      const sig = await ed25519Sign(prefixedChallengeMessage(prefix, challengeBytes), seed);
      return bytesToBase64(sig, "url");
    } catch {
      return undefined;
    }
  }

  function beginBusy(requestId: string, message: string, opts: { deferUi?: boolean } = {}) {
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      fail(requestId, "USER_CANCELLED");
    };
    ui.setBusyDismiss(dismiss);
    const showUi = () => {
      if (dismissed) return;
      ui.setCeremonyBusy(message);
    };
    if (opts.deferUi) {
      defer(showUi);
    } else {
      showUi();
    }
    return {
      wasDismissed: () => dismissed,
      clear: () => {
        ui.setBusyDismiss(null);
        ui.setCeremonyBusy(null);
      },
    };
  }

  function post(message: Record<string, unknown>): void {
    deps.post(message);
  }

  function fail(requestId: string | undefined, code: ErrorCode): void {
    post(errorResponse(requestId, code));
  }

  function ok(requestId: string, type: string, extra: Record<string, unknown>): void {
    post({ type, requestId, ...extra });
  }

  function handleMessage(event: InboundEvent): void {
    if (event.origin !== deps.parentOrigin) return;
    if (event.source !== deps.parent) return;

    const validation = validateInbound(event.data);
    if (!validation.ok) {
      fail(validation.requestId, validation.code);
      return;
    }
    const request = validation.request;

    const replay = state.checkFreshnessAndReplay(request.requestId, request.timestamp);
    if (replay) {
      fail(request.requestId, replay);
      return;
    }
    state.remember(request.requestId, request.timestamp);

    void handle(request).catch(() => {
      fail(request.requestId, "INTERNAL_ERROR");
      state.end();
      ui.renderIdle();
    });
  }

  async function handle(request: InboundRequest): Promise<void> {
    const rpId = deps.rpId();
    const opFor = {
      AUTH_START: "AUTH_PENDING",
      SIGN_TRANSACTION: "SIGN_PENDING",
      SIGN_MESSAGE: "SIGN_PENDING",
      EXPORT_PRIVATE_KEY: "PRIVATE_EXPORT_PENDING",
    } as const;

    const op = opFor[request.type];
    if (!state.begin(op, request.requestId)) {
      fail(request.requestId, "SIGNER_BUSY");
      return;
    }
    try {
      switch (request.type) {
        case "AUTH_START":
          await handleAuth({
            requestId: request.requestId,
            rpId,
            authMode: request.authMode,
            credentialIdB64: request.credentialId,
            webauthnAttestationObject: request.webauthnAttestationObject,
          });
          break;
        case "SIGN_TRANSACTION":
          await handleSign(request.requestId, rpId, request.transaction);
          break;
        case "SIGN_MESSAGE":
          await handleSignMessage(request.requestId, rpId, request.message);
          break;
        case "EXPORT_PRIVATE_KEY":
          await handleExportPrivateKey(request.requestId, rpId);
          break;
      }
    } catch (e) {
      fail(request.requestId, codeOf(e));
    } finally {
      state.end();
      ui.renderIdle();
    }
  }

  async function pushBackup(opts: {
    encryptedWalletBlob: string;
    publicKey: string;
    putChallengeId: string;
    putSignature: string;
    webauthnAttestationObject?: string;
  }): Promise<void> {
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

  async function mintBackupChallenge(): Promise<{
    challengeId: string;
    challenge: string;
  }> {
    try {
      return await api.issueBackupChallenge();
    } catch {
      throw new ServiceError("BLOB_UNAVAILABLE");
    }
  }

  async function handleCreate(opts: {
    requestId: string;
    credentialIdB64: string;
    webauthnAttestationObject: string;
  }): Promise<void> {
    let credentialId: Uint8Array;
    try {
      credentialId = base64ToBytes(opts.credentialIdB64, MAX_CREDENTIAL_ID_BYTES, "url");
    } catch {
      return fail(opts.requestId, "INVALID_MESSAGE");
    }

    // Mint in parallel with the confirm tap — do not await fetch before WebAuthn.
    const challengePromise = mintBackupChallenge();
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
        await pushBackup({
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
          return handleCreate(opts);
        }
        return fail(opts.requestId, "USER_CANCELLED");
      }
      throw e;
    } finally {
      busy.clear();
    }
  }

  async function handleLocalUnlock(opts: {
    requestId: string;
    rpId: string;
    raw: Uint8Array;
    parsed: ParsedWalletBlob;
  }): Promise<void> {
    const challengePromise = mintBackupChallenge();
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
        await pushBackup({
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
          return handleLocalUnlock(opts);
        }
        return fail(opts.requestId, "AUTHENTICATION_FAILED");
      }
      throw e;
    } finally {
      busy.clear();
    }
  }

  async function handleRemoteUnlock(opts: { requestId: string; rpId: string }): Promise<void> {
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
        await pushBackup({
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

  async function handleAuth(opts: {
    requestId: string;
    rpId: string;
    authMode: "create" | "unlock" | undefined;
    credentialIdB64: string | undefined;
    webauthnAttestationObject: string | undefined;
  }): Promise<void> {
    const { requestId, rpId, authMode, credentialIdB64, webauthnAttestationObject } = opts;

    if (authMode === "create") {
      if (!credentialIdB64 || !webauthnAttestationObject) {
        return fail(requestId, "INVALID_MESSAGE");
      }
      return handleCreate({
        requestId,
        credentialIdB64,
        webauthnAttestationObject,
      });
    }

    const local = await readLocalBlob(store);
    if (local) {
      return handleLocalUnlock({
        requestId,
        rpId,
        raw: local.raw,
        parsed: local.parsed,
      });
    }

    return handleRemoteUnlock({ requestId, rpId });
  }

  async function mintRestoreChallenge(): Promise<{
    restore: { challengeId: string; challenge: string };
    fetchChallengeBytes: Uint8Array;
  } | null> {
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

  async function finishRestore(opts: {
    requestId: string;
    rpId: string;
    restore: { challengeId: string; challenge: string };
    disc: ReturnType<SignerPrf["getDiscoverable"]>;
    busy: ReturnType<typeof beginBusy>;
  }): Promise<
    | {
        raw: Uint8Array;
        parsed: ParsedWalletBlob;
        seed: Uint8Array;
        publicKey: Uint8Array;
      }
    | "failed"
    | "dismissed"
  > {
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

  async function handleSign(requestId: string, rpId: string, txB64: string): Promise<void> {
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

      const minted = await mintRestoreChallenge();
      if (!minted) return fail(requestId, "BLOB_UNAVAILABLE");

      const choice = await ui.confirmSignTransaction(await withFeePayers(preview.summary), () => {
        const disc = prf.getDiscoverable(rpId, minted.fetchChallengeBytes);
        const busy = beginBusy(requestId, "Use Face ID or Touch ID to approve", {
          deferUi: true,
        });
        return { busy, disc };
      });
      if (!choice.ok) return fail(requestId, "USER_CANCELLED");

      const restored = await finishRestore({
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

  /**
   * The app's sign-in message, and nothing else: line 1 must name the parent
   * site and line 2 must be this wallet's address, so the signature can't be
   * replayed as a sign-in to another site or for another account.
   */
  function signInMessageProblem(text: string, walletAddress: string | null): boolean {
    const [first, second] = text.split("\n");
    const host = new URL(deps.parentOrigin).host;
    if (first !== `${host} wants you to sign in with your Solana account:`) return true;
    return walletAddress !== null && second !== walletAddress;
  }

  async function handleSignMessage(
    requestId: string,
    rpId: string,
    messageB64: string,
  ): Promise<void> {
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
      if (signInMessageProblem(text, toBase58Pubkey(local.parsed.publicKey))) {
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
      if (signInMessageProblem(text, null)) return fail(requestId, "POLICY_REJECTED");
      const minted = await mintRestoreChallenge();
      if (!minted) return fail(requestId, "BLOB_UNAVAILABLE");
      const choice = await ui.confirmSignMessage(text, site, () => {
        const disc = prf.getDiscoverable(rpId, minted.fetchChallengeBytes);
        const busy = beginBusy(requestId, "Use Face ID or Touch ID to approve", { deferUi: true });
        return { busy, disc };
      });
      if (!choice.ok) return fail(requestId, "USER_CANCELLED");
      const restored = await finishRestore({
        requestId,
        rpId,
        restore: minted.restore,
        disc: choice.started.disc,
        busy: choice.started.busy,
      });
      if (restored === "failed" || restored === "dismissed") return;
      if (signInMessageProblem(text, toBase58Pubkey(restored.publicKey))) {
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

  async function handleExportPrivateKey(requestId: string, rpId: string): Promise<void> {
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
      const minted = await mintRestoreChallenge();
      if (!minted) return fail(requestId, "BLOB_UNAVAILABLE");

      const choice = await ui.confirmExportPrivateKey(() => {
        const disc = prf.getDiscoverable(rpId, minted.fetchChallengeBytes);
        const busy = beginBusy(requestId, "Use Face ID or Touch ID to approve", {
          deferUi: true,
        });
        return { busy, disc };
      });
      if (!choice.ok) return fail(requestId, "USER_CANCELLED");

      const restored = await finishRestore({
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

  /**
   * The user closed the OS passkey sheet (NotAllowedError/AbortError), which
   * `decryptWallet` reports as AUTHENTICATION_FAILED with the DOMException as
   * its cause. Sign and export report it as USER_CANCELLED. Unlock keeps
   * AUTHENTICATION_FAILED, since a removed passkey looks the same to the browser
   * and the app's lost-passkey path depends on it.
   */
  function promptDismissed(e: unknown): boolean {
    const cause = e instanceof ServiceError ? e.cause : e;
    return (
      cause instanceof DOMException &&
      (cause.name === "NotAllowedError" || cause.name === "AbortError")
    );
  }

  function codeOf(e: unknown): ErrorCode {
    if (e instanceof ServiceError) return e.code;
    if (e instanceof PrfUnsupported) return "PRF_UNSUPPORTED";
    if (e instanceof WebAuthnUnsupported) return "UNSUPPORTED_CREDENTIAL";
    if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) {
      return "USER_CANCELLED";
    }
    return "INTERNAL_ERROR";
  }

  return { handleMessage };
}
