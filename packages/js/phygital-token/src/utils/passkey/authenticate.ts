import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { authenticateWithApdu } from "./nfc/index.js";
import {
  authenticateWithWebauthn,
  nfcWebAuthnRequestOptions,
  type AuthenticationResponseJSON,
  type Base64URLString,
} from "./webauthn.js";

/** IsoDep APDU transport for native / kiosk NFC readers. */
export type NfcTransceive = (apdu: Uint8Array) => Promise<Uint8Array>;

export type AuthenticatePasskeyOptions = {
  /**
   * Native / kiosk IsoDep reader. When set, skips browser WebAuthn (and does
   * not use `rpc`).
   */
  transceive?: NfcTransceive;
  /** Relying party ID for browser WebAuthn. Defaults to `window.location.hostname`. */
  rpId?: string;
  /**
   * Optional base64url credential id for browser `allowCredentials`
   * (e.g. transfer passkey). Ignored when `transceive` is set.
   */
  credentialId?: Base64URLString;
};

/**
 * Prompt an NFC tap: browser WebAuthn, or native APDU when `transceive` is set.
 *
 * @param challenge - Base64url WebAuthn challenge
 * @param rpc - Kit `Rpc` for browser placeholder credential-id recovery
 */
export async function authenticatePasskey(
  challenge: Base64URLString,
  rpc: Rpc<SolanaRpcApi>,
  options?: AuthenticatePasskeyOptions,
): Promise<AuthenticationResponseJSON> {
  if (options?.transceive) {
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
      options.transceive,
    );
  }

  const rpId = options?.rpId ?? window.location.hostname;
  return authenticateWithWebauthn(
    nfcWebAuthnRequestOptions(challenge, rpId, options?.credentialId),
    rpc,
  );
}
