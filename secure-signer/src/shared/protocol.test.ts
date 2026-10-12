/**
 * Pins the host ↔ signer wire values. Both sides import these, so a change
 * here changes the protocol for deployed frames and hosts at once: bump
 * PROTOCOL_VERSION for anything a live peer would misread.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_MESSAGE_BYTES,
  MAX_SIGN_MESSAGE_BYTES,
  MAX_TX_BYTES,
  PROTOCOL_VERSION,
  REQUEST_ID_PATTERN,
  REQUEST_TYPES,
  RESULT_TYPE,
} from "./index";

describe("wire values", () => {
  it("pins the version, limits and the request → result mapping", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(MAX_MESSAGE_BYTES).toBe(16 * 1024);
    expect(MAX_TX_BYTES).toBe(4096);
    expect(MAX_SIGN_MESSAGE_BYTES).toBe(2048);
    expect(REQUEST_TYPES).toEqual(["SIGN_TRANSACTION", "SIGN_MESSAGE", "EXPORT_PRIVATE_KEY", "AUTH_START"]);
    expect(RESULT_TYPE).toEqual({
      SIGN_TRANSACTION: "SIGN_TRANSACTION_RESULT",
      SIGN_MESSAGE: "SIGN_MESSAGE_RESULT",
      EXPORT_PRIVATE_KEY: "EXPORT_PRIVATE_KEY_RESULT",
      AUTH_START: "AUTH_COMPLETE",
    });
  });

  it("accepts the host's request ids (32 random hex chars) and rejects unsafe ones", () => {
    const hostId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(REQUEST_ID_PATTERN.test(hostId)).toBe(true);
    for (const bad of ["", "short", "a".repeat(129), "has space", "semi;colon", "slash/abc"]) {
      expect(REQUEST_ID_PATTERN.test(bad)).toBe(false);
    }
  });
});
