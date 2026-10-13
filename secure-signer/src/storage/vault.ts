/**
 * `/vault` on the signer origin: keeps the encrypted wallet blob in a CHIPS
 * (partitioned) cookie, so it survives in the embedded iframe where Safari
 * clears partitioned localStorage and IndexedDB.
 *
 * The cookie is `__Host-`, Secure, HttpOnly, SameSite=None and Partitioned:
 * locked to this host, keyed to the top-level site embedding the signer, and
 * unreadable by any page script. Only the signer's own same-origin requests
 * may read or replace it; it holds ciphertext only (the RSS1 blob).
 *
 * Runs in the signer Worker (`worker.ts`) and the Vite dev server.
 */
import {
  decodeBase64UrlCapped,
  MAX_BLOB_BYTES,
  parseWalletBlobHeader,
} from "../shared/wallet-blob.js";

export const VAULT_PATH = "/vault";
export const VAULT_COOKIE = "__Host-vault_blob";
/** Browsers cap cookie lifetimes at 400 days; every unlock rewrites it. */
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });

function validBlob(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    parseWalletBlobHeader(decodeBase64UrlCapped(value, MAX_BLOB_BYTES));
    return true;
  } catch {
    return false;
  }
}

function readCookie(header: string | null): string | null {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === VAULT_COOKIE) return rest.join("=");
  }
  return null;
}

/** Same-origin only: no CORS headers are ever sent, and writes check Origin. */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  return request.headers.get("origin") === new URL(request.url).origin;
}

export async function handleVault(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin") return json({ error: "forbidden" }, 403);
    const blob = readCookie(request.headers.get("cookie"));
    return validBlob(blob)
      ? json({ encryptedWalletBlob: blob })
      : json({ error: "not_found" }, 404);
  }
  if (request.method === "PUT") {
    if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return json({ error: "bad_request" }, 415);
    let body: { encryptedWalletBlob?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "bad_request" }, 400);
    }
    if (!validBlob(body.encryptedWalletBlob)) return json({ error: "invalid_wallet_blob" }, 400);
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "no-store",
        "set-cookie": `${VAULT_COOKIE}=${body.encryptedWalletBlob}; Max-Age=${MAX_AGE_SECONDS}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`,
      },
    });
  }
  return json({ error: "method_not_allowed" }, 405, { allow: "GET, PUT" });
}
