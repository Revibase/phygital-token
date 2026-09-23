import { describe, expect, it } from "vitest";
import { address, getAddressEncoder } from "@solana/kit";
import {
  getPhygitalTokenEncoder,
  getPhygitalTokenSize,
} from "../generated/index.js";

const LINKED_WALLET = address(
  "G6kBnedts6uAivtY72ToaFHBs1UVbT9udiXmQZgMEjoF",
);
const MINT = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const LINKED_WALLET_OFFSET = 8;
const MINT_OFFSET = 40;
const IDENTIFIER_OFFSET = 111;

function filledKey(fill: number): readonly [Uint8Array] {
  return [Uint8Array.from({ length: 33 }, () => fill)] as const;
}

describe("PhygitalToken memcmp offsets", () => {
  it("points linked_wallet, mint, and identifier at the zero-copy layout", () => {
    const publicKey = filledKey(0xaa);
    const identifier = filledKey(0xbb);
    const encoded = getPhygitalTokenEncoder().encode({
      linkedWallet: LINKED_WALLET,
      mint: MINT,
      lastSignCount: 7,
      tokenType: 1,
      isLocked: 1,
      publicKey,
      identifier,
    });

    expect(encoded.length).toBe(getPhygitalTokenSize());

    const addressBytes = getAddressEncoder();
    expect(
      encoded.subarray(LINKED_WALLET_OFFSET, LINKED_WALLET_OFFSET + 32),
    ).toEqual(addressBytes.encode(LINKED_WALLET));
    expect(encoded.subarray(MINT_OFFSET, MINT_OFFSET + 32)).toEqual(
      addressBytes.encode(MINT),
    );
    expect(
      encoded.subarray(IDENTIFIER_OFFSET, IDENTIFIER_OFFSET + 33),
    ).toEqual(identifier[0]);
  });
});
