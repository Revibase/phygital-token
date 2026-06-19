// Vendored from @revibase/ctap2-js (authentication branch only).
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { parseAuthenticatorGetAssertionResponse } from "./getAssertion.js";
import { buildCollectedClientDataJSON } from "./clientData.js";
import { toAuthenticationResponseJSON } from "./webauthnResponses.js";
import type { PublicKeyCredentialRequestOptionsJSONWithNfc } from "./types.js";

export function parseApduToAuthenticationResponse(input: {
  apduResponse: Uint8Array;
  request: PublicKeyCredentialRequestOptionsJSONWithNfc;
}): AuthenticationResponseJSON {
  const clientDataJSON = buildCollectedClientDataJSON("webauthn.get", {
    challenge: input.request.challenge,
    origin: input.request.origin,
    crossOrigin: input.request.crossOrigin ?? false,
    topOrigin: input.request.topOrigin,
  });
  const assertion = parseAuthenticatorGetAssertionResponse(input.apduResponse);
  return toAuthenticationResponseJSON({
    assertion,
    credentialId: assertion.credential?.id,
    clientDataJSON,
  });
}
