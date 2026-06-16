import { p256 } from "@noble/curves/nist.js";
import { address, getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { findCardInstancePda } from "../instructions/mint";
import { parseTapSignature } from "../utils/verify";
import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey";

function pubkeyFromByte(byte: number) {
  return getAddressDecoder().decode(new Uint8Array(32).fill(byte));
}

function bufferToBase64URL(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("parseTapSignature", () => {
  it("reconstructs the signed counter || nonce message and round-trips a real signature", () => {
    const priv = p256.utils.randomSecretKey();
    const compressedPubkey = p256.getPublicKey(priv, true);

    const counter = 42;
    const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const message = new Uint8Array(12);
    message.set([0x00, 0x00, 0x00, 0x2a], 0); // 42 big-endian
    message.set(nonce, 4);

    const signature = p256.sign(message, priv);

    const params = new URLSearchParams({
      pk: bufferToBase64URL(compressedPubkey),
      s: bufferToBase64URL(signature),
      c: String(counter),
      n: bufferToBase64URL(nonce),
    });

    const tap = parseTapSignature(params);
    expect(tap.counter).toBe(counter);
    expect(Array.from(tap.message)).toEqual(Array.from(message));
    expect(tap.compressedPubkey.length).toBe(33);
    expect(tap.signature.length).toBe(64);
    expect(p256.verify(tap.signature, tap.message, tap.compressedPubkey)).toBe(
      true,
    );
  });

  it("rejects a counter outside the uint32 range", () => {
    const params = new URLSearchParams({
      pk: bufferToBase64URL(new Uint8Array(33).fill(0x02)),
      s: bufferToBase64URL(new Uint8Array(64)),
      c: String(0x1_0000_0000),
      n: bufferToBase64URL(new Uint8Array(8)),
    });
    expect(() => parseTapSignature(params)).toThrow(/uint32 range/);
  });
});

describe("PDAs", () => {
  it("findCardInstancePda uses x-only secp256r1 seed", async () => {
    const compressed = new Uint8Array(33);
    compressed[0] = 0x02;
    compressed.fill(7, 1);
    const secp256r1Pubkey = [compressed] as Secp256r1Pubkey;
    const cardInstance = await findCardInstancePda(secp256r1Pubkey);
    expect(cardInstance).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});
