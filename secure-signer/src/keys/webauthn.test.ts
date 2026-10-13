import { afterEach, describe, expect, it, vi } from "vitest";

import { restoreWalletBlob } from "../storage/api-backup.js";
import { bytesToBase64 } from "../encoding.js";
import { BrowserPrfProvider, assertionToJSON } from "./webauthn.js";

/**
 * The PRF output is seed-equivalent: with it, the (public) blob decrypts. The
 * API is ciphertext-only storage, so PRF bytes must never reach it in any form.
 */

const PRF = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i);
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

/** Every plausible textual encoding of the PRF bytes. */
function prfEncodings(): string[] {
  return [
    bytesToBase64(PRF, "url"),
    bytesToBase64(PRF, "std"),
    Buffer.from(PRF).toString("hex"),
    JSON.stringify(Array.from(PRF)).slice(1, -1),
  ];
}

function fakeCredential(extensionResults: Record<string, unknown>): PublicKeyCredential {
  return {
    id: bytesToBase64(bytes(16, 1), "url"),
    rawId: bytes(16, 1).buffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: bytes(8, 2).buffer,
      authenticatorData: bytes(37, 3).buffer,
      signature: bytes(70, 4).buffer,
      userHandle: bytes(16, 5).buffer,
    },
    getClientExtensionResults: () => extensionResults,
  } as unknown as PublicKeyCredential;
}

// Raw ArrayBuffer (today's browsers) and a JSON-friendly base64url string
// (what a WebAuthn L3 `toJSON()`-style serializer would produce).
const EXTENSION_SHAPES: Array<[string, () => Record<string, unknown>]> = [
  ["ArrayBuffer", () => ({ prf: { results: { first: PRF.slice().buffer } } })],
  ["base64url string", () => ({ prf: { results: { first: bytesToBase64(PRF, "url") } } })],
];

function expectNoPrf(serialized: string): void {
  expect(serialized).not.toMatch(/prf/i);
  for (const enc of prfEncodings()) expect(serialized).not.toContain(enc);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assertionToJSON", () => {
  it.each(EXTENSION_SHAPES)("drops PRF extension output (%s)", (_, ext) => {
    const json = assertionToJSON(fakeCredential(ext()));
    expect(json.clientExtensionResults).toEqual({});
    expectNoPrf(JSON.stringify(json));
  });
});

describe("restore request", () => {
  it.each(EXTENSION_SHAPES)("never sends PRF output to the API (%s)", async (shape, ext) => {
    vi.stubGlobal("navigator", {
      credentials: { get: async () => fakeCredential(ext()) },
    });
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response(null, { status: 404 });
      }),
    );

    const disc = await new BrowserPrfProvider().getDiscoverable("localhost", bytes(32, 9));
    // The signer itself still gets the PRF output for unwrapping.
    if (shape === "ArrayBuffer") expect(disc.prfOutput).toEqual(PRF);

    await restoreWalletBlob({
      challengeId: "c1",
      assertion: disc.assertion,
    });

    expect(bodies).toHaveLength(1);
    expectNoPrf(bodies[0]!);
  });
});
