/**
 * Last-known-good encrypted wallet on the signer origin. Ciphertext only.
 *
 * Kept in a CHIPS (partitioned) HttpOnly cookie set by this origin's `/vault`
 * endpoint (see vault.ts): Safari clears a framed origin's localStorage and
 * IndexedDB, but keeps partitioned cookies. Writes are read back, because
 * partitioned storage can accept a write and then drop it.
 */

import { MAX_BLOB_BYTES } from "../constants.js";
import { base64ToBytes, bytesToBase64 } from "../encoding.js";
import { VAULT_PATH } from "./vault.js";
import { parseBlob } from "../keys/wallet-service.js";
import type { ParsedWalletBlob } from "../keys/wallet-format.js";

export interface BlobStore {
  get(): Promise<Uint8Array | null>;
  put(raw: Uint8Array): Promise<void>;
}

/** The `/vault` cookie on this origin (same-origin fetches; the cookie itself is HttpOnly). */
export class CookieVaultStore implements BlobStore {
  constructor(private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {}

  async get(): Promise<Uint8Array | null> {
    const res = await this.fetchImpl(VAULT_PATH, { credentials: "same-origin", cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`vault ${res.status}`);
    const body = (await res.json()) as { encryptedWalletBlob?: unknown };
    if (typeof body.encryptedWalletBlob !== "string") return null;
    return base64ToBytes(body.encryptedWalletBlob, MAX_BLOB_BYTES, "url");
  }

  async put(raw: Uint8Array): Promise<void> {
    const res = await this.fetchImpl(VAULT_PATH, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encryptedWalletBlob: bytesToBase64(raw, "url") }),
    });
    if (!res.ok) throw new Error(`vault ${res.status}`);
  }
}

export async function readLocalBlob(store: BlobStore | null): Promise<{
  raw: Uint8Array;
  parsed: ParsedWalletBlob;
} | null> {
  if (!store) return null;
  let raw: Uint8Array | null;
  try {
    raw = await store.get();
  } catch {
    return null;
  }
  if (!raw || raw.length > MAX_BLOB_BYTES) return null;
  try {
    return { raw, parsed: parseBlob(raw) };
  } catch {
    return null;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export async function writeLocalBlob(raw: Uint8Array, store: BlobStore | null): Promise<boolean> {
  if (!store) return false;
  try {
    parseBlob(raw);
    await store.put(raw);
    const roundTrip = await store.get();
    return !!roundTrip && sameBytes(roundTrip, raw);
  } catch {
    return false;
  }
}
