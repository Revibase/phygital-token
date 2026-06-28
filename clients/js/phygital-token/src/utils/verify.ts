import {
  Endian,
  getU32Encoder,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  base64URLStringToBuffer,
  convertSignatureDERtoRS,
  getSecp256r1Message,
  normalizeSignatureToLowS,
  parseWebAuthnClientData,
} from "./passkey/internal.js";
import { p256 } from "@noble/curves/nist.js";
import {
  startAuthentication,
  bufferToBase64URLString,
  type AuthenticationResponseJSON,
  type Base64URLString,
} from "@simplewebauthn/browser";
import { authenticateWithNfc } from "./passkey/nfc/index.js";
import { fetchAssetFromCredentialId } from "./assetCredential.js";

const DEFAULT_VERIFY_DYNAMIC_URL_ENDPOINT = `https://revibase.com/api/verifyAsset`;

/**
 * Two ways to check a phygital asset — **identification** vs **authentication**.
 *
 * ## Identification (`verifyDynamicUrl`) — no second tap
 *
 * Answers: **"Which asset is this?"**
 *
 * The user already tapped once and you have a signed link. You can confirm which
 * asset it belongs to **without asking them to tap again**. Think of it like
 * checking an ID card someone scanned earlier.
 *
 * ## Authentication (`verifyWithChallengeResponse`) — tap required
 *
 * Answers: **"Is the person with the key here right now?"**
 *
 * Ask the user to **tap their NFC key now**. The key must sign something fresh,
 * so you know the holder is physically present. Think of it like logging in with
 * a physical key, not just reading a badge from a photo.
 *
 * | | Identification | Authentication |
 * |---|---|---|
 * | Question | Which asset is this? | Is the holder here now? |
 * | User taps again? | No | Yes |
 * | What you pass in | URL params from an earlier scan | Challenge + WebAuthn response from {@link startAuthenticationWithChallengeResponse} |
 * | Typical use | Product pages, ownership lookup, links | Transfers, high-value actions, login |
 *
 * @packageDocumentation
 */

export type VerifyWithChallengeResponseResult = {
  publicKey: string;
  isVerified: boolean;
};

/** Options for {@link verifyWithChallengeResponse}. */
export type VerifyWithChallengeResponseOptions = {
  rpc: Rpc<SolanaRpcApi>;
  expectedMessage: string;
  response: AuthenticationResponseJSON;
  fetchPublicKeyFromCredentialIdCallback?: GetPublicKeyFromCredentialIdCallback;
};

export type VerifyDynamicUrlResult = VerifyWithChallengeResponseResult & {
  /** Included in the scanned URL; the server uses this to reject reused links. */
  counter: number;
};

/** Override where {@link verifyDynamicUrl} sends the scanned params (default: Revibase). */
export type VerifyDynamicUrlCallback = (
  params: URLSearchParams,
) => Promise<VerifyDynamicUrlResult>;

const defaultVerifyDynamicUrlCallback: VerifyDynamicUrlCallback = async (
  params,
) => {
  const url = new URL(DEFAULT_VERIFY_DYNAMIC_URL_ENDPOINT);
  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    const error = (await response.json()) as { error: string };
    throw new Error(error.error);
  }
  return (await response.json()) as VerifyDynamicUrlResult;
};

/**
 * **Identification** — confirm which asset a scan belongs to, with no second tap.
 *
 * Pass the query params from a signed link (e.g. `url.searchParams`). By default
 * they are sent to Revibase; pass `callback` to use your own server.
 *
 * Use this when you need to **identify** an asset — show product info, look up
 * ownership, or validate a link — not when you need to **authenticate** that the
 * holder is present (use {@link verifyWithChallengeResponse} for that).
 *
 * @see {@link verifyDynamicUrlWithoutCounterCheck} for the offline variant.
 */
export async function verifyDynamicUrl(
  params: URLSearchParams,
  callback: VerifyDynamicUrlCallback = defaultVerifyDynamicUrlCallback,
): Promise<VerifyDynamicUrlResult> {
  return callback(params);
}

/**
 * **Identification, offline** — same as {@link verifyDynamicUrl}, but no server.
 *
 * Checks the signature in the scanned link on the device only. Still identifies
 * which asset the link belongs to, but a copied link can be reused — so prefer
 * {@link verifyDynamicUrl} when online, or {@link verifyWithChallengeResponse}
 * when you need to authenticate the holder with a live tap.
 *
 * @throws if the link is missing required params or they look wrong.
 */
