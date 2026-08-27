import { describe, expect, it } from "vitest";
import { address, getAddressEncoder } from "@solana/kit";
import {
  getPhygitalTokenEncoder,
  getPhygitalTokenSize,
} from "../generated/index.js";
import {
  PHYGITAL_TOKEN_IDENTIFIER_OFFSET,
  PHYGITAL_TOKEN_MINT_OFFSET,
  PHYGITAL_TOKEN_OWNER_OFFSET,
} from "../utils/metadata.js";

const OWNER = address("G6kBnedts6uAivtY72ToaFHBs1UVbT9udiXmQZgMEjoF");
const MINT = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

function filledKey(fill: number): readonly [Uint8Array] {
  return [Uint8Array.from({ length: 33 }, () => fill)] as const;
}

describe("PhygitalToken memcmp offsets", () => {
  it("points owner, mint, and identifier at the zero-copy layout", () => {
    const publicKey = filledKey(0xaa);
    const identifier = filledKey(0xbb);
    const encoded = getPhygitalTokenEncoder().encode({
      owner: OWNER,
      mint: MINT,
      lastSignCount: 7,
      tokenType: 1,
      isLocked: 1,
      publicKey,
      identifier,
    });

    expect(encoded.length).toBe(getPhygitalTokenSize());
    expect(PHYGITAL_TOKEN_OWNER_OFFSET).toBe(8);
    expect(PHYGITAL_TOKEN_MINT_OFFSET).toBe(40);
    expect(PHYGITAL_TOKEN_IDENTIFIER_OFFSET).toBe(111);

    const addressBytes = getAddressEncoder();
    expect(
      encoded.subarray(
        PHYGITAL_TOKEN_OWNER_OFFSET,
        PHYGITAL_TOKEN_OWNER_OFFSET + 32,
      ),
    ).toEqual(addressBytes.encode(OWNER));
    expect(
      encoded.subarray(
        PHYGITAL_TOKEN_MINT_OFFSET,
        PHYGITAL_TOKEN_MINT_OFFSET + 32,
      ),
    ).toEqual(addressBytes.encode(MINT));
    expect(
      encoded.subarray(
        PHYGITAL_TOKEN_IDENTIFIER_OFFSET,
        PHYGITAL_TOKEN_IDENTIFIER_OFFSET + 33,
      ),
    ).toEqual(identifier[0]);
  });
});
