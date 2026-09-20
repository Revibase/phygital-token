import type { AuthenticationResponseJSON } from "../webauthn.js";
import {
  buildCborCommandApdu,
  buildSelectFidoApduSegments,
  splitExtendedApduForNfcTransmit,
  transceiveNfcCtap2Command,
} from "./apdu.js";
import { encodeAuthenticatorGetAssertionRequest } from "./getAssertion.js";
import { authenticatorGetAssertionRequestFromPublicKeyCredentialRequestOptionsJSON } from "./fromWebAuthnJson.js";
import { parseApduToAuthenticationResponse } from "./parseResponses.js";
import { ApduError } from "./errors.js";
import type { PublicKeyCredentialRequestOptionsJSONWithNfc } from "./types.js";

/**
 * Wraps `transceive` so failures and short reads get a stable {@link ApduError}
 * with API/phase in the message. Re-throws {@link ApduError} from lower layers unchanged.
 */
function nfcTransceiveFor(
  transceive: (apdu: Uint8Array) => Promise<Uint8Array>,
  phase: string,
): (apdu: Uint8Array) => Promise<Uint8Array> {
  const label = `authenticateWithApdu (${phase})`;
  return async (apdu) => {
    try {
      const resp = await transceive(apdu);
      if (resp.length < 2) {
        throw new ApduError(
          `${label}: response must include SW1/SW2 (got ${resp.length} byte(s))`,
        );
      }
      return resp;
    } catch (e) {
      if (e instanceof ApduError) {
        throw e;
      }
      throw new ApduError(
        `${label}: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
  };
}

async function runAuthenticateWithNfc(
  args: PublicKeyCredentialRequestOptionsJSONWithNfc,
  transceive: (apdu: Uint8Array) => Promise<Uint8Array>,
): Promise<AuthenticationResponseJSON> {
  await transceiveNfcCtap2Command(
    buildSelectFidoApduSegments(),
    nfcTransceiveFor(transceive, "SELECT FIDO"),
  );
  const apduResponse = await transceiveNfcCtap2Command(
    splitExtendedApduForNfcTransmit(
      buildCborCommandApdu(
        encodeAuthenticatorGetAssertionRequest(
          authenticatorGetAssertionRequestFromPublicKeyCredentialRequestOptionsJSON(
            args,
          ),
        ),
      ),
    ),
    nfcTransceiveFor(transceive, "getAssertion"),
  );
  return parseApduToAuthenticationResponse({ apduResponse, request: args });
}

/**
 * Native / kiosk NFC against a Java Card FIDO2 applet: SELECT FIDO AID, then
 * getAssertion with short APDU chaining + GET RESPONSE.
 *
 * Prefer the browser path (`authenticateWithNfc` in `webauthn.ts`) when
 * `navigator.credentials` is available. Use this when you have a raw IsoDep
 * `transceive` that receives a command APDU and resolves with the response
 * APDU (including SW1/SW2).
 */
export async function authenticateWithApdu(
  args: PublicKeyCredentialRequestOptionsJSONWithNfc,
  transceive: (apdu: Uint8Array) => Promise<Uint8Array>,
): Promise<AuthenticationResponseJSON> {
  try {
    return await runAuthenticateWithNfc(args, transceive);
  } catch (e) {
    if (e instanceof ApduError) {
      throw e;
    }
    throw new ApduError(
      `authenticateWithApdu: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
}
