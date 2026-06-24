import { describe, expect, it } from "vitest";
import { encodeCtapCbor, decodeCbor } from "../utils/passkey/nfc/cbor.js";

const hex = (u: Uint8Array) =>
  Array.from(u)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

describe("minimal CBOR", () => {
  it("encodes small unsigned ints", () => {
    expect(hex(encodeCtapCbor(0))).toBe("00");
    expect(hex(encodeCtapCbor(1))).toBe("01");
    expect(hex(encodeCtapCbor(23))).toBe("17");
    expect(hex(encodeCtapCbor(24))).toBe("1818");
    expect(hex(encodeCtapCbor(255))).toBe("18ff");
    expect(hex(encodeCtapCbor(256))).toBe("190100");
  });

  it("encodes RFC 8949 sample map {a:1,b:[2,3]} in canonical order", () => {
    // 0xA2 61 61 01 61 62 82 02 03
    expect(hex(encodeCtapCbor({ b: [2, 3], a: 1 }))).toBe("a26161016162820203");
  });

  it("orders integer map keys numerically", () => {
    const m = new Map<number, unknown>([
      [2, new Uint8Array([0xaa])],
      [1, "rp"],
    ]);
    // A2 01 62 7270 02 41 aa
    expect(hex(encodeCtapCbor(m))).toBe("a2016272700241aa");
  });

  it("orders string keys by CTAP rule (length, then lexical): id < type, up < uv", () => {
    const cred = encodeCtapCbor({ type: "public-key", id: new Uint8Array([1]) });
    // map(2): "id"(6269) -> bytes(01) ; "type"(6474797065) -> "public-key"
    expect(hex(cred).startsWith("a262696441016474797065")).toBe(true);

    const opts = encodeCtapCbor({ uv: true, up: true });
    // "up" before "uv": A2 62 7570 f5 62 7576 f5
    expect(hex(opts)).toBe("a2627570f5627576f5");
  });

  it("roundtrips a getAssertion-style request map", () => {
    const clientDataHash = new Uint8Array(32).fill(7);
    const credId = new Uint8Array([1, 2, 3, 4]);
    const req = new Map<number, unknown>();
    req.set(1, "revibase.com");
    req.set(2, clientDataHash);
    req.set(3, [{ id: credId, type: "public-key" }]);
    req.set(5, { up: true, uv: false });

    const decoded = decodeCbor(encodeCtapCbor(req)) as Map<number, unknown>;
    expect(decoded.get(1)).toBe("revibase.com");
    expect(hex(decoded.get(2) as Uint8Array)).toBe(hex(clientDataHash));
    const allow = decoded.get(3) as Array<Record<string, unknown>>;
    expect(hex(allow[0].id as Uint8Array)).toBe(hex(credId));
    expect(allow[0].type).toBe("public-key");
    const opts = decoded.get(5) as Record<string, unknown>;
    expect(opts.up).toBe(true);
    expect(opts.uv).toBe(false);
  });

  it("decodes an assertion-style response map (int keys -> Map, nested -> object)", () => {
    const authData = new Uint8Array(37).fill(9);
    const sig = new Uint8Array([0x30, 0x44, 0x02]);
    const credId = new Uint8Array([5, 6, 7]);
    const resp = new Map<number, unknown>();
    resp.set(1, { id: credId, type: "public-key" });
    resp.set(2, authData);
    resp.set(3, sig);
    resp.set(5, 1);

    const decoded = decodeCbor(encodeCtapCbor(resp)) as Map<number, unknown>;
    expect(decoded instanceof Map).toBe(true);
    const cred = decoded.get(1) as Record<string, unknown>;
    expect(hex(cred.id as Uint8Array)).toBe(hex(credId));
    expect(hex(decoded.get(2) as Uint8Array)).toBe(hex(authData));
    expect(hex(decoded.get(3) as Uint8Array)).toBe(hex(sig));
    expect(decoded.get(5)).toBe(1);
  });

  it("decodes large byte strings (>255) with 2-byte length", () => {
    const big = new Uint8Array(300).fill(0xab);
    const decoded = decodeCbor(encodeCtapCbor(big)) as Uint8Array;
    expect(hex(decoded)).toBe(hex(big));
  });
});
