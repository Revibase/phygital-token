import { describe, expect, it } from "vitest";
import { decodeBase64UrlCapped, MAX_BLOB_BYTES, WalletBlobParseError } from "./wallet-blob.js";

describe("decodeBase64UrlCapped", () => {
  it("accepts canonical unpadded base64url", () => {
    expect(decodeBase64UrlCapped("AQID", MAX_BLOB_BYTES)).toEqual(Uint8Array.from([1, 2, 3]));
  });

  // atob() accepted all of these, so the app worker and /vault would store a
  // blob string the signer's strict decoder later refuses.
  it.each([
    ["whitespace", "AQ ID"],
    ["a newline", "AQ\nID"],
    ["standard-alphabet characters", "+/+/"],
    ["non-canonical trailing bits", "AQJ"],
    ["excess padding", "AQ==="],
  ])("rejects %s", (_label, input) => {
    expect(() => decodeBase64UrlCapped(input, MAX_BLOB_BYTES)).toThrow(WalletBlobParseError);
  });

  it("rejects oversized input before decoding it all", () => {
    expect(() => decodeBase64UrlCapped("A".repeat(4000), 16)).toThrow("too_large");
  });
});
