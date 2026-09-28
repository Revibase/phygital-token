import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { authenticateWithApdu } from "./nfc/index.js";
import {
  authenticateWithWebauthn,
  nfcWebAuthnRequestOptions,
  type AuthenticationResponseJSON,
} from "./webauthn.js";

export type NfcTransceive = (apdu: Uint8Array) => Promise<Uint8Array>;

export type AuthenticatePasskeyOptions = {
  /** Kit `Rpc` for browser placeholder recovery. Not needed when `transceive` is set. */
  rpc?: Rpc<SolanaRpcApi>;
  /** Native IsoDep; skips browser WebAuthn (no `rpc` needed). */
  transceive?: NfcTransceive;
  /** Browser defaults to `window.location.hostname`. Optional for `transceive`. */
  rpId?: string;
  /** clientDataJSON origin for `transceive`. Optional (defaults to ""). */
  origin?: string;
  /** `allowCredentials` id when known. */
  credentialId?: string;
};

function resolveBrowserRpId(rpId: string | undefined): string {
  if (rpId) return rpId;
  if (typeof window !== "undefined" && window.location?.hostname) {
    return window.location.hostname;
  }
  throw new Error(
    "authenticatePasskey: pass `rpId` (no window.location available).",
  );
}

/** NFC tap via browser WebAuthn, or APDU when `transceive` is set. */
export async function authenticatePasskey(
  challenge: string,
  options?: AuthenticatePasskeyOptions,
): Promise<AuthenticationResponseJSON> {
  if (options?.transceive) {
    return authenticateWithApdu(
      {
        challenge,
        rpId: options.rpId ?? "",
        origin: options.origin ?? "",
        userVerification: "preferred",
        allowCredentials: [
          {
            id: options.credentialId ?? "",
            type: "public-key",
            transports: ["nfc"],
          },
        ],
      },
      options.transceive,
    );
  }

  if (!options?.rpc) {
    throw new Error(
      "authenticatePasskey: `rpc` is required for browser WebAuthn (passkey recovery).",
    );
  }

  return authenticateWithWebauthn(
    nfcWebAuthnRequestOptions(
      challenge,
      resolveBrowserRpId(options.rpId),
      options.credentialId,
    ),
    options.rpc,
  );
}
