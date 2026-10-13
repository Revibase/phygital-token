/**
 * Property-based fuzzing of the attacker-facing decoders. Each must terminate
 * and fail only with its declared error type, and the parsers that guard the
 * same data must agree with each other.
 *
 * Runs are reproducible: the seed defaults to a fixed value and can be set
 * with FUZZ_SEED; a failure prints the seed and the shrunk counterexample.
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, DecodeError } from "./encoding.js";
import { BlobError, decodeWalletBlob, encodeWalletBlob } from "./keys/wallet-format.js";
import { validateInbound } from "./messaging/protocol.js";
import {
  decodeBase64UrlCapped,
  parseWalletBlobHeader,
  WalletBlobParseError,
} from "./shared/wallet-blob.js";
import { decodeTransaction, TxError } from "./tx/decode.js";

const RUNS = 4000;

beforeAll(() => {
  fc.configureGlobal({ seed: Number(process.env["FUZZ_SEED"] ?? 0x5eed), numRuns: RUNS });
});

function throwsOnly(fn: () => unknown, type: new (...args: never[]) => Error): boolean {
  try {
    fn();
    return true;
  } catch (e) {
    return e instanceof type;
  }
}

function accepts(fn: () => unknown): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

const validBlob = fc
  .record({
    publicKey: fc.uint8Array({ minLength: 32, maxLength: 32 }),
    credentialId: fc.uint8Array({ minLength: 1, maxLength: 64 }),
    kdfSalt: fc.uint8Array({ minLength: 32, maxLength: 32 }),
    iv: fc.uint8Array({ minLength: 12, maxLength: 12 }),
    ciphertext: fc.uint8Array({ minLength: 48, maxLength: 48 }),
  })
  .map((fields) => ({ fields, bytes: encodeWalletBlob(fields) }));

/** A valid blob with random byte flips and an optional truncation or extension. */
const mutatedBlob = fc
  .tuple(
    validBlob,
    fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), { maxLength: 4 }),
    fc.integer({ min: -8, max: 8 }),
  )
  .map(([{ bytes }, flips, resize]) => {
    const out = new Uint8Array(Math.max(0, bytes.length + resize));
    out.set(bytes.subarray(0, Math.min(bytes.length, out.length)));
    for (const [at, value] of flips) if (out.length) out[at % out.length] = value;
    return out;
  });

describe("wallet blob parsers", () => {
  it("decodeWalletBlob fails only with BlobError on arbitrary bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1200 }), (bytes) =>
        throwsOnly(() => decodeWalletBlob(bytes), BlobError),
      ),
    );
  });

  it("parseWalletBlobHeader fails only with WalletBlobParseError on arbitrary bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1200 }), (bytes) =>
        throwsOnly(() => parseWalletBlobHeader(bytes), WalletBlobParseError),
      ),
    );
  });

  it("the signer and the app worker accept exactly the same blobs", () => {
    fc.assert(
      fc.property(fc.oneof(mutatedBlob, fc.uint8Array({ maxLength: 400 })), (bytes) => {
        expect(accepts(() => parseWalletBlobHeader(bytes))).toBe(
          accepts(() => decodeWalletBlob(bytes)),
        );
      }),
    );
  });

  it("valid blobs round-trip", () => {
    fc.assert(
      fc.property(validBlob, ({ fields, bytes }) => {
        const parsed = decodeWalletBlob(bytes);
        expect(parsed.publicKey).toEqual(fields.publicKey);
        expect(parsed.credentialId).toEqual(fields.credentialId);
        expect(encodeWalletBlob(parsed)).toEqual(bytes);
      }),
    );
  });
});

describe("base64", () => {
  const b64ish = fc.string({
    unit: fc.constantFrom(
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=-_ \n!@#",
    ),
    maxLength: 64,
  });

  it("the strict decoder fails only with DecodeError", () => {
    fc.assert(
      fc.property(b64ish, fc.constantFrom("std" as const, "url" as const), (s, variant) =>
        throwsOnly(() => base64ToBytes(s, 4096, variant), DecodeError),
      ),
    );
  });

  it("blob upload decoding accepts exactly what the strict decoder accepts", () => {
    fc.assert(
      fc.property(
        b64ish.filter((s) => s.length > 0),
        (s) => {
          expect(accepts(() => decodeBase64UrlCapped(s, 4096))).toBe(
            accepts(() => base64ToBytes(s, 4096, "url")),
          );
        },
      ),
    );
  });

  it("encode then decode round-trips", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 200 }),
        fc.constantFrom("std" as const, "url" as const),
        (bytes, variant) => {
          expect(base64ToBytes(bytesToBase64(bytes, variant), 4096, variant)).toEqual(bytes);
        },
      ),
    );
  });
});

describe("transactions and messages", () => {
  it("decodeTransaction fails only with TxError", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4200 }), fc.boolean(), (bytes, asV1) => {
        // Bias half the inputs toward the v1 version byte to reach deeper paths.
        if (asV1 && bytes.length > 0) bytes[0] = 129;
        return throwsOnly(() => decodeTransaction(bytes), TxError);
      }),
    );
  });

  it("validateInbound never throws on arbitrary values", () => {
    fc.assert(
      fc.property(fc.anything(), (data) => {
        expect(typeof validateInbound(data).ok).toBe("boolean");
      }),
    );
  });
});
