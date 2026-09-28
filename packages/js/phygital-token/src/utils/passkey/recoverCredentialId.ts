import type { Rpc, SolanaRpcApi } from "@solana/kit";

import { buildSecp256r1Message } from "./internal.js";
import {
  base64URLStringToBuffer,
  bufferToBase64URLString,
  type AuthenticationResponseJSON,
} from "./webauthn.js";
import { recoverSecp256r1PublicKeyWithPhygitalToken } from "../pdas/token.js";

export const PLACEHOLDER_CREDENTIAL_ID_LENGTH = 16;

type AssertionLike = Pick<
  AuthenticationResponseJSON,
  "id" | "rawId" | "response"
>;

/**
 * Rewrite `id`/`rawId` when the platform echoed the 16-byte NFC placeholder.
 * No-op if already 33 bytes.
 */
export async function recoverPlaceholderCredentialId<T extends AssertionLike>(
  response: T,
  rpc: Rpc<SolanaRpcApi>,
): Promise<T> {
  const rawId = base64URLStringToBuffer(response.rawId);
  if (rawId.length === 33) {
    return response;
  }
  if (rawId.length !== PLACEHOLDER_CREDENTIAL_ID_LENGTH) {
    throw new Error(
      `unexpected credential id length ${rawId.length} (expected 16 or 33)`,
    );
  }
  if (!rpc) {
    throw new Error(
      "`rpc` is required to recover a 16-byte placeholder credential id",
    );
  }

  const passkey = bufferToBase64URLString(
    await recoverSecp256r1PublicKeyWithPhygitalToken(
      rpc,
      base64URLStringToBuffer(response.response.signature),
      buildSecp256r1Message(
        base64URLStringToBuffer(response.response.authenticatorData),
        base64URLStringToBuffer(response.response.clientDataJSON),
      ),
    ),
  );

  return { ...response, id: passkey, rawId: passkey };
}
