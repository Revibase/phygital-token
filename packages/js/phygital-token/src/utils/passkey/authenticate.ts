import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { PhygitalTokenError } from "../errors.js";
import { resolveCredentialId } from "./recoverCredentialId.js";
import { authenticateWithApdu } from "./nfc/index.js";
import {
  authenticateWithWebauthn,
  nfcWebAuthnRequestOptions,
  type AuthenticationResponseJSON,
} from "./webauthn.js";

export type NfcTransceive = (apdu: Uint8Array) => Promise<Uint8Array>;

export type AuthenticatePasskeyOptions = {
  /** Base64url compressed secp256r1 public keys. The tapped credential id must be in it; recovers a placeholder id locally when no `rpc` is given. */
  allowList?: ReadonlySet<string>;
  /** Recovers a placeholder id on-chain (preferred over `allowList` for recovery). */
  rpc?: Rpc<SolanaRpcApi>;
  /** Native IsoDep; skips browser WebAuthn. */
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
  throw new PhygitalTokenError(
    "RP_ID_REQUIRED",
    "Pass `rpId`; it cannot be inferred outside a browser."
  );
}

/** NFC tap via browser WebAuthn, or APDU when `transceive` is set. */
export async function authenticatePasskey(
  challenge: string,
  options?: AuthenticatePasskeyOptions
): Promise<AuthenticationResponseJSON> {
  const response = await performAuthentication(challenge, options);
  if (options?.transceive && !options.allowList) return response;
  return resolveCredentialId(response, {
    allowList: options?.allowList,
    rpc: options?.rpc,
  });
}

async function performAuthentication(
  challenge: string,
  options?: AuthenticatePasskeyOptions
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
      options.transceive
    );
  }

  return authenticateWithWebauthn(
    nfcWebAuthnRequestOptions(
      challenge,
      resolveBrowserRpId(options?.rpId),
      options?.credentialId
    )
  );
}
