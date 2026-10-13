/**
 * State and helpers shared by every signer flow: the injected dependencies,
 * the request state machine, the reply channel and the busy indicator.
 *
 * Built once per dispatcher by `createSignerContext`; flows receive it as
 * their first argument.
 */
import { getAddressDecoder, getBase58Decoder } from "@solana/kit";
import { CookieVaultStore, type BlobStore } from "../storage/blob-store.js";
import { base64ToBytes, bytesToBase64, utf8ToBytes } from "../encoding.js";
import { ed25519Sign } from "../keys/crypto.js";
import { errorResponse, type ErrorCode } from "../messaging/protocol.js";
import { SignerState } from "../messaging/state.js";
import type { TransactionSummary } from "../tx/policy.js";
import type { BackupApi, SignerDeps, SignerPrf, SignerUi } from "../deps.js";

/** Handle for the cancellable "confirm on this phone" indicator. */
export type Busy = { wasDismissed: () => boolean; clear: () => void };

export interface SignerContext {
  deps: SignerDeps;
  prf: SignerPrf;
  ui: SignerUi;
  api: BackupApi;
  state: SignerState;
  /** `null` = no ciphertext store (tests). */
  store: BlobStore | null;
  now: () => number;
  b58: ReturnType<typeof getBase58Decoder>;
  toBase58Pubkey: (bytes: Uint8Array) => string;
  /** Adds the Revibase fee payers to a summary so the confirm screen can name them. */
  withFeePayers: (summary: TransactionSummary) => Promise<TransactionSummary>;
  prefixedChallengeMessage: (prefix: string, challengeBytes: Uint8Array) => Uint8Array;
  /** Signs `prefix || challenge` with the wallet seed; `undefined` if the challenge is malformed. */
  signChallenge: (
    challengeB64: string | undefined,
    seed: Uint8Array,
    prefix: string,
  ) => Promise<string | undefined>;
  /** Shows a dismissable busy state; dismissing replies USER_CANCELLED. */
  beginBusy: (requestId: string, message: string, opts?: { deferUi?: boolean }) => Busy;
  fail: (requestId: string | undefined, code: ErrorCode) => void;
  ok: (requestId: string, type: string, extra: Record<string, unknown>) => void;
}

export function createSignerContext(deps: SignerDeps): SignerContext {
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

  return {
    deps,
    prf,
    ui,
    api,
    state,
    store,
    now,
    b58,
    toBase58Pubkey,
    withFeePayers,
    prefixedChallengeMessage,
    signChallenge,
    beginBusy,
    fail,
    ok,
  };
}
