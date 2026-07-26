/**
 * Minimal WebAuthn JSON helpers used by this SDK.
 *
 * Replaces `@simplewebauthn/browser` for the narrow surface we need:
 * base64url encoding, JSON response types, and a thin
 * `navigator.credentials.get` wrapper (no conditional UI / autofill).
 */

/** Base64URL-encoded string (no padding). */
export type Base64URLString = string;

export type AuthenticatorTransportFuture =
  | "ble"
  | "cable"
  | "hybrid"
  | "internal"
  | "nfc"
  | "smart-card"
  | "usb";

export type PublicKeyCredentialDescriptorJSON = {
  id: Base64URLString;
  type: PublicKeyCredentialType;
  transports?: AuthenticatorTransportFuture[];
};

/** WebAuthn L3 JSON request options (subset). */
export type PublicKeyCredentialRequestOptionsJSON = {
  challenge: Base64URLString;
  timeout?: number;
  rpId?: string;
  allowCredentials?: PublicKeyCredentialDescriptorJSON[];
  userVerification?: UserVerificationRequirement;
  hints?: Array<"hybrid" | "security-key" | "client-device">;
  extensions?: AuthenticationExtensionsClientInputs;
};

export type AuthenticatorAssertionResponseJSON = {
  clientDataJSON: Base64URLString;
  authenticatorData: Base64URLString;
  signature: Base64URLString;
  userHandle?: Base64URLString;
};

/** WebAuthn L3 JSON authentication response (subset). */
export type AuthenticationResponseJSON = {
  id: Base64URLString;
  rawId: Base64URLString;
  response: AuthenticatorAssertionResponseJSON;
  authenticatorAttachment?: AuthenticatorAttachment;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  type: PublicKeyCredentialType;
};

/** Convert an ArrayBuffer or TypedArray view into a Base64URL string. */
export function bufferToBase64URLString(
  buffer: ArrayBuffer | ArrayBufferView,
): Base64URLString {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const chunkSize = 0x8000;
  let str = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** UTF-8 encode a string, then Base64URL-encode the bytes. */
export function utf8ToBase64URLString(value: string): Base64URLString {
  return bufferToBase64URLString(new TextEncoder().encode(value));
}

/** Decode a Base64URL string into bytes. */
export function base64URLStringToBuffer(base64URLString: string): Uint8Array {
  const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64.padEnd(base64.length + padLength, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64URLStringToArrayBuffer(base64URLString: string): ArrayBuffer {
  const bytes = base64URLStringToBuffer(base64URLString);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function toPublicKeyCredentialDescriptor(
  descriptor: PublicKeyCredentialDescriptorJSON,
): PublicKeyCredentialDescriptor {
  const { id, transports, ...rest } = descriptor;
  return {
    ...rest,
    id: base64URLStringToArrayBuffer(id),
    ...(transports !== undefined
      ? { transports: transports as AuthenticatorTransport[] }
      : {}),
  };
}

/**
 * Browser WebAuthn request options for an NFC passkey assertion.
 * When known, pass the asset's compressed secp256r1 public key as `credentialId`
 * (the authenticator uses that key as WebAuthn `credential.id` / `user.id`).
 * When omitted, a random placeholder id is used (discoverable / scanner flows
 * that do not know the key up front).
 */
export function nfcWebAuthnRequestOptions(
  challenge: Base64URLString,
  credentialId?: Base64URLString,
): PublicKeyCredentialRequestOptionsJSON {
  return {
    challenge,
    rpId: window.location.hostname,
    userVerification: "preferred",
    allowCredentials: [
      {
        id:
          credentialId ??
          bufferToBase64URLString(crypto.getRandomValues(new Uint8Array(64))),
        type: "public-key",
        transports: ["nfc"],
      },
    ],
  };
}

/**
 * Browser WebAuthn assertion via `navigator.credentials.get` (NFC / security key).
 * No conditional UI / autofill — options must include `challenge` and typically
 * NFC `allowCredentials` transports.
 */
export async function authenticateWithWebauthn(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON> {
  if (
    typeof window === "undefined" ||
    typeof window.PublicKeyCredential === "undefined"
  ) {
    throw new Error("WebAuthn is not supported in this browser");
  }

  let allowCredentials: PublicKeyCredentialDescriptor[] | undefined;
  if (optionsJSON.allowCredentials?.length !== 0) {
    allowCredentials = optionsJSON.allowCredentials?.map(
      toPublicKeyCredentialDescriptor,
    );
  }

  const publicKey: PublicKeyCredentialRequestOptions = {
    ...optionsJSON,
    challenge: base64URLStringToArrayBuffer(optionsJSON.challenge),
    allowCredentials,
  };

  const credential = (await navigator.credentials.get({
    publicKey,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Authentication was not completed");
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  let userHandle: Base64URLString | undefined;
  if (response.userHandle) {
    userHandle = bufferToBase64URLString(response.userHandle);
  }

  return {
    id: credential.id,
    rawId: bufferToBase64URLString(credential.rawId),
    response: {
      authenticatorData: bufferToBase64URLString(response.authenticatorData),
      clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      signature: bufferToBase64URLString(response.signature),
      userHandle,
    },
    type: credential.type as PublicKeyCredentialType,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment:
      (credential.authenticatorAttachment as AuthenticatorAttachment | null) ??
      undefined,
  };
}
