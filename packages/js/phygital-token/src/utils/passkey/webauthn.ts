import type { Rpc, SolanaRpcApi } from "@solana/kit";

import {
  PLACEHOLDER_CREDENTIAL_ID_LENGTH,
  recoverPlaceholderCredentialId,
} from "./recoverCredentialId.js";

/** Base64URL-encoded bytes (unpadded). */
export type Base64URLString = string;

export type PublicKeyCredentialRequestOptionsJSON = {
  challenge: Base64URLString;
  timeout?: number;
  rpId?: string;
  allowCredentials?: Array<{
    id: Base64URLString;
    type: PublicKeyCredentialType;
    transports?: Array<
      | "ble"
      | "cable"
      | "hybrid"
      | "internal"
      | "nfc"
      | "smart-card"
      | "usb"
    >;
  }>;
  userVerification?: UserVerificationRequirement;
  hints?: Array<"hybrid" | "security-key" | "client-device">;
  extensions?: AuthenticationExtensionsClientInputs;
};

export type AuthenticationResponseJSON = {
  id: Base64URLString;
  rawId: Base64URLString;
  response: {
    clientDataJSON: Base64URLString;
    authenticatorData: Base64URLString;
    signature: Base64URLString;
    userHandle?: Base64URLString;
  };
  authenticatorAttachment?: AuthenticatorAttachment;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  type: PublicKeyCredentialType;
};

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

export function utf8ToBase64URLString(value: string): Base64URLString {
  return bufferToBase64URLString(new TextEncoder().encode(value));
}

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

function toPublicKeyCredentialDescriptor(descriptor: {
  id: Base64URLString;
  type: PublicKeyCredentialType;
  transports?: string[];
}): PublicKeyCredentialDescriptor {
  const { id, transports, ...rest } = descriptor;
  return {
    ...rest,
    id: base64URLStringToArrayBuffer(id),
    ...(transports !== undefined
      ? { transports: transports as AuthenticatorTransport[] }
      : {}),
  };
}

export function nfcWebAuthnRequestOptions(
  challenge: Base64URLString,
  rpId: string,
  credentialId?: Base64URLString,
): PublicKeyCredentialRequestOptionsJSON {
  return {
    challenge,
    rpId,
    userVerification: "preferred",
    allowCredentials: [
      {
        id:
          credentialId ??
          bufferToBase64URLString(
            crypto.getRandomValues(
              new Uint8Array(PLACEHOLDER_CREDENTIAL_ID_LENGTH),
            ),
          ),
        type: "public-key",
        transports: ["nfc"],
      },
    ],
  };
}

/** `navigator.credentials.get`; recovers passkey via `rpc` when `rawId` is the 16-byte placeholder. */
export async function authenticateWithWebauthn(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON,
  rpc: Rpc<SolanaRpcApi>,
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

  const assertion: AuthenticationResponseJSON = {
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

  return recoverPlaceholderCredentialId(assertion, rpc);
}
