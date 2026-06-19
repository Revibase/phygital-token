// Vendored from @revibase/ctap2-js (getAssertion mapping only).
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import type { UserVerificationRequirement } from "@simplewebauthn/browser";
import { base64URLStringToBuffer } from "../internal.js";
import { ApduError } from "./errors.js";
import type { AuthenticatorGetAssertionRequest } from "./getAssertion.js";
import type { PublicKeyCredentialRequestOptionsJSONWithNfc } from "./types.js";
import { buildCollectedClientDataJSON } from "./clientData.js";

function userVerificationToOptionalUvBool(
  uv: UserVerificationRequirement | undefined,
): boolean | undefined {
  if (uv === "required") {
    return true;
  }
  if (uv === "discouraged") {
    return false;
  }
  return undefined;
}

function pickCtapExtensions(
  ext: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!ext) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ext)) {
    if (v == null) {
      continue;
    }
    if (k === "credProps") {
      continue;
    }
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function authenticatorGetAssertionRequestFromPublicKeyCredentialRequestOptionsJSON(
  args: PublicKeyCredentialRequestOptionsJSONWithNfc,
): AuthenticatorGetAssertionRequest {
  const {
    challenge,
    rpId,
    allowCredentials,
    userVerification,
    extensions,
    crossOrigin = false,
    topOrigin,
    origin,
  } = args;

  if (!rpId) throw new ApduError("WebAuthn options: rpId is required");

  const clientDataJSON = buildCollectedClientDataJSON("webauthn.get", {
    challenge,
    origin,
    crossOrigin,
    topOrigin,
  });
  const clientDataHash = sha256(utf8ToBytes(clientDataJSON));

  const uv = userVerificationToOptionalUvBool(userVerification);
  const uvOpts = uv === undefined ? undefined : { up: true as const, uv };

  const parsedExtensions = extensions
    ? pickCtapExtensions(extensions as Record<string, unknown> | undefined)
    : undefined;

  return {
    rpId,
    clientDataHash,
    allowCredentials: allowCredentials?.map((d) => ({
      id: new Uint8Array(base64URLStringToBuffer(d.id)),
      type: d.type ?? "public-key",
    })),
    extensions: parsedExtensions,
    options: uvOpts,
  };
}
