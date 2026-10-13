/**
 * Signer → app worker passkey-wallet backup (`/api/signer/*`). Ciphertext
 * never crosses to the parent page. Challenges are minted here (signer
 * origin), not via the app. No cookies: every call authenticates itself.
 */

import {
  SIGNER_API_ROUTES,
  type ChallengeResponse,
  type WalletBlobPutRequest,
  type WalletBlobRestoreRequest,
  type WalletBlobRestoreResponse,
} from "./shared/api.js";
import { MAX_BLOB_BYTES } from "./constants.js";

export const API_BASE_URL: string = (() => {
  const fromEnv = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const host =
    typeof globalThis !== "undefined" && "location" in globalThis
      ? (globalThis as { location?: { hostname: string } }).location?.hostname
      : undefined;
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:5173";
  }
  return "https://portal.revibase.com";
})();

type Challenge = ChallengeResponse;

async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { code?: string };
    if (typeof body.code === "string" && body.code) return body.code;
  } catch {
    /* ignore */
  }
  return "BLOB_UNAVAILABLE";
}

/** Backup client bound to an API base URL and fetch (injectable for tests). */
export function createBackupApi(opts: { baseUrl: string; fetch?: typeof fetch }) {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const fetchImpl: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init));

  async function postJson<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json", accept: "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : { body: "{}" }),
    });
    if (!res.ok) throw new Error(await errorCode(res));
    return (await res.json()) as T;
  }

  async function issueBackupChallenge(): Promise<Challenge> {
    const body = await postJson<Partial<ChallengeResponse>>(SIGNER_API_ROUTES.backupChallenge);
    if (
      typeof body.challengeId !== "string" ||
      !body.challengeId ||
      typeof body.challenge !== "string" ||
      !body.challenge
    ) {
      throw new Error("BLOB_UNAVAILABLE");
    }
    return { challengeId: body.challengeId, challenge: body.challenge };
  }

  async function issueRestoreChallenge(): Promise<Challenge> {
    const body = await postJson<Partial<ChallengeResponse>>(SIGNER_API_ROUTES.restoreChallenge);
    if (
      typeof body.challengeId !== "string" ||
      !body.challengeId ||
      typeof body.challenge !== "string" ||
      !body.challenge
    ) {
      throw new Error("BLOB_UNAVAILABLE");
    }
    return { challengeId: body.challengeId, challenge: body.challenge };
  }

  async function restoreWalletBlob(params: {
    challengeId: string;
    assertion: Record<string, unknown>;
  }): Promise<{
    encryptedWalletBlob: string;
    publicKey: string;
  } | null> {
    const res = await fetchImpl(`${baseUrl}${SIGNER_API_ROUTES.restore}`, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        challengeId: params.challengeId,
        assertion: params.assertion,
      } satisfies WalletBlobRestoreRequest),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await errorCode(res));
    // Untrusted JSON: validated below.
    const body = (await res.json()) as Partial<WalletBlobRestoreResponse>;
    if (
      typeof body.encryptedWalletBlob !== "string" ||
      !body.encryptedWalletBlob ||
      body.encryptedWalletBlob.length > MAX_BLOB_BYTES * 2
    ) {
      throw new Error("BLOB_UNAVAILABLE");
    }
    return {
      encryptedWalletBlob: body.encryptedWalletBlob,
      publicKey: String(body.publicKey ?? ""),
    };
  }

  async function backupWalletBlob(params: {
    encryptedWalletBlob: string;
    publicKey: string;
    challengeId: string;
    signature: string;
    webauthnAttestationObject?: string;
  }): Promise<void> {
    const res = await fetchImpl(`${baseUrl}${SIGNER_API_ROUTES.blob}`, {
      method: "PUT",
      credentials: "omit",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        encryptedWalletBlob: params.encryptedWalletBlob,
        publicKey: params.publicKey,
        challengeId: params.challengeId,
        signature: params.signature,
        ...(params.webauthnAttestationObject
          ? { webauthnAttestationObject: params.webauthnAttestationObject }
          : {}),
      } satisfies WalletBlobPutRequest),
    });
    if (!res.ok) throw new Error(await errorCode(res));
  }

  return {
    issueBackupChallenge,
    issueRestoreChallenge,
    restoreWalletBlob,
    backupWalletBlob,
  };
}

const defaultClient = createBackupApi({ baseUrl: API_BASE_URL });

export const issueBackupChallenge = defaultClient.issueBackupChallenge;
export const issueRestoreChallenge = defaultClient.issueRestoreChallenge;
export const restoreWalletBlob = defaultClient.restoreWalletBlob;
export const backupWalletBlob = defaultClient.backupWalletBlob;

let feePayers: Promise<string[] | null> | null = null;

/**
 * Revibase's fee payers (the app's public `/api/sponsor`), so the confirm
 * screen can say "free" instead of an address. Display only: the policy
 * never depends on it. Fetched once; null if unreachable.
 */
export function fetchRevibaseFeePayers(
  fetchImpl: typeof fetch = (i, init) => fetch(i, init),
): Promise<string[] | null> {
  feePayers ??= fetchImpl(`${API_BASE_URL}/api/sponsor`, {
    credentials: "omit",
    signal: AbortSignal.timeout(3000),
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as { feePayers?: unknown };
      return Array.isArray(body.feePayers)
        ? body.feePayers.filter((a): a is string => typeof a === "string")
        : null;
    })
    .catch(() => null);
  return feePayers;
}
