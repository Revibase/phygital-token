import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  bufferToBase64URLString,
  startAuthentication,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/browser";
import { type TransactionSigner, type Instruction } from "@solana/kit";
import { findAssociatedTokenAddress } from "../associatedToken.js";
import {
  RP_ID,
  TOKEN_2022_PROGRAM_ADDRESS,
  TRANSFER_HOOK_PROGRAM_ADDRESS,
} from "../consts.js";
import { getExecuteTransferInstructionAsync } from "../../generated/index.js";
import { type TransferSession } from "../../instructions/transfer.js";
import { buildSecp256r1VerifyInstructionFromWebAuthn } from "./secp256r1.js";

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function base64URLStringToBuffer(base64URLString: string): Uint8Array {
  const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64.padEnd(base64.length + padLength, "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function extractAdditionalFields(clientData: Record<string, unknown>) {
  const knownKeys = new Set(["type", "challenge", "origin", "crossOrigin"]);

  const remaining: Record<string, unknown> = {};
  for (const key in clientData) {
    if (!knownKeys.has(key)) {
      remaining[key] = clientData[key];
    }
  }

  if (Object.keys(remaining).length === 0) {
    return new Uint8Array();
  }

  const serialized = JSON.stringify(remaining);
  return new Uint8Array(new TextEncoder().encode(serialized.slice(1, -1)));
}

/**
 * Normalizes a raw 64-byte `r||s` P-256 ECDSA signature to its canonical
 * low-S form (`s <= n/2`).
 *
 * Hardware signers — NFC secure elements and platform authenticators — often
 * emit high-S signatures. They are valid ECDSA but non-canonical, and both
 * `@noble/curves` (default `lowS: true`) and Solana's secp256r1 precompile
 * reject them. Always run a raw signature through this before verifying or
 * before building an on-chain secp256r1 verify instruction.
 */
export function normalizeSignatureToLowS(signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) {
    throw new Error(
      `expected 64-byte raw r||s signature, got ${signature.length} bytes`,
    );
  }

  const order = p256.Point.CURVE().n;
  const halfOrder = order >> 1n;
  const sBig = BigInt(`0x${uint8ArrayToHex(signature.slice(32, 64))}`);
  if (sBig <= halfOrder) {
    return signature;
  }

  const sLow = order - sBig;
  const sPad = hexToUint8Array(sLow.toString(16).padStart(64, "0"));
  const normalized = new Uint8Array(64);
  normalized.set(signature.slice(0, 32), 0);
  normalized.set(sPad, 32);
  return normalized;
}

export function convertSignatureDERtoRS(signature: Uint8Array): Uint8Array {
  if (signature.length === 64) {
    return normalizeSignatureToLowS(signature);
  }

  if (signature[0] !== 0x30) {
    throw new Error("Invalid DER sequence");
  }

  const totalLength = signature[1];
  let offset = 2;

  if (totalLength > 0x80) {
    const lengthBytes = totalLength & 0x7f;
    offset += lengthBytes;
  }

  if (signature[offset] !== 0x02) {
    throw new Error("Expected INTEGER for r");
  }
  const rLen = signature[offset + 1];
  const rStart = offset + 2;
  const r = signature.slice(rStart, rStart + rLen);

  offset = rStart + rLen;
  if (signature[offset] !== 0x02) {
    throw new Error("Expected INTEGER for s");
  }
  const sLen = signature[offset + 1];
  const sStart = offset + 2;
  const s = signature.slice(sStart, sStart + sLen);

  const rStripped = r[0] === 0x00 && r.length > 32 ? r.slice(1) : r;
  const sStripped = s[0] === 0x00 && s.length > 32 ? s.slice(1) : s;

  if (rStripped.length > 32 || sStripped.length > 32) {
    throw new Error("r or s length > 32 bytes");
  }

  const rawSig = new Uint8Array(64);
  rawSig.set(rStripped, 32 - rStripped.length);
  rawSig.set(sStripped, 64 - sStripped.length);

  return normalizeSignatureToLowS(rawSig);
}

export function getSecp256r1Message(
  authResponse: AuthenticationResponseJSON,
): Uint8Array {
  const clientDataJSON = base64URLStringToBuffer(
    authResponse.response.clientDataJSON,
  );
  const authenticatorData = base64URLStringToBuffer(
    authResponse.response.authenticatorData,
  );
  const clientDataHash = sha256(clientDataJSON);
  return new Uint8Array([...authenticatorData, ...clientDataHash]);
}

export function parseWebAuthnClientData(clientDataJSON: string) {
  const parsed = JSON.parse(
    new TextDecoder().decode(base64URLStringToBuffer(clientDataJSON)),
  ) as Record<string, unknown>;
  return {
    origin: String(parsed.origin),
    crossOrigin: Boolean(parsed.crossOrigin),
    truncatedClientDataJson: extractAdditionalFields(parsed),
  };
}

