import { buildSecp256r1Message } from "./internal.js";
import { recoverSecp256r1PublicKeyWithPhygitalToken } from "../pdas/token.js";
import type { Rpc, SolanaRpcApi } from "@solana/kit";

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

/** Random `allowCredentials` placeholder ids are 16 bytes; vault keys are 33 bytes. */
const PLACEHOLDER_CREDENTIAL_ID_LENGTH = 16;

/**
 * Browser WebAuthn request options for an NFC passkey assertion.
 * `challenge` is a base64url string. For on-chain verify, pass the base64url
 * encoding of `messageHash` (SHA-256 of `message`).
 * Callers must pass `rpId` (tap helpers default to `window.location.hostname`).
 *
 * Without `credentialId`, uses a random `allowCredentials` id so browsers show the NFC prompt.
 * With `credentialId`, passes that base64url compressed secp256r1 public key (e.g. transfer flow).
 * When the platform echoes a 16-byte placeholder id, {@link authenticateWithWebauthn} recovers the
 * public key from the signature and disambiguates via on-chain PhygitalToken PDAs.
 */
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
          bufferToBase64URLString(crypto.getRandomValues(new Uint8Array(PLACEHOLDER_CREDENTIAL_ID_LENGTH))),
        type: "public-key",
        transports: ["nfc"],
      },
    ],
  };
}

/**
 * Browser WebAuthn assertion via `navigator.credentials.get` (NFC / security key).
 *
 * @param rpc - Used to disambiguate secp256r1 public key recovery when `rawId` is 16 bytes
 *   (platform echoed the random placeholder instead of the 33-byte authenticator credential id).
 */
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

  const authenticatorData = bufferToBase64URLString(response.authenticatorData);
  const clientDataJSON = bufferToBase64URLString(response.clientDataJSON);
  const signature = bufferToBase64URLString(response.signature);

  let credentialId = credential.id;
  if (new Uint8Array(credential.rawId).length === PLACEHOLDER_CREDENTIAL_ID_LENGTH) {
    const signatureBytes = new Uint8Array(response.signature);
    const message = buildSecp256r1Message(
      new Uint8Array(response.authenticatorData),
      new Uint8Array(response.clientDataJSON),
    );
    credentialId = bufferToBase64URLString(
      await recoverSecp256r1PublicKeyWithPhygitalToken(
        rpc,
        signatureBytes,
        message,
      ),
    );
  }

  return {
    id: credentialId,
    rawId: credentialId,
    response: {
      authenticatorData,
      clientDataJSON,
      signature,
      userHandle,
    },
    type: credential.type as PublicKeyCredentialType,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment:
      (credential.authenticatorAttachment as AuthenticatorAttachment | null) ??
      undefined,
  };
}
