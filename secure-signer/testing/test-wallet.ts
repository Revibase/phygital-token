/**
 * A secure-signer holding a freshly created wallet, for other packages'
 * integration tests: a real dispatcher (createSignerHarness) whose passkey is a
 * virtual authenticator, plus `signRaw` — what a host's `SIGN_TRANSACTION`
 * round trip returns. Hosts wrap it in their own signer (e.g. the web app's
 * `createSecureSignerSigner`).
 *
 * Call from `beforeEach`: it stubs `navigator` (undo with `vi.unstubAllGlobals()`).
 */
import type { Address } from "@solana/kit";
import { VirtualAuthenticator, navigatorFor } from "./kit/index.js";
import { vi } from "vitest";

import { base64ToBytes, bytesToBase64 } from "../src/encoding.js";
import {
  createSignerHarness,
  PARENT_ORIGIN,
  RP_ID,
  SIGNER_ORIGIN,
  type SignerHarness,
} from "./harness.js";

export interface TestWallet {
  /** The wallet's ed25519 public key. */
  address: Address;
  signer: SignerHarness;
  va: VirtualAuthenticator;
  /** Sign serialized transaction bytes through the dispatcher (confirm screen scripted by `signer.ui`). */
  signRaw(tx: Uint8Array): Promise<{ signature: Uint8Array; publicKey: string }>;
}

export async function createTestWallet(seed: string): Promise<TestWallet> {
  const va = new VirtualAuthenticator({ seed, counter: "zero" });
  vi.stubGlobal("navigator", navigatorFor(va, SIGNER_ORIGIN));
  const signer = createSignerHarness({ rpId: RP_ID, parentOrigin: PARENT_ORIGIN });
  const cred = await va.create(
    {
      publicKey: {
        challenge: new Uint8Array(32),
        rp: { id: RP_ID, name: "Revibase" },
        user: { id: new Uint8Array(16).fill(1), name: "o", displayName: "o" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
      },
    },
    { origin: PARENT_ORIGIN },
  );
  const created = await signer.request("AUTH_START", {
    authMode: "create",
    credentialId: bytesToBase64(new Uint8Array(cred.rawId), "url"),
    webauthnAttestationObject: bytesToBase64(
      new Uint8Array(cred.response.attestationObject),
      "url",
    ),
  });
  if (created["type"] !== "AUTH_COMPLETE")
    throw new Error(`wallet create failed: ${JSON.stringify(created)}`);
  const address = String(created["publicKey"]) as Address;

  async function signRaw(tx: Uint8Array) {
    const res = await signer.request("SIGN_TRANSACTION", { transaction: bytesToBase64(tx, "std") });
    if (res["type"] === "ERROR") throw new Error(String(res["code"]));
    return {
      signature: base64ToBytes(String(res["signature"]), 64, "std"),
      publicKey: String(res["publicKey"]),
    };
  }
  return { address, signer, va, signRaw };
}
