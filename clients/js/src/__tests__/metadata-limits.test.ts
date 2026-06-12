import { describe, expect, it } from "vitest";
import {
  MAX_METADATA_NAME_LEN,
  MAX_METADATA_SYMBOL_LEN,
  MAX_METADATA_URI_LEN,
  validateMetadataFields,
} from "../instructions/mint";

describe("validateMetadataFields", () => {
  it("accepts fields at max length", () => {
    expect(() =>
      validateMetadataFields({
        name: "n".repeat(MAX_METADATA_NAME_LEN),
        symbol: "s".repeat(MAX_METADATA_SYMBOL_LEN),
        uri: "u".repeat(MAX_METADATA_URI_LEN),
      }),
    ).not.toThrow();
  });

  it("rejects overlong name", () => {
    expect(() =>
      validateMetadataFields({
        name: "n".repeat(MAX_METADATA_NAME_LEN + 1),
        symbol: "NFT",
        uri: "https://example.com/x.json",
      }),
    ).toThrow(/Name must be at most/);
  });

  it("rejects overlong symbol", () => {
    expect(() =>
      validateMetadataFields({
        name: "nft",
        symbol: "s".repeat(MAX_METADATA_SYMBOL_LEN + 1),
        uri: "https://example.com/x.json",
      }),
    ).toThrow(/Symbol must be at most/);
  });

  it("rejects overlong uri", () => {
    expect(() =>
      validateMetadataFields({
        name: "nft",
        symbol: "NFT",
        uri: "u".repeat(MAX_METADATA_URI_LEN + 1),
      }),
    ).toThrow(/URI must be at most/);
  });
});
