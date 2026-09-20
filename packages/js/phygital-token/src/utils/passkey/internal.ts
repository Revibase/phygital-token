import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  base64URLStringToBuffer,
  type AuthenticationResponseJSON,
} from "./webauthn.js";

const CURVE_ORDER = p256.Point.CURVE().n;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

type ParsedWebAuthnSignature = {
  noble: InstanceType<typeof p256.Signature>;
  compact: Uint8Array;
};

function isDerEcdsaSignature(signature: Uint8Array): boolean {
  return signature.length >= 2 && signature[0] === 0x30;
}

function parseWebAuthnSignature(
  signature: Uint8Array,
): ParsedWebAuthnSignature {
  if (signature.length === 64) {
    return {
      noble: p256.Signature.fromBytes(signature, "compact"),
      compact: signature,
    };
  }
  if (isDerEcdsaSignature(signature)) {
    const noble = p256.Signature.fromBytes(signature, "der");
    return { noble, compact: noble.toBytes("compact") };
  }
  throw new Error("expected 64-byte compact or DER ECDSA signature");
}

function normalizeSignatureToLowS(signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) {
    throw new Error(
      `expected 64-byte raw r||s signature, got ${signature.length} bytes`,
    );
  }

  const sig = p256.Signature.fromBytes(signature, "compact");
  if (!sig.hasHighS()) {
    return signature;
  }

  return new p256.Signature(sig.r, CURVE_ORDER - sig.s).toBytes("compact");
}

export function convertSignatureDERtoRS(signature: Uint8Array): Uint8Array {
  return normalizeSignatureToLowS(parseWebAuthnSignature(signature).compact);
}

/** WebAuthn signed payload: `authenticatorData || SHA-256(clientDataJSON)`. */
export function buildSecp256r1Message(
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
): Uint8Array {
  const clientDataHash = sha256(clientDataJSON);
  const message = new Uint8Array(
    authenticatorData.length + clientDataHash.length,
  );
  message.set(authenticatorData, 0);
  message.set(clientDataHash, authenticatorData.length);
  return message;
}

/** DER signature and signed message bytes from a WebAuthn assertion. */
export function parseWebAuthnAssertion(response: AuthenticationResponseJSON): {
  signature: Uint8Array;
  message: Uint8Array;
} {
  return {
    signature: convertSignatureDERtoRS(
      base64URLStringToBuffer(response.response.signature),
    ),
    message: buildSecp256r1Message(
      base64URLStringToBuffer(response.response.authenticatorData),
      base64URLStringToBuffer(response.response.clientDataJSON),
    ),
  };
}

export function recoverSecp256r1PublicKeyCandidates(
  signature: Uint8Array,
  message: Uint8Array,
): Uint8Array[] {
  const parsed = parseWebAuthnSignature(signature);
  const digest = sha256(message);
  const verifySignature = normalizeSignatureToLowS(parsed.compact);
  const candidates: Uint8Array[] = [];

  for (let recoveryId = 0; recoveryId < 4; recoveryId += 1) {
    try {
      const publicKey = parsed.noble
        .addRecoveryBit(recoveryId)
        .recoverPublicKey(digest)
        .toBytes(true);
      if (!p256.verify(verifySignature, message, publicKey)) {
        continue;
      }
      if (!candidates.some((candidate) => bytesEqual(candidate, publicKey))) {
        candidates.push(publicKey);
      }
    } catch {
      // invalid recovery id for this (r, s)
    }
  }

  return candidates;
}

type WebAuthnClientDataJson = {
  challenge?: unknown;
  origin?: unknown;
  crossOrigin?: unknown;
};

function readRequiredClientDataString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `WebAuthn clientDataJSON.${field} must be a non-empty string.`,
    );
  }
  return value;
}

export function parseWebAuthnClientData(clientDataJSON: string): {
  challenge: string;
  origin: string;
  crossOrigin: boolean;
} {
  let parsed: WebAuthnClientDataJson;
  try {
    parsed = JSON.parse(
      new TextDecoder().decode(base64URLStringToBuffer(clientDataJSON)),
    ) as WebAuthnClientDataJson;
  } catch {
    throw new Error("WebAuthn clientDataJSON must be valid JSON.");
  }

  return {
    challenge: readRequiredClientDataString(parsed.challenge, "challenge"),
    origin: readRequiredClientDataString(parsed.origin, "origin"),
    crossOrigin: parsed.crossOrigin === true,
  };
}
