/**
 * Dispatcher (authority.ts) end-to-end, headless: the real message gate,
 * state machine, PRF pipeline, policy and signing, driven through a virtual
 * authenticator (real BrowserPrfProvider over a fake navigator), a scripted
 * trusted UI and an in-memory backup API.
 *
 * Invariant checked after EVERY test: no PRF output, seed or exported secret
 * appears in anything posted to the parent or sent to the API.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddressDecoder, getAddressEncoder, getTransactionDecoder, type Address } from "@solana/kit";
import { LeakScanner } from "./testing/kit/leaks.js";
import { VirtualAuthenticator, navigatorFor } from "./testing/kit/index.js";

import {
  MAX_BLOB_BYTES,
  PRF_SALT,
  REQUEST_FRESHNESS_WINDOW_MS,
  SEEN_REQUEST_IDS_LIMIT,
} from "./constants.js";
import { ed25519Verify } from "./crypto.js";
import { base64ToBytes, bytesToBase64 } from "./encoding.js";
import { decodeWalletBlob } from "./wallet-format.js";
import { parseBlob, unwrapWallet } from "./wallet-service.js";
import {
  createSignerHarness,
  PARENT_ORIGIN,
  RP_ID,
  SIGNER_ORIGIN,
  type Posted,
  type SignerHarness,
} from "./testing/harness.js";
import { FakeBackupApi } from "./testing/fake-backup-api.js";
import { MemoryBlobStore } from "./testing/memory-store.js";
import {
  removeOwnerWire,
  executeWithOwnerWire,
  lookupTableWire,
  randomAddress,
  foreignProgramWire,
  toB64,
} from "./testing/tx-fixtures.js";

const addr = getAddressDecoder();
const addrEnc = getAddressEncoder();

let va: VirtualAuthenticator;
let harnesses: SignerHarness[];
let apis: FakeBackupApi[];

beforeEach(() => {
  va = new VirtualAuthenticator({ seed: "authority-test", counter: "zero" });
  vi.stubGlobal("navigator", navigatorFor(va, SIGNER_ORIGIN));
  harnesses = [];
  apis = [];
});

afterEach(async () => {
  vi.unstubAllGlobals();
  // Secrets: every credential's PRF output, and the seed inside every blob
  // this test produced (decrypted with that PRF).
  const scanner = new LeakScanner();
  const prfs = new Map<string, Uint8Array>();
  for (const c of va.list()) {
    if (!c.prfSecret) continue;
    const prf = va.prfOutput(c.id, PRF_SALT);
    prfs.set(bytesToBase64(c.id, "url"), prf);
    scanner.track(`prf:${bytesToBase64(c.id, "url")}`, prf);
  }
  const blobs = new Set<string>();
  for (const api of apis) for (const b of api.blobs.values()) blobs.add(b.encryptedWalletBlob);
  for (const h of harnesses) {
    const raw = h.localBlob();
    if (raw) blobs.add(bytesToBase64(Uint8Array.from(raw, (ch) => ch.charCodeAt(0)), "url"));
  }
  for (const b64 of blobs) {
    try {
      const parsed = parseBlob(base64ToBytes(b64, MAX_BLOB_BYTES, "url"));
      const prf = prfs.get(bytesToBase64(parsed.credentialId, "url"));
      if (!prf) continue;
      const { seed } = await unwrapWallet(prf, parsed, RP_ID);
      scanner.track(`seed:${addr.decode(parsed.publicKey)}`, seed);
    } catch {
      /* tampered fixtures do not decrypt; nothing to track */
    }
  }
  const findings = scanner.scanAll([
    ...harnesses.flatMap((h, i) => h.posted.map((m) => ({ where: `posted[h${i}]`, value: m }))),
    ...apis.flatMap((a, i) => a.calls.map((c) => ({ where: `api[${i}].${c.op}`, value: c }))),
  ]);
  expect(findings).toEqual([]);
});

function harness(opts: Parameters<typeof createSignerHarness<FakeBackupApi>>[0] = {}) {
  const h = createSignerHarness<FakeBackupApi>(opts);
  harnesses.push(h);
  if (!apis.includes(h.api)) apis.push(h.api);
  return h;
}