export function verifyDynamicUrlWithoutCounterCheck(
  params: URLSearchParams,
): VerifyDynamicUrlResult {
  const publicKey = params.get("pk");
  const signature = params.get("s");
  const counter = params.get("c");
  const nonce = params.get("n");
  if (!publicKey || !signature || !counter || !nonce)
    throw new Error("Missing query params");

  const compressedPk = base64URLStringToBuffer(publicKey);
  if (compressedPk.length !== 33) {
    throw new Error(
      `pk must be 33-byte compressed P-256 key, got ${compressedPk.length} bytes`,
    );
  }

  const randomBytes = base64URLStringToBuffer(nonce);
  if (randomBytes.length !== 8) {
    throw new Error(`n must be 8 bytes, got ${randomBytes.length} bytes`);
  }

  const rawSig = base64URLStringToBuffer(signature);
  if (rawSig.length !== 64) {
    throw new Error(
      `s must be 64-byte raw ECDSA signature, got ${rawSig.length} bytes`,
    );
  }

  const currentCounter = Number.parseInt(counter, 10);
  if (
    !Number.isInteger(currentCounter) ||
    currentCounter < 0 ||
    currentCounter > 0xffffffff
  ) {
    throw new Error(`counter out of uint32 range: ${currentCounter}`);
  }

  const counterBytes = getU32Encoder({ endian: Endian.Big }).encode(
    currentCounter,
  );

  const message = new Uint8Array(12);
  message.set(counterBytes, 0);
  message.set(randomBytes, 4);

  const normalizedSig = normalizeSignatureToLowS(rawSig);
  const isVerified = p256.verify(normalizedSig, message, compressedPk);

  return {
    isVerified,
    publicKey,
    counter: currentCounter,
  };
}

export type GetPublicKeyFromCredentialIdCallback = (
  credentialId: Base64URLString,
) => Promise<Base64URLString>;

export async function startAuthenticationWithChallengeResponse(
  message: string,
  transceive?: (apdu: Uint8Array) => Promise<Uint8Array>,
): Promise<AuthenticationResponseJSON> {
  const challenge = bufferToBase64URLString(
    new TextEncoder().encode(message).buffer as ArrayBuffer,
  );

  if (transceive) {
    return authenticateWithNfc(
      {
        challenge,
        rpId: "",
        userVerification: "preferred",
        origin: "",
        allowCredentials: [
          {
            id: "",
            type: "public-key",
            transports: ["nfc"],
          },
        ],
      },
      transceive,
    );
  }

  return startAuthentication({
    optionsJSON: {
      challenge,
      rpId: window.location.hostname,
      userVerification: "preferred",
      allowCredentials: [
        {
          id: "",
          type: "public-key",
          transports: ["nfc"],
        },
      ],
    },
  });
}

/**
 * **Authentication** — verify a fresh tap signature (server-side).
 *
 * Call after {@link startAuthenticationWithChallengeResponse} on the client.
 * Pass the same `expectedMessage` you issued as the challenge and the WebAuthn
 * `response` from the tap. Resolves the vault `publicKey` and checks the signature.
 *
 * Do not use this just to **identify** an asset from an old scan; for that use
 * {@link verifyDynamicUrl}.
 */
export async function verifyWithChallengeResponse({
  expectedMessage,
  response,
  fetchPublicKeyFromCredentialIdCallback,
  rpc,
}: VerifyWithChallengeResponseOptions): Promise<VerifyWithChallengeResponseResult> {
  const expectedChallenge = bufferToBase64URLString(
    new TextEncoder().encode(expectedMessage).buffer as ArrayBuffer,
  );

  const clientData = parseWebAuthnClientData(response.response.clientDataJSON);

  if (clientData.challenge !== expectedChallenge) {
    throw new Error("Invalid Signature.");
  }

  const signature = convertSignatureDERtoRS(
    base64URLStringToBuffer(response.response.signature),
  );
  const message = getSecp256r1Message(response);

  const publicKey = await (fetchPublicKeyFromCredentialIdCallback?.(
    response.id,
  ) ?? (await fetchAssetFromCredentialId(response.id, rpc)).publicKey);

  if (!publicKey) {
    throw new Error("Public key can't be found.");
  }

  const isVerified = p256.verify(
    signature,
    message,
    base64URLStringToBuffer(publicKey),
  );

  if (!isVerified) {
    throw new Error("Invalid Signature.");
  }

  return {
    isVerified,
    publicKey,
  };
}
