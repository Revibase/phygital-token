/**
 * Headless harness around the real signer dispatcher (`createSignerDispatcher`).
 *
 * Boundaries replaced: the trusted UI (ScriptedUi), storage (MemoryBlobStore),
 * the backup API (FakeBackupApi by default, or a client bound to the real API)
 * and the parent channel. WebAuthn goes through the real `BrowserPrfProvider`;
 * install a virtual `navigator` (phygital-test-kit/webauthn) before sending.
 */

import type { BlobStore } from "../blob-store.js";
import { createSignerDispatcher, type BackupApi, type SignerPrf } from "../dispatcher.js";
import { BrowserPrfProvider } from "../webauthn.js";
import { FakeBackupApi } from "./fake-backup-api.js";
import { MemoryBlobStore } from "./memory-store.js";
import { ScriptedUi } from "./scripted-ui.js";

export const PARENT_ORIGIN = "https://app.revibase.test";
export const SIGNER_ORIGIN = "https://signer.revibase.test";
export const RP_ID = "revibase.test";

export type Posted = Record<string, unknown>;

export interface SignerHarnessOptions<A extends BackupApi> {
  api?: A;
  prf?: SignerPrf;
  store?: BlobStore | null;
  ui?: ScriptedUi;
  now?: () => number;
  rpId?: string;
  /** The app origin the signer accepts requests from. */
  parentOrigin?: string;
  /** Identity of `window.parent` (e.g. from a test-kit window pair). */
  parent?: object;
  /** Also forward every posted message (e.g. into a window pair). */
  onPost?: (message: Posted) => void;
}

export function createSignerHarness<A extends BackupApi = FakeBackupApi>(
  opts: SignerHarnessOptions<A> = {},
) {
  const api = (opts.api ?? new FakeBackupApi()) as A;
  const ui = opts.ui ?? new ScriptedUi();
  const store = opts.store === undefined ? new MemoryBlobStore() : opts.store;
  const now = opts.now ?? (() => Date.now());
  const parentOrigin = opts.parentOrigin ?? PARENT_ORIGIN;
  const parent = opts.parent ?? { name: "parent-window" };
  const posted: Posted[] = [];
  const waiters: Array<() => void> = [];
  let seq = 0;

  const dispatcher = createSignerDispatcher({
    prf: opts.prf ?? new BrowserPrfProvider(),
    ui,
    api,
    store,
    now,
    rpId: () => opts.rpId ?? RP_ID,
    parentOrigin,
    parent,
    post: (message) => {
      posted.push(message);
      opts.onPost?.(message);
      for (const w of waiters.splice(0)) w();
    },
  });

  function send(data: unknown, from: { origin?: string; source?: unknown } = {}): void {
    dispatcher.handleMessage({
      origin: from.origin ?? parentOrigin,
      source: "source" in from ? from.source : parent,
      data,
    });
  }

  function nextRequestId(): string {
    return `req-${String(++seq).padStart(6, "0")}`;
  }

  function message(type: string, fields: Record<string, unknown> = {}): Posted {
    return {
      type,
      protocolVersion: 1,
      requestId: nextRequestId(),
      timestamp: now(),
      ...fields,
    };
  }

  function responsesFor(requestId: string): Posted[] {
    return posted.filter((m) => m["requestId"] === requestId);
  }

  async function waitFor<T>(pick: () => T | undefined, timeoutMs = 5_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = pick();
      if (hit !== undefined) return hit;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("signer harness: timed out waiting for a response");
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, Math.min(left, 50));
        waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  /** Send a well-formed request and resolve with the first response for it. */
  async function request(type: string, fields: Record<string, unknown> = {}): Promise<Posted> {
    const msg = message(type, fields);
    send(msg);
    return waitFor(() => responsesFor(String(msg["requestId"]))[0]);
  }

  /** Let deferred work (timers, microtasks) run, e.g. before asserting nothing else was posted. */
  async function settle(ms = 25): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  /** The stored ciphertext as a binary string (memory store only), for comparisons. */
  function localBlob(): string | null {
    const raw = store instanceof MemoryBlobStore ? store.raw : null;
    return raw ? String.fromCharCode(...raw) : null;
  }

  return {
    api,
    ui,
    store,
    parent,
    posted,
    send,
    message,
    request,
    responsesFor,
    waitFor,
    settle,
    localBlob,
  };
}

export type SignerHarness = ReturnType<typeof createSignerHarness>;
