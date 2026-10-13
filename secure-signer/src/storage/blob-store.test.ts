import { describe, expect, it } from "vitest";
import { CookieVaultStore, readLocalBlob, writeLocalBlob } from "./blob-store.js";
import { handleVault, VAULT_COOKIE } from "./vault.js";
import { MemoryBlobStore } from "../../testing/memory-store.js";
import { createWallet, type PrfProvider, type PrfResult } from "../keys/wallet-service.js";
import { randomBytes, sha256 } from "../keys/crypto.js";

const utf8 = (s: string) => new TextEncoder().encode(s);

class MockPrf implements PrfProvider {
  constructor(private readonly secret: string) {}
  async create(_rpId: string, _opts: { userName: string }): Promise<PrfResult> {
    const credentialId = randomBytes(16);
    return { credentialId, prfOutput: await this.derive(credentialId) };
  }
  async get(_rpId: string, credentialId: Uint8Array): Promise<{ prfOutput: Uint8Array }> {
    return { prfOutput: await this.derive(credentialId) };
  }
  private derive(credentialId: Uint8Array): Promise<Uint8Array> {
    return sha256(new Uint8Array([...credentialId, ...utf8(this.secret)]));
  }
}

describe("blob-store", () => {
  const wallet = () => createWallet(new MockPrf("a"), "signer.example.com", { userName: "alice" });

  it("persists and reads a valid wallet blob", async () => {
    const { blob } = await wallet();
    const store = new MemoryBlobStore();
    expect(await writeLocalBlob(blob, store)).toBe(true);
    const read = await readLocalBlob(store);
    expect([...read!.raw]).toEqual([...blob]);
  });

  it("fails when the write does not round-trip (partitioned storage)", async () => {
    const { blob } = await wallet();
    const store = new MemoryBlobStore();
    store.mode = "drop-writes";
    expect(await writeLocalBlob(blob, store)).toBe(false);
  });

  it("fails closed when storage is unavailable or throws", async () => {
    const { blob } = await wallet();
    expect(await writeLocalBlob(blob, null)).toBe(false);
    const store = new MemoryBlobStore();
    store.mode = "throw";
    expect(await writeLocalBlob(blob, store)).toBe(false);
    expect(await readLocalBlob(store)).toBeNull();
  });

  it("ignores stored bytes that aren't a wallet blob", async () => {
    const store = new MemoryBlobStore();
    store.raw = new Uint8Array([1, 2, 3]);
    expect(await readLocalBlob(store)).toBeNull();
  });

  it("round-trips through the /vault partitioned cookie", async () => {
    const { blob } = await wallet();
    // A browser-like cookie jar in front of the real handler.
    let cookie: string | null = null;
    const origin = "https://signer.revibase.test";
    const fetchVault: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("origin", origin);
      headers.set("sec-fetch-site", "same-origin");
      if (cookie) headers.set("cookie", cookie);
      const res = await handleVault(
        new Request(new URL(String(input), origin), { ...init, headers }),
      );
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return res;
    };
    const store = new CookieVaultStore(fetchVault);
    expect(await readLocalBlob(store)).toBeNull();
    expect(await writeLocalBlob(blob, store)).toBe(true);
    expect(cookie).toMatch(new RegExp(`^${VAULT_COOKIE}=`));
    expect([...(await readLocalBlob(new CookieVaultStore(fetchVault)))!.raw]).toEqual([...blob]);
  });
});
