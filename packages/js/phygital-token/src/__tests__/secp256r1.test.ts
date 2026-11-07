import { describe, expect, it } from "vitest";

import { getSecp256r1VerifyInstruction } from "../instructions/secp256r1Verify.js";

const entry = (fill: number, messageLength: number) => ({
  publicKey: new Uint8Array(33).fill(fill),
  signature: new Uint8Array(64).fill(fill + 1),
  message: new Uint8Array(messageLength).fill(fill + 2),
});

describe("getSecp256r1VerifyInstruction", () => {
  it("lays out one entry the way the program's test helper does", () => {
    const e = entry(1, 41);
    const { data, programAddress } = getSecp256r1VerifyInstruction([e]);
    expect(programAddress).toBe("Secp256r1SigVerify1111111111111111111111111");

    // programs/phygital-token/tests/common/secp256r1.rs: count, padding, then
    // sig offset, ix, pubkey offset, ix, message offset, size, ix — all inline.
    const u16 = (at: number) => data[at]! | (data[at + 1]! << 8);
    expect([data[0], data[1]]).toEqual([1, 0]);
    expect([2, 4, 6, 8, 10, 12, 14].map(u16)).toEqual([49, 0xffff, 16, 0xffff, 113, 41, 0xffff]);
    expect(data.subarray(16, 49)).toEqual(e.publicKey);
    expect(data.subarray(49, 113)).toEqual(e.signature);
    expect(data.subarray(113)).toEqual(e.message);
  });

  it("packs several entries back to back, entry i at signatureIndex i", () => {
    const { data } = getSecp256r1VerifyInstruction([entry(1, 41), entry(5, 10)]);
    const u16 = (at: number) => data[at]! | (data[at + 1]! << 8);
    expect(data[0]).toBe(2);
    const second = 2 + 14;
    const firstEnd = 30 + 33 + 64 + 41;
    expect(u16(second + 4)).toBe(firstEnd); // pubkey offset
    expect(u16(second + 10)).toBe(10); // message size
    expect(data.length).toBe(firstEnd + 33 + 64 + 10);
  });

  it("rejects an entry that isn't a 33-byte key and 64-byte signature", () => {
    expect(() =>
      getSecp256r1VerifyInstruction([{ ...entry(1, 1), signature: new Uint8Array(70) }]),
    ).toThrow(/64-byte/);
  });
});
