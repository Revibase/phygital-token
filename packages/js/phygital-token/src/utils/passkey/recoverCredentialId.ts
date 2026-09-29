import type { Rpc, SolanaRpcApi } from "@solana/kit";

import { PhygitalTokenError } from "../errors.js";
import { buildSecp256r1Message } from "./internal.js";
import {
  base64URLStringToBuffer,
  bufferToBase64URLString,
  type Base64URLString,
  type AuthenticationResponseJSON,
} from "./webauthn.js";
import {
  recoverSecp256r1PublicKeyWithAllowList,
  recoverSecp256r1PublicKeyWithPhygitalToken,
} from "../pdas/token.js";

export const PLACEHOLDER_CREDENTIAL_ID_LENGTH = 16;

type AssertionLike = Pick<
  AuthenticationResponseJSON,
  "id" | "rawId" | "response"
>;

export type PlaceholderRecoveryOptions = {
  /** Gates the credential id; recovers a placeholder locally when no `rpc` is given. */
  allowList?: ReadonlySet<Base64URLString>;
  /** Recovers a placeholder on-chain. Takes precedence over `allowList` for recovery. */
  rpc?: Rpc<SolanaRpcApi>;
};

export async function resolveCredentialId<T extends AssertionLike>(
  response: T,
  { allowList, rpc }: PlaceholderRecoveryOptions
): Promise<T> {
  const rawId = base64URLStringToBuffer(response.rawId);
  let resolved: T = response;

  if (rawId.length === PLACEHOLDER_CREDENTIAL_ID_LENGTH) {
    if (!allowList && !rpc) {
      throw new PhygitalTokenError(
        "RECOVERY_SOURCE_REQUIRED",
        "Pass `rpc` (or `allowList`) so the tapped passkey can be identified."
      );
    }
    const signature = base64URLStringToBuffer(response.response.signature);
    const message = buildSecp256r1Message(
      base64URLStringToBuffer(response.response.authenticatorData),
      base64URLStringToBuffer(response.response.clientDataJSON)
    );
    const passkey = bufferToBase64URLString(
      rpc
        ? await recoverSecp256r1PublicKeyWithPhygitalToken(
            rpc,
            signature,
            message
          )
        : recoverSecp256r1PublicKeyWithAllowList(allowList!, signature, message)
    );
    resolved = { ...response, id: passkey, rawId: passkey };
  } else if (rawId.length !== 33) {
    throw new PhygitalTokenError(
      "INVALID_CREDENTIAL_ID",
      `The tag returned an unexpected credential id (${rawId.length} bytes; expected 16 or 33).`
    );
  }

  if (allowList && !allowList.has(resolved.id)) {
    throw new PhygitalTokenError(
      "PASSKEY_NOT_RECOGNIZED",
      "This tag is not in the allowed set of passkeys."
    );
  }
  return resolved;
}
