import {
  Endian,
  getU32Encoder,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { p256 } from "@noble/curves/nist.js";
import {
  authenticateWithWebauthn,
  nfcWebAuthnRequestOptions,
  utf8ToBase64URLString,
  type AuthenticationResponseJSON,
  type Base64URLString,
} from "./passkey/webauthn.js";
import {
  base64URLStringToBuffer,
  convertSignatureDERtoRS,
  getSecp256r1Message,
  normalizeSignatureToLowS,
  parseWebAuthnClientData,
} from "./passkey/internal.js";
import { authenticateWithApdu } from "./passkey/nfc/index.js";
import { DEFAULT_VERIFY_DYNAMIC_URL_ENDPOINT } from "./consts.js";
import { parseSecp256r1Pubkey } from "../instructions/mint.js";

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
 * ## Authentication (`startAuthentication` + `verifyResponse`) — tap required
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
 * | What you pass in | URL params from an earlier scan | Challenge + WebAuthn response from {@link startAuthentication} |
 * | Typical use | Product pages, ownership lookup, links | Transfers, high-value actions, login |
 *
 * @packageDocumentation
 */

/** Result of {@link verifyResponse}. */
export type VerifyResponseResult = {
  isVerified: boolean;
  /** Base64url compressed secp256r1 vault key (not a Solana ed25519 address). */
  secp256r1PublicKey: string;
};

/** Options for {@link verifyResponse}. */
export type VerifyResponseOptions = {
  expectedMessage: string;
  response: AuthenticationResponseJSON;
};

export type VerifyDynamicUrlResult = VerifyResponseResult & {
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
 * holder is present (use {@link verifyResponse} for that).
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
 * {@link verifyDynamicUrl} when online, or {@link verifyResponse}
 * when you need to authenticate the holder with a live tap.
 *
 * @throws if the link is missing required params or they look wrong.
 */
export function verifyDynamicUrlWithoutCounterCheck(
  params: URLSearchParams,
): VerifyDynamicUrlResult {
  const secp256r1PublicKey = params.get("pk");
  const signature = params.get("s");
  const counter = params.get("c");
  const nonce = params.get("n");
  if (!secp256r1PublicKey || !signature || !counter || !nonce)
    throw new Error("Missing query params");

  const compressedPk = base64URLStringToBuffer(secp256r1PublicKey);
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
    secp256r1PublicKey,
    counter: currentCounter,
  };
}

/**
 * **Authentication (client)** — prompt an NFC tap for `message`.
 *
 * Browser: opens the system WebAuthn/NFC modal.
 * Native / kiosk: pass `transceive` to talk to an IsoDep reader via APDUs.
 */
export async function startAuthentication(
  message: string,
  transceive?: (apdu: Uint8Array) => Promise<Uint8Array>,
): Promise<AuthenticationResponseJSON> {
  const challenge = utf8ToBase64URLString(message);

  if (transceive) {
    return authenticateWithApdu(
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

  return authenticateWithWebauthn(nfcWebAuthnRequestOptions(challenge));
}

/**
 * **Authentication (server)** — verify a fresh tap signature.
 *
 * Call after {@link startAuthentication} on the client. Pass the same
 * `expectedMessage` you issued as the challenge and the WebAuthn `response`
 * from the tap. Treats `response.id` as the compressed secp256r1 public key
 * and checks the signature.
 *
 * Returns `{ isVerified, secp256r1PublicKey }`. Throws on challenge mismatch
 * (`Message mismatch.`); a bad signature returns `isVerified: false` instead
 * of throwing.
 *
 * Do not use this just to **identify** an asset from an old scan; for that use
 * {@link verifyDynamicUrl}.
 */
export function verifyResponse({
  expectedMessage,
  response,
}: VerifyResponseOptions): VerifyResponseResult {
  const expectedChallenge = utf8ToBase64URLString(expectedMessage);

  const clientData = parseWebAuthnClientData(response.response.clientDataJSON);

  if (clientData.challenge !== expectedChallenge) {
    throw new Error("Message mismatch.");
  }

  const signature = convertSignatureDERtoRS(
    base64URLStringToBuffer(response.response.signature),
  );
  const message = getSecp256r1Message(response);

  const isVerified = p256.verify(
    signature,
    message,
    new Uint8Array(parseSecp256r1Pubkey(response.id)[0]),
  );

  return {
    isVerified,
    secp256r1PublicKey: response.id,
  };
}
