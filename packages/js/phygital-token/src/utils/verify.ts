/**
 * Accessory passkey login — message challenge, no SimpleWebAuthn ceremony setup.
 *
 * ```ts
 * const message = crypto.randomUUID();
 * const response = await startAuthentication(message, { rpc });
 * const { isVerified, secp256r1PublicKey } = await verifyResponse({
 *   expectedMessage: message,
 *   expectedOrigin: "https://app.example.com",
 *   response,
 * });
 * ```
 */
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { equalBytes } from "@noble/curves/utils.js";

import { PhygitalTokenError } from "./errors.js";
import { parseSecp256r1Pubkey } from "./parseSecp256r1Pubkey.js";
import { authenticatePasskey, type AuthenticatePasskeyOptions } from "./passkey/authenticate.js";
import { parseWebAuthnAssertion, parseWebAuthnClientData } from "./passkey/internal.js";
import {
  base64URLStringToBuffer,
  utf8ToBase64URLString,
  type AuthenticationResponseJSON,
} from "./passkey/webauthn.js";

export type { AuthenticationResponseJSON } from "./passkey/webauthn.js";

/**
 * **Authentication (client)** — prompt an NFC tap for `message`.
 *
 * Browser: opens the system WebAuthn/NFC modal. Pass `rpc` to recover a
 * placeholder credential id on-chain, or `allowList` to recover it locally;
 * when `allowList` is passed, a tag outside it throws `PASSKEY_NOT_RECOGNIZED`.
 */
export async function startAuthentication(
  message: string,
  options?: AuthenticatePasskeyOptions,
): Promise<AuthenticationResponseJSON> {
  return authenticatePasskey(utf8ToBase64URLString(message), options);
}

/**
 * **Authentication (server)** — verify a fresh tap signature.
 *
 * Pass the same `expectedMessage` you issued as the challenge, or — when the
 * challenge is raw bytes rather than text (e.g. a hash) — the base64url
 * `expectedChallenge` exactly as it was given to the authenticator. Treats
 * `response.id` as the compressed secp256r1 public key.
 *
 * `expectedOrigin` is the origin (or origins) of the page that prompted the
 * tap, e.g. `https://app.example.com`. The browser writes it into the signed
 * `clientDataJSON`, so checking it stops another site from relaying your
 * challenge to a user and logging in with their tap.
 *
 * Throws `MESSAGE_MISMATCH` when the signed challenge differs from
 * `expectedMessage`, `ORIGIN_MISMATCH` when the tap came from another origin,
 * and `INVALID_ASSERTION` for a malformed response; a bad signature returns
 * `isVerified: false`. No RPC lookup is performed.
 */
export async function verifyResponse(
  input: {
    response: AuthenticationResponseJSON;
    expectedOrigin: string | readonly string[];
    /** The relying party the tap must be for (authenticatorData's rpIdHash). Recommended. */
    expectedRpId?: string;
  } & (
    | { expectedMessage: string; expectedChallenge?: never }
    | { expectedChallenge: string; expectedMessage?: never }
  ),
): Promise<{ isVerified: boolean; secp256r1PublicKey: string }> {
  const expectedChallenge = input.expectedChallenge ?? utf8ToBase64URLString(input.expectedMessage);

  const clientData = parseWebAuthnClientData(input.response.response.clientDataJSON);
  // A tap is an assertion: a registration response is something else entirely.
  if (clientData.type !== "webauthn.get") {
    throw new PhygitalTokenError("INVALID_ASSERTION", "This response is not a tap (webauthn.get).");
  }
  const authenticatorData = base64URLStringToBuffer(input.response.response.authenticatorData);
  if (authenticatorData.length < 37 || (authenticatorData[32]! & 0x01) === 0) {
    throw new PhygitalTokenError(
      "INVALID_ASSERTION",
      "The accessory didn't report the user was present.",
    );
  }
  if (
    input.expectedRpId !== undefined &&
    !equalBytes(
      authenticatorData.slice(0, 32),
      sha256(new TextEncoder().encode(input.expectedRpId)),
    )
  ) {
    throw new PhygitalTokenError("RP_ID_MISMATCH", "This tap was made for another site.");
  }

  if (clientData.challenge !== expectedChallenge) {
    throw new PhygitalTokenError(
      "MESSAGE_MISMATCH",
      "Message mismatch: the signed challenge does not match the expected message.",
    );
  }

  const expectedOrigins: readonly string[] =
    typeof input.expectedOrigin === "string" ? [input.expectedOrigin] : input.expectedOrigin;
  if (!expectedOrigins.includes(clientData.origin)) {
    throw new PhygitalTokenError("ORIGIN_MISMATCH", "This tap was made on another site.");
  }

  const { signature, message } = parseWebAuthnAssertion(input.response);

  const isVerified = p256.verify(
    signature,
    message,
    new Uint8Array(parseSecp256r1Pubkey(input.response.id)[0]),
  );

  return {
    isVerified,
    secp256r1PublicKey: input.response.id,
  };
}
