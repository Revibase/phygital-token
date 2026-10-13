import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { PhygitalTokenError } from "../errors.js";
import { resolveCredentialId } from "./recoverCredentialId.js";
import {
  authenticateWithWebauthn,
  nfcWebAuthnRequestOptions,
  type AuthenticationResponseJSON,
} from "./webauthn.js";

export type AuthenticatePasskeyOptions = {
  /** Base64url compressed secp256r1 public keys. The tapped credential id must be in it; recovers a placeholder id locally when no `rpc` is given. */
  allowList?: ReadonlySet<string>;
  /** Recovers a placeholder id on-chain (preferred over `allowList` for recovery). */
  rpc?: Rpc<SolanaRpcApi>;
  /** Defaults to `window.location.hostname`. */
  rpId?: string;
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
    "Pass `rpId`; it cannot be inferred outside a browser.",
  );
}

/** NFC tap via browser WebAuthn. */
export async function authenticatePasskey(
  challenge: string,
  options?: AuthenticatePasskeyOptions,
): Promise<AuthenticationResponseJSON> {
  const response = await authenticateWithWebauthn(
    nfcWebAuthnRequestOptions(challenge, resolveBrowserRpId(options?.rpId), options?.credentialId),
  );
  return resolveCredentialId(response, {
    allowList: options?.allowList,
    rpc: options?.rpc,
  });
}