/** Passkey creation runs on the app origin (top level), not in the signer. */
async function registerOnApp(): Promise<{ credentialId: string; attestationObject: string; rawId: Uint8Array }> {
  const cred = await va.create(
    {
      publicKey: {
        challenge: new Uint8Array(32).fill(1),
        rp: { id: RP_ID, name: "Revibase" },
        user: { id: new Uint8Array(16).fill(2), name: "owner", displayName: "owner" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        extensions: { prf: {} },
      },
    },
    { origin: PARENT_ORIGIN },
  );
  const rawId = new Uint8Array(cred.rawId);
  const r = cred.response;
  return {
    rawId,
    credentialId: bytesToBase64(rawId, "url"),
    attestationObject: bytesToBase64(new Uint8Array(r.attestationObject), "url"),
  };
}

async function createWallet(h: SignerHarness) {
  const reg = await registerOnApp();
  const res = await h.request("AUTH_START", {
    authMode: "create",
    credentialId: reg.credentialId,
    webauthnAttestationObject: reg.attestationObject,
  });
  expect(res["type"]).toBe("AUTH_COMPLETE");
  return { ...reg, publicKey: String(res["publicKey"]) as Address };
}

function errorCode(m: Posted | undefined): unknown {
  expect(m?.["type"]).toBe("ERROR");
  return m?.["code"];
}

function flipLastByte(b64url: string): string {
  const bytes = base64ToBytes(b64url, MAX_BLOB_BYTES, "url");
  bytes[bytes.length - 1]! ^= 0xff;
  return bytesToBase64(bytes, "url");
}

// -----------------------------------------------------------------------------
// Message gate
// -----------------------------------------------------------------------------

describe("message gate", () => {
  it("ignores messages from any origin other than the parent", async () => {
    const h = harness();
    h.send(h.message("EXPORT_PRIVATE_KEY"), { origin: "https://evil.example" });
    await h.settle();
    expect(h.posted).toEqual([]);
  });

  it("ignores messages whose source is not window.parent (e.g. a sibling frame)", async () => {
    const h = harness();
    h.send(h.message("EXPORT_PRIVATE_KEY"), { source: { name: "rogue-frame" } });
    await h.settle();
    expect(h.posted).toEqual([]);
  });

  it("answers a schema-invalid request with INVALID_MESSAGE for that requestId", async () => {
    const h = harness();
    h.send({ ...h.message("EXPORT_PRIVATE_KEY"), requestId: "req-bad-0001", extra: 1 });
    await h.settle();
    expect(h.posted).toEqual([
      { type: "ERROR", protocolVersion: 1, requestId: "req-bad-0001", code: "INVALID_MESSAGE" },
    ]);
  });

  it("rejects a replayed requestId after the first request completes", async () => {
    const h = harness();
    h.ui.script("cancel");
    const msg = h.message("AUTH_START", { authMode: "unlock" });
    h.send(msg);
    await h.waitFor(() => h.responsesFor(String(msg["requestId"]))[0]);
    h.send(msg);
    await h.settle();
    expect(h.responsesFor(String(msg["requestId"])).map((m) => m["code"])).toEqual([
      "USER_CANCELLED",
      "REPLAY_REJECTED",
    ]);
  });

  it("rejects a stale timestamp", async () => {
    const h = harness();
    const msg = { ...h.message("EXPORT_PRIVATE_KEY"), timestamp: Date.now() - 120_000 };
    h.send(msg);
    await h.settle();
    expect(h.posted.map((m) => m["code"])).toEqual(["REPLAY_REJECTED"]);
  });

  it("rejects a concurrent request with SIGNER_BUSY without disturbing the active one", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    h.ui.script("hold");
    const first = h.message("EXPORT_PRIVATE_KEY");
    h.send(first);
    await h.waitFor(() => (h.ui.prompts("confirmExportPrivateKey").length ? true : undefined));

    const second = await h.request("SIGN_TRANSACTION", {
      transaction: toB64(removeOwnerWire({ owner: publicKey })),
    });
    expect(errorCode(second)).toBe("SIGNER_BUSY");

    h.ui.release("confirm");
    const done = await h.waitFor(() => h.responsesFor(String(first["requestId"]))[0]);
    expect(done).toMatchObject({ type: "EXPORT_PRIVATE_KEY_RESULT", completed: true });
  });
});

// -----------------------------------------------------------------------------
// AUTH_START create
// -----------------------------------------------------------------------------

