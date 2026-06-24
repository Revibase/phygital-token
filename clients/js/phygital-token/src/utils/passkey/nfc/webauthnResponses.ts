import { utf8ToBytes } from "@noble/hashes/utils.js";
import { bufferToBase64URLString, type AuthenticationResponseJSON } from "@simplewebauthn/browser";
import type { AuthenticatorGetAssertionResponse } from "./getAssertion.js";
import { ApduError } from "./errors.js";
import { parseAuthenticatorDataExtensions } from "./authDataExtensions.js";

export function toAuthenticationResponseJSON(input: {
  assertion: AuthenticatorGetAssertionResponse;
  credentialId?: Uint8Array;
  clientDataJSON: string;
}): AuthenticationResponseJSON {
  const { assertion, credentialId: credentialIdArg, clientDataJSON } = input;

  const clientExtensionResults = parseAuthenticatorDataExtensions(
    assertion.authData,
  ) as AuthenticationExtensionsClientOutputs;

  const credBytes =
    assertion.credential?.id ??
    credentialIdArg ??
    (() => {
      throw new ApduError(
        "Assertion response missing credential id; set credentialId (base64url) on the request object or use a token that returns it in CBOR",
      );
    })();

  const idStr = bufferToBase64URLString(credBytes.buffer as ArrayBuffer);

  return {
    id: idStr,
    rawId: idStr,
    type: "public-key",
    clientExtensionResults,
    response: {
      clientDataJSON: bufferToBase64URLString(utf8ToBytes(clientDataJSON).buffer),
      authenticatorData: bufferToBase64URLString(assertion.authData.buffer as ArrayBuffer),
      signature: bufferToBase64URLString(assertion.signature.buffer as ArrayBuffer),
      userHandle:
        assertion.user?.id !== undefined
          ? bufferToBase64URLString(assertion.user.id.buffer as ArrayBuffer)
          : undefined,
    },
  };
}
