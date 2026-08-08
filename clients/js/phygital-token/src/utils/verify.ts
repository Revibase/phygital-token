import { p256 } from "@noble/curves/nist.js";
import {
  authenticateWithWebauthn,
  nfcWebAuthnRequestOptions,
  utf8ToBase64URLString,
  type AuthenticationResponseJSON,
} from "./passkey/webauthn.js";
import {
  base64URLStringToBuffer,
  convertSignatureDERtoRS,
  getSecp256r1Message,
  parseWebAuthnClientData,
} from "./passkey/internal.js";
import { authenticateWithApdu } from "./passkey/nfc/index.js";
import { parseSecp256r1Pubkey } from "../instructions/initialize.js";

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
 * Does not submit a transaction. After a successful verify, look up on-chain
 * state with `findAssetPda` + `fetchAsset` (PDA is seeded by the passkey).
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
