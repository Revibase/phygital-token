/**
 * Accessory passkey login — message challenge, no SimpleWebAuthn ceremony setup.
 *
 * ```ts
 * const message = crypto.randomUUID();
 * const response = await startAuthentication(message, { rpc });
 * // native: startAuthentication(message, { transceive })
 * const { isVerified, secp256r1PublicKey } = verifyResponse({
 *   expectedMessage: message,
 *   response,
 * });
 * ```
 */
import { p256 } from "@noble/curves/nist.js";

import { PhygitalTokenError } from "./errors.js";
import { parseSecp256r1Pubkey } from "./parseSecp256r1Pubkey.js";
import {
  authenticatePasskey,
  type AuthenticatePasskeyOptions,
} from "./passkey/authenticate.js";
import {
  parseWebAuthnAssertion,
  parseWebAuthnClientData,
} from "./passkey/internal.js";
import {
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
 * Native / kiosk: pass `transceive` (`rpId`/`origin` optional).
 */
export async function startAuthentication(
  message: string,
  options?: AuthenticatePasskeyOptions
): Promise<AuthenticationResponseJSON> {
  return authenticatePasskey(utf8ToBase64URLString(message), options);
}

/**
 * **Authentication (server)** — verify a fresh tap signature.
 *
 * Pass the same `expectedMessage` you issued as the challenge, or — when the
 * challenge is raw bytes rather than text (e.g. a hash) — the base64url
 * `expectedChallenge` exactly as it was given to the authenticator. Treats
 * `response.id` as the compressed secp256r1 public key. Does not check
 * rpId/origin. Throws `MESSAGE_MISMATCH` when the signed challenge differs from
 * `expectedMessage` and `INVALID_ASSERTION` for a malformed response; a bad
 * signature returns `isVerified: false`.
 */
export function verifyResponse(
  input: { response: AuthenticationResponseJSON } & (
    | { expectedMessage: string; expectedChallenge?: never }
    | { expectedChallenge: string; expectedMessage?: never }
  )
): { isVerified: boolean; secp256r1PublicKey: string } {
  const expectedChallenge =
    input.expectedChallenge ?? utf8ToBase64URLString(input.expectedMessage);

  const clientData = parseWebAuthnClientData(
    input.response.response.clientDataJSON
  );

  if (clientData.challenge !== expectedChallenge) {
    throw new PhygitalTokenError(
      "MESSAGE_MISMATCH",
      "Message mismatch: the signed challenge does not match the expected message."
    );
  }

  const { signature, message } = parseWebAuthnAssertion(input.response);

  const isVerified = p256.verify(
    signature,
    message,
    new Uint8Array(parseSecp256r1Pubkey(input.response.id)[0])
  );

  return {
    isVerified,
    secp256r1PublicKey: input.response.id,
  };
}
