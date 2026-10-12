import { describe, expect, it } from "vitest";
import { digestHex, SignerState } from "./state.js";

describe("SignerState", () => {
  it("rejects duplicate request ids", () => {
    let now = 1_000_000;
    const s = new SignerState(() => now);
    expect(s.checkFreshnessAndReplay("req-1", now)).toBeNull();
    s.remember("req-1", now);
    expect(s.checkFreshnessAndReplay("req-1", now)).toBe("REPLAY_REJECTED");
  });

  it("rejects stale timestamps", () => {
    let now = 1_000_000;
    const s = new SignerState(() => now);
    expect(s.checkFreshnessAndReplay("a", now)).toBeNull();
    expect(s.checkFreshnessAndReplay("b", now - 120_000)).toBe("REPLAY_REJECTED");
  });

  it("serializes operations (one active at a time)", () => {
    const s = new SignerState();
    expect(s.begin("SIGN_PENDING", "r1")).toBe(true);
    expect(s.isBusy()).toBe(true);
    expect(s.begin("AUTH_PENDING", "r2")).toBe(false); // busy
    s.end();
    expect(s.begin("AUTH_PENDING", "r2")).toBe(true);
  });

  it("authorization is single-use and digest-bound", async () => {
    const s = new SignerState();
    const digest = await digestHex(new Uint8Array([1, 2, 3]));
    s.authorize({
      operation: "SIGN_PENDING",
      requestId: "r1",
      walletPublicKey: new Uint8Array(32),
      messageDigest: digest,
      createdAt: 0,
    });
    // wrong digest -> null
    expect(
      s.consumeAuthorization({ operation: "SIGN_PENDING", requestId: "r1", messageDigest: "deadbeef" })
    ).toBeNull();
    // re-authorize, then correct consume works once
    s.authorize({
      operation: "SIGN_PENDING",
      requestId: "r1",
      walletPublicKey: new Uint8Array(32),
      messageDigest: digest,
      createdAt: 0,
    });
    expect(
      s.consumeAuthorization({ operation: "SIGN_PENDING", requestId: "r1", messageDigest: digest })
    ).not.toBeNull();
    // second consume -> null (single use)
    expect(
      s.consumeAuthorization({ operation: "SIGN_PENDING", requestId: "r1", messageDigest: digest })
    ).toBeNull();
  });

  it("authorization for one operation does not authorize another", async () => {
    const s = new SignerState();
    const digest = await digestHex(new Uint8Array([9]));
    s.authorize({
      operation: "SIGN_PENDING",
      requestId: "r1",
      walletPublicKey: new Uint8Array(32),
      messageDigest: digest,
      createdAt: 0,
    });
    expect(
      s.consumeAuthorization({
        operation: "PRIVATE_EXPORT_PENDING",
        requestId: "r1",
        messageDigest: digest,
      }),
    ).toBeNull();
  });

  it("rejects a duplicate id while an operation is active", () => {
    const s = new SignerState();
    const now = Date.now();
    expect(s.begin("AUTH_PENDING", "auth-req-1")).toBe(true);
    s.remember("auth-req-1", now);
    expect(s.checkFreshnessAndReplay("auth-req-1", now)).toBe("REPLAY_REJECTED");
  });
});

describe("SignerState hardening (mutation-driven)", () => {
  it("an authorization for one request cannot be consumed by another request with the same digest", async () => {
    const s = new SignerState();
    s.begin("SIGN_PENDING", "req-a");
    const d = await digestHex(new Uint8Array([1, 2, 3]));
    s.authorize({ operation: "SIGN_PENDING", requestId: "req-a", walletPublicKey: new Uint8Array(32), messageDigest: d, createdAt: 0 });
    expect(s.consumeAuthorization({ operation: "SIGN_PENDING", requestId: "req-b", messageDigest: d })).toBeNull();
  });

  it("fixes finding #5: a full cache of fresh ids refuses new requests instead of evicting one", async () => {
    const { SEEN_REQUEST_IDS_LIMIT } = await import("./constants.js");
    const now = 1_000_000;
    const s = new SignerState(() => now);
    for (let i = 0; i < SEEN_REQUEST_IDS_LIMIT - 1; i++) s.remember(`id-${i}`, now);
    expect(s.checkFreshnessAndReplay("new-1", now)).toBeNull();
    s.remember("new-1", now);
    expect(s.checkFreshnessAndReplay("new-2", now)).toBe("SIGNER_BUSY");
    // Nothing was forgotten: every held id is still a replay.
    expect(s.checkFreshnessAndReplay("id-0", now)).toBe("REPLAY_REJECTED");
    expect(s.checkFreshnessAndReplay("new-1", now)).toBe("REPLAY_REJECTED");
  });

  it("forgets an id only once its timestamp is past the freshness window", async () => {
    const { REQUEST_FRESHNESS_WINDOW_MS, SEEN_REQUEST_IDS_LIMIT } = await import("./constants.js");
    let now = 1_000_000;
    const s = new SignerState(() => now);
    for (let i = 0; i < SEEN_REQUEST_IDS_LIMIT; i++) s.remember(`id-${i}`, now);
    now += REQUEST_FRESHNESS_WINDOW_MS; // exactly at the edge: still fresh, still held
    expect(s.checkFreshnessAndReplay("id-0", now - REQUEST_FRESHNESS_WINDOW_MS)).toBe("REPLAY_REJECTED");
    expect(s.checkFreshnessAndReplay("new", now)).toBe("SIGNER_BUSY");
    now += 1; // past the window: the ids are dropped, and a replay of one is stale
    expect(s.checkFreshnessAndReplay("new", now)).toBeNull();
    expect(s.checkFreshnessAndReplay("id-0", now - REQUEST_FRESHNESS_WINDOW_MS - 1)).toBe("REPLAY_REJECTED");
  });

  it("holds a future-dated id until its own timestamp leaves the window", async () => {
    const { REQUEST_FRESHNESS_WINDOW_MS } = await import("./constants.js");
    let now = 1_000_000;
    const s = new SignerState(() => now);
    const ts = now + REQUEST_FRESHNESS_WINDOW_MS;
    s.remember("future", ts);
    now = ts + REQUEST_FRESHNESS_WINDOW_MS; // the message itself is still (just) fresh
    expect(s.checkFreshnessAndReplay("future", ts)).toBe("REPLAY_REJECTED");
  });

  it("remembering the same id twice does not consume an extra cache slot", async () => {
    const { SEEN_REQUEST_IDS_LIMIT } = await import("./constants.js");
    const now = 1_000_000;
    const s = new SignerState(() => now);
    s.remember("dup", now);
    s.remember("dup", now);
    for (let i = 1; i < SEEN_REQUEST_IDS_LIMIT - 1; i++) s.remember(`id-${i}`, now);
    expect(s.checkFreshnessAndReplay("dup", now)).toBe("REPLAY_REJECTED");
    expect(s.checkFreshnessAndReplay("one-more", now)).toBeNull();
  });

  it("isBusy reflects begin/end and the active request id", () => {
    const s = new SignerState();
    expect(s.isBusy()).toBe(false);
    expect(s.current).toBe("IDLE");
    s.begin("PRIVATE_EXPORT_PENDING", "r1");
    expect(s.isBusy()).toBe(true);
    expect(s.activeRequest()).toBe("r1");
    s.end();
    expect(s.isBusy()).toBe(false);
    expect(s.activeRequest()).toBeNull();
  });

  it("digestHex is lowercase hex SHA-256", async () => {
    expect(await digestHex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