describe("create wallet (AUTH_START create)", () => {
  it("enrolls the app-created passkey, backs up a signed blob, stores it locally, returns the pubkey", async () => {
    const h = harness();
    const { credentialId, attestationObject, rawId, publicKey } = await createWallet(h);

    const [put] = h.api.puts();
    expect(put?.proofValid).toBe(true);
    expect(put?.body.webauthnAttestationObject).toBe(attestationObject);
    expect(put?.body.publicKey).toBe(publicKey);

    const blob = decodeWalletBlob(base64ToBytes(put!.body.encryptedWalletBlob, MAX_BLOB_BYTES, "url"));
    expect(bytesToBase64(blob.credentialId, "url")).toBe(credentialId);
    expect(addr.decode(blob.publicKey)).toBe(publicKey);

    // Local copy is byte-identical to the backed-up ciphertext.
    const local = h.localBlob();
    expect(local && bytesToBase64(Uint8Array.from(local, (c) => c.charCodeAt(0)), "url")).toBe(
      put!.body.encryptedWalletBlob,
    );

    // The blob decrypts with this passkey's PRF to a seed for `publicKey`.
    const { publicKey: derived } = await unwrapWallet(va.prfOutput(rawId, PRF_SALT), blob, RP_ID);
    expect(addr.decode(derived)).toBe(publicKey);
  });

  it("rejects create without an attestation object before any WebAuthn call", async () => {
    const h = harness();
    const reg = await registerOnApp();
    const res = await h.request("AUTH_START", { authMode: "create", credentialId: reg.credentialId });
    expect(errorCode(res)).toBe("INVALID_MESSAGE");
    expect(va.calls.get).toBe(0);
  });

  it("rejects a credentialId that is not base64url", async () => {
    const h = harness();
    const res = await h.request("AUTH_START", {
      authMode: "create",
      credentialId: "!!!not-base64!!!",
      webauthnAttestationObject: "AAAA",
    });
    expect(errorCode(res)).toBe("INVALID_MESSAGE");
  });

  it("offers a retry when the WebAuthn prompt is cancelled, and the retry succeeds", async () => {
    const h = harness();
    const reg = await registerOnApp();
    va.failNext("NotAllowedError", "get");
    h.ui.script("confirm", "retry", "confirm");
    const res = await h.request("AUTH_START", {
      authMode: "create",
      credentialId: reg.credentialId,
      webauthnAttestationObject: reg.attestationObject,
    });
    expect(res).toMatchObject({ type: "AUTH_COMPLETE", created: true });
    expect(h.ui.prompts("showRecoverable")).toHaveLength(1);
    expect(h.api.puts()).toHaveLength(1);
  });

  it("fails closed with PRF_UNSUPPORTED when the passkey has no PRF", async () => {
    const h = harness();
    const reg = await registerOnApp();
    va.disablePrf(reg.rawId);
    const res = await h.request("AUTH_START", {
      authMode: "create",
      credentialId: reg.credentialId,
      webauthnAttestationObject: reg.attestationObject,
    });
    expect(errorCode(res)).toBe("PRF_UNSUPPORTED");
    expect(h.ui.prompts("showRecoverable")).toHaveLength(0);
    expect(h.api.puts()).toHaveLength(0);
    expect(h.localBlob()).toBeNull();
  });

  it("returns BLOB_UNAVAILABLE when the backup challenge cannot be minted", async () => {
    const h = harness();
    const reg = await registerOnApp();
    h.api.failNext.issueBackupChallenge = "BLOB_UNAVAILABLE";
    const res = await h.request("AUTH_START", {
      authMode: "create",
      credentialId: reg.credentialId,
      webauthnAttestationObject: reg.attestationObject,
    });
    expect(errorCode(res)).toBe("BLOB_UNAVAILABLE");
    expect(h.localBlob()).toBeNull();
  });

  it("returns BLOB_UNAVAILABLE and leaves local storage empty when the backup PUT is refused", async () => {
    const h = harness();
    const reg = await registerOnApp();
    h.api.failNext.put = "wallet_conflict";
    const res = await h.request("AUTH_START", {
      authMode: "create",
      credentialId: reg.credentialId,
      webauthnAttestationObject: reg.attestationObject,
    });
    expect(errorCode(res)).toBe("BLOB_UNAVAILABLE");
    expect(h.localBlob()).toBeNull();
  });

  it("reports INTERNAL_ERROR when local storage drops the write after a successful backup (partial state: server has the blob)", async () => {
    const store = new MemoryBlobStore();
    store.mode = "drop-writes";
    const h = harness({ store });
    const reg = await registerOnApp();
    const res = await h.request("AUTH_START", {
      authMode: "create",
      credentialId: reg.credentialId,
      webauthnAttestationObject: reg.attestationObject,
    });
    expect(errorCode(res)).toBe("INTERNAL_ERROR");
    // Recovery path: the backup exists, so a remote restore can recover it.
    expect(h.api.blobs.size).toBe(1);
  });

  it("dismissing the busy sheet mid-ceremony yields exactly one USER_CANCELLED and no backup", async () => {
    const h = harness();
    const reg = await registerOnApp();
    h.ui.script("dismiss-busy");
    const msg = h.message("AUTH_START", {
      authMode: "create",
      credentialId: reg.credentialId,
      webauthnAttestationObject: reg.attestationObject,
    });
    h.send(msg);
    await h.waitFor(() => h.responsesFor(String(msg["requestId"]))[0]);
    await h.settle(50);
    expect(h.responsesFor(String(msg["requestId"])).map((m) => m["code"])).toEqual(["USER_CANCELLED"]);
    expect(h.api.puts()).toHaveLength(0);
    expect(h.localBlob()).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// AUTH_START unlock — local blob present
// -----------------------------------------------------------------------------

describe("unlock with a local blob", () => {
  it("decrypts with the passkey, refreshes the backup, and returns created:false", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    const res = await h.request("AUTH_START", { authMode: "unlock" });
    expect(res).toMatchObject({ type: "AUTH_COMPLETE", publicKey, created: false });
    const puts = h.api.puts();
    expect(puts).toHaveLength(2);
    expect(puts[1]!.proofValid).toBe(true);
    expect(puts[1]!.body.encryptedWalletBlob).toBe(puts[0]!.body.encryptedWalletBlob);
  });

  it("surfaces AUTHENTICATION_FAILED when the passkey was removed from the device", async () => {
    const h = harness();
    const { rawId } = await createWallet(h);
    va.removeCredential(rawId);
    const res = await h.request("AUTH_START", { authMode: "unlock" });
    expect(errorCode(res)).toBe("AUTHENTICATION_FAILED");
    expect(h.ui.prompts("showRecoverable")).toHaveLength(1);
  });

  it("treats a tampered local blob as an authentication failure (never decrypts)", async () => {
    const h = harness();
    await createWallet(h);
    const store = h.store as MemoryBlobStore;
    store.raw![store.raw!.length - 1]! ^= 0xff;
    const res = await h.request("AUTH_START", { authMode: "unlock" });
    expect(errorCode(res)).toBe("AUTHENTICATION_FAILED");
  });

  it("returns BLOB_UNAVAILABLE when the refresh PUT fails", async () => {
    const h = harness();
    await createWallet(h);
    h.api.failNext.put = "BLOB_UNAVAILABLE";
    const res = await h.request("AUTH_START", { authMode: "unlock" });
    expect(errorCode(res)).toBe("BLOB_UNAVAILABLE");
  });
});

// -----------------------------------------------------------------------------
// AUTH_START unlock — no local blob (remote restore on a new device)
// -----------------------------------------------------------------------------

describe("remote restore (no local blob)", () => {
  async function deviceAWallet() {
    const deviceA = harness();
    const wallet = await createWallet(deviceA);
    return { deviceA, wallet };
  }

  it("restores on a fresh device with the synced passkey, stores locally, and refreshes the backup", async () => {
    const { deviceA, wallet } = await deviceAWallet();
    const deviceB = harness({ api: deviceA.api });
    const res = await deviceB.request("AUTH_START", { authMode: "unlock" });
    expect(res).toMatchObject({ type: "AUTH_COMPLETE", publicKey: wallet.publicKey, created: false });
    expect(deviceB.localBlob()).toBe(deviceA.localBlob());
  });

  it("writes the local blob before the backup PUT, so a PUT failure does not strand the device", async () => {
    const { deviceA } = await deviceAWallet();
    const deviceB = harness({ api: deviceA.api });
    deviceA.api.failNext.put = "BLOB_UNAVAILABLE";
    const res = await deviceB.request("AUTH_START", { authMode: "unlock" });
    expect(errorCode(res)).toBe("BLOB_UNAVAILABLE");
    expect(deviceB.localBlob()).toBe(deviceA.localBlob());
  });

  it("returns NOT_FOUND when the server has no backup for the picked passkey", async () => {
    const { deviceA } = await deviceAWallet();
    deviceA.api.blobs.clear();
    const deviceB = harness({ api: deviceA.api });
    const res = await deviceB.request("AUTH_START", { authMode: "unlock" });
    expect(errorCode(res)).toBe("NOT_FOUND");
    expect(deviceB.ui.prompts("showRecoverable")).toHaveLength(0);
    expect(deviceB.localBlob()).toBeNull();
  });

  it("rejects a blob that belongs to a different credential (WALLET_MISMATCH)", async () => {
    const { deviceA, wallet } = await deviceAWallet();
    const other = await createWallet(harness({ api: deviceA.api }));
    const otherBlob = deviceA.api.blobs.get(other.credentialId)!;
    const deviceB = harness({ api: deviceA.api });
    va.selectNext(wallet.rawId);
    deviceA.api.restoreOverride = otherBlob;
    const res = await deviceB.request("AUTH_START", { authMode: "unlock" });
    expect(errorCode(res)).toBe("WALLET_MISMATCH");
    expect(deviceB.localBlob()).toBeNull();
  });

  it("ignores the server-supplied publicKey and reports the key derived from the blob", async () => {
    const { deviceA, wallet } = await deviceAWallet();
    const stored = deviceA.api.blobs.get(wallet.credentialId)!;
    deviceA.api.restoreOverride = { ...stored, publicKey: randomAddress() };
    const deviceB = harness({ api: deviceA.api });
    const res = await deviceB.request("AUTH_START", { authMode: "unlock" });
    expect(res).toMatchObject({ type: "AUTH_COMPLETE", publicKey: wallet.publicKey });
  });

  it("refuses a tampered blob from the server (DECRYPTION_FAILED) and stores nothing", async () => {
    const { deviceA, wallet } = await deviceAWallet();
    const stored = deviceA.api.blobs.get(wallet.credentialId)!;
    deviceA.api.restoreOverride = { ...stored, encryptedWalletBlob: flipLastByte(stored.encryptedWalletBlob) };
    const deviceB = harness({ api: deviceA.api });
    const res = await deviceB.request("AUTH_START", { authMode: "unlock" });
    expect(errorCode(res)).toBe("DECRYPTION_FAILED");
    expect(deviceB.localBlob()).toBeNull();
  });

  it("the restore request carries the WebAuthn assertion but never PRF output", async () => {
    const { deviceA } = await deviceAWallet();
    const deviceB = harness({ api: deviceA.api });
    await deviceB.request("AUTH_START", { authMode: "unlock" });
    const restore = deviceA.api.calls.find((c) => c.op === "restore");
    expect(restore && "body" in restore && restore.body.assertion["clientExtensionResults"]).toEqual({});
  });
});

// -----------------------------------------------------------------------------
// SIGN_MESSAGE
// -----------------------------------------------------------------------------

describe("sign message", () => {
  const signIn = (address: string, host = new URL(PARENT_ORIGIN).host) =>
    bytesToBase64(new TextEncoder().encode(`${host} wants you to sign in with your Solana account:\n${address}\n\nNonce: abc`), "std");

  it("signs the app's sign-in message after showing it verbatim", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    const message = signIn(publicKey);
    const res = await h.request("SIGN_MESSAGE", { message });
    expect(res).toMatchObject({ type: "SIGN_MESSAGE_RESULT", publicKey });
    const signature = base64ToBytes(String(res["signature"]), 64, "std");
    expect(await ed25519Verify(signature, base64ToBytes(message, 2048, "std"), new Uint8Array(addrEnc.encode(publicKey)))).toBe(true);
    const [screen] = h.ui.prompts("confirmSignMessage");
    expect(screen && "text" in screen && screen.text).toContain(publicKey);
  });

  it("refuses a sign-in for another site or another account, before any prompt", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    expect(errorCode(await h.request("SIGN_MESSAGE", { message: signIn(publicKey, "evil.example") }))).toBe("POLICY_REJECTED");
    expect(errorCode(await h.request("SIGN_MESSAGE", { message: signIn(randomAddress()) }))).toBe("POLICY_REJECTED");
    expect(errorCode(await h.request("SIGN_MESSAGE", { message: bytesToBase64(Uint8Array.of(0xff, 0xfe), "std") }))).toBe("INVALID_MESSAGE");
    expect(h.ui.prompts("confirmSignMessage")).toHaveLength(0);
  });

  it("cold start: restores, then checks the address before signing", async () => {
    const deviceA = harness();
    const wallet = await createWallet(deviceA);
    const deviceB = harness({ api: deviceA.api });
    va.selectNext(wallet.rawId);
    expect(await deviceB.request("SIGN_MESSAGE", { message: signIn(wallet.publicKey) })).toMatchObject({ type: "SIGN_MESSAGE_RESULT" });
    va.selectNext(wallet.rawId);
    const other = harness({ api: deviceA.api });
    expect(errorCode(await other.request("SIGN_MESSAGE", { message: signIn(randomAddress()) }))).toBe("POLICY_REJECTED");
  });
});

// -----------------------------------------------------------------------------
// SIGN_TRANSACTION
// -----------------------------------------------------------------------------

describe("sign transaction", () => {
  it("signs the exact message bytes with the wallet key after showing the clear-sign summary", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    const wire = executeWithOwnerWire({ owner: publicKey });
    const res = await h.request("SIGN_TRANSACTION", { transaction: toB64(wire) });
    expect(res).toMatchObject({ type: "SIGN_TRANSACTION_RESULT", publicKey });

    const tx = getTransactionDecoder().decode(wire);
    const signature = base64ToBytes(String(res["signature"]), 64, "std");
    expect(
      await ed25519Verify(signature, new Uint8Array(tx.messageBytes), new Uint8Array(addrEnc.encode(publicKey))),
    ).toBe(true);

    const [screen] = h.ui.prompts("confirmSignTransaction");
    expect(screen && "summary" in screen && screen.summary.walletAddress).toBe(publicKey);
    expect(screen && "summary" in screen && screen.summary.instructions.length).toBe(1);
  });

  it("cancel at the confirm screen returns USER_CANCELLED with zero WebAuthn calls", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    const before = va.calls.get;
    h.ui.script("cancel");
    const res = await h.request("SIGN_TRANSACTION", {
      transaction: toB64(removeOwnerWire({ owner: publicKey })),
    });
    expect(errorCode(res)).toBe("USER_CANCELLED");
    expect(va.calls.get).toBe(before);
  });

  it.each(["NotAllowedError", "AbortError"] as const)(
    "fixes finding #7: closing the passkey prompt (%s) while signing is USER_CANCELLED, and nothing is signed",
    async (name) => {
      const h = harness();
      const { publicKey } = await createWallet(h);
      va.failNext(name, "get");
      const res = await h.request("SIGN_TRANSACTION", {
        transaction: toB64(removeOwnerWire({ owner: publicKey })),
      });
      expect(errorCode(res)).toBe("USER_CANCELLED");
      expect(h.posted.some((m) => m["type"] === "SIGN_TRANSACTION_RESULT")).toBe(false);
    },
  );

  it("a genuine authenticator failure while signing (SecurityError) stays AUTHENTICATION_FAILED", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    va.failNext("SecurityError", "get");
    const res = await h.request("SIGN_TRANSACTION", {
      transaction: toB64(removeOwnerWire({ owner: publicKey })),
    });
    expect(errorCode(res)).toBe("AUTHENTICATION_FAILED");
  });

  it("closing the passkey prompt during export is USER_CANCELLED", async () => {
    const h = harness();
    await createWallet(h);
    va.failNext("NotAllowedError", "get");
    const res = await h.request("EXPORT_PRIVATE_KEY");
    expect(errorCode(res)).toBe("USER_CANCELLED");
    expect(h.ui.prompts("showExportedSecret")).toHaveLength(0);
  });

  it("rejects a transaction the wallet is not a signer of (WALLET_MISMATCH) before any prompt", async () => {
    const h = harness();
    await createWallet(h);
    const before = va.calls.get;
    const res = await h.request("SIGN_TRANSACTION", {
      transaction: toB64(removeOwnerWire({ owner: randomAddress() })),
    });
    expect(errorCode(res)).toBe("WALLET_MISMATCH");
    expect(h.ui.prompts("confirmSignTransaction")).toHaveLength(0);
    expect(va.calls.get).toBe(before);
  });

  it("rejects a transaction where the wallet signs but another key is the instruction authority (POLICY_REJECTED)", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    const res = await h.request("SIGN_TRANSACTION", {
      transaction: toB64(removeOwnerWire({ owner: randomAddress(), feePayer: publicKey })),
    });
    expect(errorCode(res)).toBe("POLICY_REJECTED");
    expect(h.ui.prompts("confirmSignTransaction")).toHaveLength(0);
  });

  it("refuses to co-sign set_authority (the authority never signs it on-chain)", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    const res = await h.request("SIGN_TRANSACTION", {
      transaction: toB64(foreignProgramWire({ payer: publicKey })),
    });
    expect(errorCode(res)).toBe("POLICY_REJECTED");
  });

  it("refuses legacy/v0 transactions (MALFORMED_TRANSACTION)", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    const res = await h.request("SIGN_TRANSACTION", {
      transaction: toB64(lookupTableWire({ owner: publicKey })),
    });
    expect(errorCode(res)).toBe("MALFORMED_TRANSACTION");
  });

  it("fixes finding #2: non-base64 transaction text is MALFORMED_TRANSACTION, before any prompt", async () => {
    const h = harness();
    await createWallet(h);
    const before = va.calls.get;
    const res = await h.request("SIGN_TRANSACTION", { transaction: "@@not base64@@" });
    expect(errorCode(res)).toBe("MALFORMED_TRANSACTION");
    expect(h.ui.prompts("confirmSignTransaction")).toHaveLength(0);
    expect(va.calls.get).toBe(before);
  });

  it("dismissing the busy sheet while signing yields exactly one USER_CANCELLED and no signature", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    h.ui.script("dismiss-busy");
    const msg = h.message("SIGN_TRANSACTION", {
      transaction: toB64(removeOwnerWire({ owner: publicKey })),
    });
    h.send(msg);
    await h.waitFor(() => h.responsesFor(String(msg["requestId"]))[0]);
    await h.settle(50);
    expect(h.responsesFor(String(msg["requestId"])).map((m) => m["type"])).toEqual(["ERROR"]);
    expect(h.responsesFor(String(msg["requestId"]))[0]?.["code"]).toBe("USER_CANCELLED");
  });

  it("cold start: restores the wallet from backup, then signs as the restored key", async () => {
    const deviceA = harness();
    const { publicKey } = await createWallet(deviceA);
    const deviceB = harness({ api: deviceA.api });
    const res = await deviceB.request("SIGN_TRANSACTION", {
      transaction: toB64(removeOwnerWire({ owner: publicKey })),
    });
    expect(res).toMatchObject({ type: "SIGN_TRANSACTION_RESULT", publicKey });
    expect(deviceB.localBlob()).toBe(deviceA.localBlob());
  });

  it("cold start: a restored key that is not the transaction's authority is rejected and nothing is signed", async () => {
    const deviceA = harness();
    await createWallet(deviceA);
    const deviceB = harness({ api: deviceA.api });
    const res = await deviceB.request("SIGN_TRANSACTION", {
      transaction: toB64(removeOwnerWire({ owner: randomAddress() })),
    });
    expect(errorCode(res)).toBe("WALLET_MISMATCH");
    expect(deviceB.posted.some((m) => m["type"] === "SIGN_TRANSACTION_RESULT")).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// EXPORT_PRIVATE_KEY
// -----------------------------------------------------------------------------

describe("export private key", () => {
  it("shows the secret only inside the signer UI and posts just {completed:true}", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    const res = await h.request("EXPORT_PRIVATE_KEY");
    expect(Object.keys(res).sort()).toEqual(["completed", "requestId", "type"]);
    expect(res).toMatchObject({ type: "EXPORT_PRIVATE_KEY_RESULT", completed: true });

    const [shown] = h.ui.prompts("showExportedSecret");
    expect(shown && "publicKey" in shown && shown.publicKey).toBe(publicKey);
    const { getBase58Encoder } = await import("@solana/kit");
    const secret = new Uint8Array(getBase58Encoder().encode(shown && "secret" in shown ? shown.secret : ""));
    expect(secret).toHaveLength(64);
    expect(addr.decode(secret.slice(32))).toBe(publicKey);
  });

  it("cancel at the export warning returns USER_CANCELLED and shows no secret", async () => {
    const h = harness();
    await createWallet(h);
    h.ui.script("cancel");
    const res = await h.request("EXPORT_PRIVATE_KEY");
    expect(errorCode(res)).toBe("USER_CANCELLED");
    expect(h.ui.prompts("showExportedSecret")).toHaveLength(0);
  });

  it("cold start: exports after restoring from backup", async () => {
    const deviceA = harness();
    const { publicKey } = await createWallet(deviceA);
    const deviceB = harness({ api: deviceA.api });
    const res = await deviceB.request("EXPORT_PRIVATE_KEY");
    expect(res).toMatchObject({ type: "EXPORT_PRIVATE_KEY_RESULT", completed: true });
    const [shown] = deviceB.ui.prompts("showExportedSecret");
    expect(shown && "publicKey" in shown && shown.publicKey).toBe(publicKey);
  });
});

// -----------------------------------------------------------------------------
// Freshness / replay edges
// -----------------------------------------------------------------------------

describe("freshness and replay edges", () => {
  const T0 = 1_900_000_000_000;

  it("rejects a timestamp from the future beyond the freshness window", async () => {
    const h = harness({ now: () => T0 });
    h.send({ ...h.message("EXPORT_PRIVATE_KEY"), timestamp: T0 + REQUEST_FRESHNESS_WINDOW_MS + 1 });
    await h.settle();
    expect(h.posted.map((m) => m["code"])).toEqual(["REPLAY_REJECTED"]);
  });

  it.each([
    ["just inside the past edge", -REQUEST_FRESHNESS_WINDOW_MS],
    ["just inside the future edge", REQUEST_FRESHNESS_WINDOW_MS],
  ])("accepts a timestamp %s", async (_, skew) => {
    const h = harness({ now: () => T0 });
    // Non-base64 tx fails fast after the gate, proving the gate let it through.
    h.send({ ...h.message("SIGN_TRANSACTION", { transaction: "@@" }), timestamp: T0 + skew });
    await h.settle();
    expect(h.posted.map((m) => m["code"])).not.toContain("REPLAY_REJECTED");
  });

  it(`fixes finding #5: a requestId stays a replay while fresh, even after ${SEEN_REQUEST_IDS_LIMIT} newer requests`, async () => {
    const h = harness({ now: () => T0 });
    const first = h.message("SIGN_TRANSACTION", { transaction: "@@" });
    h.send(first);
    await h.waitFor(() => h.responsesFor(String(first["requestId"]))[0]);
    const codes: unknown[] = [];
    for (let i = 0; i < SEEN_REQUEST_IDS_LIMIT; i++) {
      const m = h.message("SIGN_TRANSACTION", { transaction: "@@" });
      h.send(m);
      codes.push((await h.waitFor(() => h.responsesFor(String(m["requestId"]))[0]))["code"]);
    }
    // The cache holds LIMIT fresh ids; the one past that is refused, nothing is evicted.
    expect(codes.slice(0, -1).every((c) => c === "MALFORMED_TRANSACTION")).toBe(true);
    expect(codes.at(-1)).toBe("SIGNER_BUSY");
    h.send(first); // same id, same (still fresh) timestamp
    await h.settle();
    expect(h.responsesFor(String(first["requestId"])).map((m) => m["code"])).toEqual([
      "MALFORMED_TRANSACTION",
      "REPLAY_REJECTED",
    ]);
  }, 30_000);
});

// -----------------------------------------------------------------------------
// Fuzz: arbitrary (well-routed) messages never break the one-response contract
// -----------------------------------------------------------------------------

describe("fuzz: dispatcher message handling", () => {
  /** mulberry32 — deterministic, so a failure reproduces with its seed. */
  function rng(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it.each([1, 2, 3])("seed %i: every message gets exactly one response and nothing throws", async (seed) => {
    const r = rng(seed);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
    const h = harness();
    const { publicKey } = await createWallet(h);
    const before = h.posted.length;
    const junk = [undefined, null, 0, -1, 1e308, "", "x".repeat(20_000), [], {}, true, "AAAA", "@@"];
    const types = ["AUTH_START", "SIGN_TRANSACTION", "EXPORT_PRIVATE_KEY", "NOPE", 7];
    let sent = 0;
    const validTx = toB64(removeOwnerWire({ owner: publicKey }));
    const wellFormed = (): Record<string, unknown> =>
      pick([
        () => h.message("AUTH_START", { authMode: "unlock" }),
        () => h.message("SIGN_TRANSACTION", { transaction: validTx }),
        () => h.message("SIGN_TRANSACTION", { transaction: toB64(removeOwnerWire({ owner: randomAddress() })) }),
        () => h.message("EXPORT_PRIVATE_KEY"),
      ])();
    for (let i = 0; i < 80; i++) {
      h.ui.resetScript().script(pick(["confirm", "cancel", "dismiss-busy", "dismiss-busy"] as const));
      let msg: unknown;
      if (r() < 0.5) {
        msg = wellFormed();
      } else {
        const m: Record<string, unknown> = { ...h.message(String(pick(types))) };
        const mutation = Math.floor(r() * 7);
        if (mutation === 0) m["protocolVersion"] = pick(junk);
        if (mutation === 1) m["requestId"] = pick(junk);
        if (mutation === 2) m["timestamp"] = pick(junk);
        if (mutation === 3) m[pick(["extra", "blob", "seed"])] = pick(junk);
        if (mutation === 4) m["transaction"] = pick([...junk, validTx]);
        if (mutation === 5) m["authMode"] = pick(["create", "unlock", "bogus", 1]);
        if (mutation === 6) m["credentialId"] = pick(junk);
        msg = r() < 0.9 ? m : pick(junk);
      }
      const posts = h.posted.length;
      const idles = h.ui.prompts("idle").length;
      h.send(msg);
      sent++;
      // One response per inbound message (valid or not). Gate rejections (and
      // SIGNER_BUSY) never enter a handler; everything else ends in
      // renderIdle(), so wait for that — a late second response (e.g. a
      // ceremony that kept going after a dismissal) would show up by then.
      await h.waitFor(() => (h.posted.length > posts ? true : undefined), 5_000);
      const gateCodes = ["INVALID_MESSAGE", "UNSUPPORTED_PROTOCOL", "REPLAY_REJECTED", "SIGNER_BUSY"];
      if (!gateCodes.includes(String(h.posted.at(-1)?.["code"]))) {
        await h.waitFor(() => (h.ui.prompts("idle").length > idles ? true : undefined), 5_000);
      }
      await h.settle(10);
      expect(h.posted.length - posts, `message #${i} (seed ${seed})`).toBe(1);
    }
    expect(h.posted.length - before).toBe(sent);
  }, 60_000);
});

// -----------------------------------------------------------------------------
// Mutation-driven: branches the mutation run showed were unasserted
// -----------------------------------------------------------------------------

describe("cold-start (no local blob) sign/export branches", () => {
  async function coldDevice() {
    const deviceA = harness();
    const wallet = await createWallet(deviceA);
    const deviceB = harness({ api: deviceA.api });
    return { deviceA, deviceB, wallet };
  }

  it.each(["SIGN_TRANSACTION", "EXPORT_PRIVATE_KEY"] as const)(
    "%s: a server blob for a different credential is refused as WALLET_MISMATCH",
    async (type) => {
      const { deviceA, deviceB, wallet } = await coldDevice();
      const other = await createWallet(harness({ api: deviceA.api }));
      va.selectNext(wallet.rawId);
      deviceA.api.restoreOverride = deviceA.api.blobs.get(other.credentialId)!;
      const fields = type === "SIGN_TRANSACTION" ? { transaction: toB64(removeOwnerWire({ owner: wallet.publicKey })) } : {};
      const res = await deviceB.request(type, fields);
      expect(errorCode(res)).toBe("WALLET_MISMATCH");
      expect(deviceB.localBlob()).toBeNull();
    },
  );

  it.each(["SIGN_TRANSACTION", "EXPORT_PRIVATE_KEY"] as const)(
    "%s: no backup on the server → exactly one NOT_FOUND",
    async (type) => {
      const { deviceA, deviceB, wallet } = await coldDevice();
      deviceA.api.blobs.clear();
      const fields = type === "SIGN_TRANSACTION" ? { transaction: toB64(removeOwnerWire({ owner: wallet.publicKey })) } : {};
      const msg = deviceB.message(type, fields);
      deviceB.send(msg);
      await deviceB.waitFor(() => deviceB.responsesFor(String(msg["requestId"]))[0]);
      await deviceB.settle(50);
      expect(deviceB.responsesFor(String(msg["requestId"])).map((m) => m["code"])).toEqual(["NOT_FOUND"]);
    },
  );

  it.each(["SIGN_TRANSACTION", "EXPORT_PRIVATE_KEY"] as const)(
    "%s: a restore challenge that cannot be minted fails with BLOB_UNAVAILABLE before any prompt",
    async (type) => {
      const { deviceA, deviceB, wallet } = await coldDevice();
      deviceA.api.failNext.issueRestoreChallenge = "BLOB_UNAVAILABLE";
      const fields = type === "SIGN_TRANSACTION" ? { transaction: toB64(removeOwnerWire({ owner: wallet.publicKey })) } : {};
      const res = await deviceB.request(type, fields);
      expect(errorCode(res)).toBe("BLOB_UNAVAILABLE");
      expect(deviceB.ui.prompts("confirmSignTransaction").length + deviceB.ui.prompts("confirmExportPrivateKey").length).toBe(0);
    },
  );

  it("SIGN_TRANSACTION: a policy-rejected tx is refused before any prompt or WebAuthn", async () => {
    const { deviceB, wallet } = await coldDevice();
    const before = va.calls.get;
    const res = await deviceB.request("SIGN_TRANSACTION", { transaction: toB64(foreignProgramWire({ payer: wallet.publicKey })) });
    expect(errorCode(res)).toBe("POLICY_REJECTED");
    expect(deviceB.ui.prompts("confirmSignTransaction")).toHaveLength(0);
    expect(va.calls.get).toBe(before);
  });

  it.each(["SIGN_TRANSACTION", "EXPORT_PRIVATE_KEY"] as const)(
    "%s: cancel at the confirm screen → USER_CANCELLED with zero WebAuthn calls",
    async (type) => {
      const { deviceB, wallet } = await coldDevice();
      const before = va.calls.get;
      deviceB.ui.script("cancel");
      const fields = type === "SIGN_TRANSACTION" ? { transaction: toB64(removeOwnerWire({ owner: wallet.publicKey })) } : {};
      expect(errorCode(await deviceB.request(type, fields))).toBe("USER_CANCELLED");
      expect(va.calls.get).toBe(before);
    },
  );

  it.each(["SIGN_TRANSACTION", "EXPORT_PRIVATE_KEY"] as const)(
    "%s: dismissing mid-ceremony yields exactly one USER_CANCELLED and no result",
    async (type) => {
      const { deviceB, wallet } = await coldDevice();
      deviceB.ui.script("dismiss-busy");
      const fields = type === "SIGN_TRANSACTION" ? { transaction: toB64(removeOwnerWire({ owner: wallet.publicKey })) } : {};
      const msg = deviceB.message(type, fields);
      deviceB.send(msg);
      await deviceB.waitFor(() => deviceB.responsesFor(String(msg["requestId"]))[0]);
      await deviceB.settle(60);
      expect(deviceB.responsesFor(String(msg["requestId"])).map((m) => m["code"] ?? m["type"])).toEqual(["USER_CANCELLED"]);
      expect(deviceB.ui.prompts("showExportedSecret")).toHaveLength(0);
    },
  );
});

describe("unlock/create error branches", () => {
  it("local unlock: a malformed backup challenge from the API fails closed (INTERNAL_ERROR), nothing PUT", async () => {
    const h = harness();
    await createWallet(h);
    h.api.malformedNext = "backup";
    const res = await h.request("AUTH_START", { authMode: "unlock" });
    expect(errorCode(res)).toBe("INTERNAL_ERROR");
    expect(h.api.puts()).toHaveLength(1); // only the create
  });

  it("remote restore: a malformed restore challenge fails as INVALID_MESSAGE before any prompt", async () => {
    const deviceA = harness();
    await createWallet(deviceA);
    const deviceB = harness({ api: deviceA.api });
    deviceA.api.malformedNext = "restore";
    expect(errorCode(await deviceB.request("AUTH_START", { authMode: "unlock" }))).toBe("INVALID_MESSAGE");
    expect(deviceB.ui.prompts("confirmImport")).toHaveLength(0);
  });

  it("local unlock: a WebAuthn failure offers a retry, and the retry succeeds", async () => {
    const h = harness();
    const { publicKey } = await createWallet(h);
    va.failNext("NotAllowedError", "get");
    h.ui.script("confirm", "retry", "confirm");
    const res = await h.request("AUTH_START", { authMode: "unlock" });
    expect(res).toMatchObject({ type: "AUTH_COMPLETE", publicKey, created: false });
    expect(h.ui.prompts("showRecoverable")).toHaveLength(1);
  });

  it("local unlock: a non-authentication failure is not offered as a retry (BLOB_UNAVAILABLE)", async () => {
    const h = harness();
    await createWallet(h);
    h.api.failNext.issueBackupChallenge = "BLOB_UNAVAILABLE";
    const res = await h.request("AUTH_START", { authMode: "unlock" });
    expect(errorCode(res)).toBe("BLOB_UNAVAILABLE");
    expect(h.ui.prompts("showRecoverable")).toHaveLength(0);
  });

  it("remote restore: an unknown passkey ends the request so the app can offer try again or create", async () => {
    const deviceA = harness();
    await createWallet(deviceA);
    deviceA.api.blobs.clear();
    const deviceB = harness({ api: deviceA.api });
    expect(errorCode(await deviceB.request("AUTH_START", { authMode: "unlock" }))).toBe("NOT_FOUND");
    expect(deviceB.ui.prompts("showRecoverable")).toHaveLength(0);
    expect(deviceA.api.calls.filter((c) => c.op === "restore")).toHaveLength(1);
  });

  it("remote restore: local storage that drops the write fails with INTERNAL_ERROR", async () => {
    const deviceA = harness();
    await createWallet(deviceA);
    const store = new MemoryBlobStore();
    store.mode = "drop-writes";
    const deviceB = harness({ api: deviceA.api, store });
    expect(errorCode(await deviceB.request("AUTH_START", { authMode: "unlock" }))).toBe("INTERNAL_ERROR");
  });

  it("remote restore: cancel at the confirm screen → USER_CANCELLED, no WebAuthn", async () => {
    const deviceA = harness();
    await createWallet(deviceA);
    const deviceB = harness({ api: deviceA.api });
    const before = va.calls.get;
    deviceB.ui.script("cancel");
    expect(errorCode(await deviceB.request("AUTH_START", { authMode: "unlock" }))).toBe("USER_CANCELLED");
    expect(va.calls.get).toBe(before);
  });

  it("create: cancel at the confirm screen → USER_CANCELLED, no WebAuthn", async () => {
    const h = harness();
    const reg = await registerOnApp();
    const before = va.calls.get;
    h.ui.script("cancel");
    const res = await h.request("AUTH_START", {
      authMode: "create",
      credentialId: reg.credentialId,
      webauthnAttestationObject: reg.attestationObject,
    });
    expect(errorCode(res)).toBe("USER_CANCELLED");
    expect(va.calls.get).toBe(before);
  });

  it.each(["NotAllowedError", "AbortError"] as const)(
    "create: a %s from the authenticator is treated as a cancel (recoverable, then USER_CANCELLED)",
    async (name) => {
      const h = harness();
      const reg = await registerOnApp();
      va.failNext(name, "get");
      const res = await h.request("AUTH_START", {
        authMode: "create",
        credentialId: reg.credentialId,
        webauthnAttestationObject: reg.attestationObject,
      });
      expect(errorCode(res)).toBe("USER_CANCELLED");
      expect(h.ui.prompts("showRecoverable")).toHaveLength(1);
    },
  );
});

describe("no unhandled promise rejections", () => {
  /** Collect unhandled rejections while `fn` runs (the browser logs these as "Uncaught (in promise)"). */
  async function unhandledDuring(fn: () => Promise<void>): Promise<unknown[]> {
    const seen: unknown[] = [];
    const onRejection = (reason: unknown) => seen.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      await fn();
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    return seen;
  }

  it("create: backup-challenge mint fails and the user cancels at confirm", async () => {
    const h = harness();
    const reg = await registerOnApp();
    h.api.failNext.issueBackupChallenge = "BLOB_UNAVAILABLE";
    h.ui.script("cancel");
    const seen = await unhandledDuring(async () => {
      const res = await h.request("AUTH_START", {
        authMode: "create",
        credentialId: reg.credentialId,
        webauthnAttestationObject: reg.attestationObject,
      });
      expect(errorCode(res)).toBe("USER_CANCELLED");
    });
    expect(seen).toEqual([]);
  });

  it.each(["confirm", "cancel"] as const)("local unlock: backup-challenge mint fails and the user presses %s", async (step) => {
    const h = harness();
    await createWallet(h);
    h.api.failNext.issueBackupChallenge = "BLOB_UNAVAILABLE";
    h.ui.script(step);
    const seen = await unhandledDuring(async () => {
      const res = await h.request("AUTH_START", { authMode: "unlock" });
      expect(errorCode(res)).toBe(step === "cancel" ? "USER_CANCELLED" : "BLOB_UNAVAILABLE");
    });
    expect(seen).toEqual([]);
  });
});
