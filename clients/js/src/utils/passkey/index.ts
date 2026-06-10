import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import {
  base64URLStringToBuffer,
  convertSignatureDERtoRS,
  getSecp256r1Message,
  parseWebAuthnClientData,
} from "./internal";

export {
  base64URLStringToBuffer,
  convertSignatureDERtoRS,
  extractAdditionalFields,
  getSecp256r1Message,
  parseWebAuthnClientData,
} from "./internal";

export {
  buildTransferChallenge,
  buildTransferMessageHash,
} from "./secp256r1";


export function buildSecp256r1VerifyInputFromWebAuthn(input: {
  response: AuthenticationResponseJSON;
  compressedPubkey: Uint8Array;
}) {
  const clientData = parseWebAuthnClientData(
    input.response.response.clientDataJSON,
  );
  const signature = convertSignatureDERtoRS(
    base64URLStringToBuffer(input.response.response.signature),
  );
  const message = getSecp256r1Message(input.response);

  return {
    verifyInput: [
      {
        publicKey: input.compressedPubkey,
        signature,
        message,
      },
    ],
    crossOrigin: clientData.crossOrigin,
    truncatedClientDataJson: clientData.truncatedClientDataJson,
    origin: clientData.origin,
  };
}
