import { describe, expect, it } from "vitest";

import { createWallet, type PrfProvider } from "../keys/wallet-service.js";
import { bytesToBase64, utf8ToBytes } from "../encoding.js";
import { sha256 } from "../keys/crypto.js";
import { handleVault, VAULT_COOKIE } from "./vault.js";

const ORIGIN = "https://signer.revibase.test";
const prfOutput = () => sha256(utf8ToBytes("k"));
const prf = {
  create: async () => ({ credentialId: new Uint8Array(16).fill(3), prfOutput: await prfOutput() }),
  get: async () => ({ prfOutput: await prfOutput() }),
} as unknown as PrfProvider;

async function blobB64() {
  const { blob } = await createWallet(prf, "signer.revibase.test", { userName: "a" });
  return bytesToBase64(blob, "url");
}

const put = (
  body: unknown,
  headers: Record<string, string> = { origin: ORIGIN, "sec-fetch-site": "same-origin" },
) =>
  handleVault(
    new Request(`${ORIGIN}/vault`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

describe("/vault", () => {
  it("stores the blob in a __Host-, HttpOnly, Partitioned, SameSite=None cookie", async () => {
    const encryptedWalletBlob = await blobB64();
    const res = await put({ encryptedWalletBlob });
    expect(res.status).toBe(204);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie.startsWith(`${VAULT_COOKIE}=${encryptedWalletBlob};`)).toBe(true);
    for (const attr of ["Path=/", "Secure", "HttpOnly", "SameSite=None", "Partitioned", "Max-Age="])
      expect(cookie).toContain(attr);
    expect(cookie).not.toContain("Domain=");
  });

  it("returns the stored blob to a same-origin read, and nothing without one", async () => {
    const encryptedWalletBlob = await blobB64();
    const get = (cookie?: string, site = "same-origin") =>
      handleVault(
        new Request(`${ORIGIN}/vault`, {
          headers: { "sec-fetch-site": site, ...(cookie ? { cookie } : {}) },
        }),
      );
    const res = await get(`other=1; ${VAULT_COOKIE}=${encryptedWalletBlob}`);
    expect(await res.json()).toEqual({ encryptedWalletBlob });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect((await get()).status).toBe(404);
    expect((await get(`${VAULT_COOKIE}=garbage`)).status).toBe(404);
    expect((await get(`${VAULT_COOKIE}=${encryptedWalletBlob}`, "same-site")).status).toBe(403);
  });

  it("refuses writes from any other origin or site, and anything that isn't a wallet blob", async () => {
    const encryptedWalletBlob = await blobB64();
    expect(
      (
        await put(
          { encryptedWalletBlob },
          { origin: "https://portal.revibase.test", "sec-fetch-site": "same-site" },
        )
      ).status,
    ).toBe(403);
    expect((await put({ encryptedWalletBlob }, {})).status).toBe(403);
    expect((await put({ encryptedWalletBlob: "not;a=blob" })).status).toBe(400);
    expect(
      (await put({ encryptedWalletBlob: bytesToBase64(new Uint8Array(40), "url") })).status,
    ).toBe(400);
    expect((await handleVault(new Request(`${ORIGIN}/vault`, { method: "DELETE" }))).status).toBe(
      405,
    );
  });
});
