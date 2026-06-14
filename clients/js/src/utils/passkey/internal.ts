import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bufferToBase64URLString, startAuthentication, type AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { Decoder } from "cbor-x";
import { address, TransactionSigner, type Instruction } from "@solana/kit";
import { findAssociatedTokenAddress } from "../associatedToken";
import { RP_ID, TOKEN_2022_PROGRAM_ADDRESS, TRANSFER_HOOK_PROGRAM_ADDRESS } from "../consts";
import { getExecuteTransferInstructionAsync } from "../../generated";
import { findCardInstancePda } from "../../instructions/mint";
import { TransferSession } from "../../instructions/transfer";
import { buildSecp256r1VerifyInstructionFromWebAuthn } from "./secp256r1";

const coseKeyDecoder = new Decoder({ mapsAsObjects: false });

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

export function convertSignatureDERtoRS(signature: Uint8Array): Uint8Array {
  if (signature.length === 64) {
    return signature;
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

  const rPad = new Uint8Array(32);
  rPad.set(rStripped, 32 - rStripped.length);

  const HALF_ORDER = p256.Point.CURVE().n >> 1n;
  const sBig = BigInt(`0x${uint8ArrayToHex(sStripped)}`);
  const sLow = sBig > HALF_ORDER ? p256.Point.CURVE().n - sBig : sBig;
  const sPad = hexToUint8Array(sLow.toString(16).padStart(64, "0"));

  return new Uint8Array([...rPad, ...sPad]);
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
  const parsed = JSON.parse(clientDataJSON) as Record<string, unknown>;
  return {
    origin: String(parsed.origin),
    crossOrigin: Boolean(parsed.crossOrigin),
    truncatedClientDataJson: extractAdditionalFields(parsed),
  };
}

function readCoseEs256CompressedPublicKey(bytes: Uint8Array): Uint8Array {
  const map = coseKeyDecoder.decode(bytes) as Map<number, Uint8Array>;
  const x = map.get(-2);
  const y = map.get(-3);
  if (!x || !y || x.length !== 32 || y.length !== 32) {
    throw new Error("Invalid ES256 COSE public key");
  }

  const compressed = new Uint8Array(33);
  compressed[0] = (y[31]! & 1) === 1 ? 0x03 : 0x02;
  compressed.set(x, 1);
  return compressed;
}

function extractCompressedPubkeyFromAuthResponse(
  response: AuthenticationResponseJSON,
): Uint8Array {
  const withPublicKey = response as AuthenticationResponseJSON & {
    publicKey?: string;
  };
  if (!withPublicKey.publicKey) {
    throw new Error(
      "WebAuthn assertion is missing a public key. Use a browser that exposes credential public keys.",
    );
  }

  const raw = base64URLStringToBuffer(withPublicKey.publicKey);
  if (raw.length === 33) {
    return raw;
  }

  return readCoseEs256CompressedPublicKey(raw);
}

export async function authenticateTransferPasskey(
  challenge: Uint8Array
): Promise<AuthenticationResponseJSON> {
  return startAuthentication({
    optionsJSON: {
      challenge: bufferToBase64URLString(
        new Uint8Array(challenge).buffer as ArrayBuffer,
      ),
      rpId: RP_ID,
      userVerification: "preferred",
      allowCredentials: [
        {
          id: "",
          type: "public-key",
          transports: ["nfc"],
        },
      ],
    },
  });
}

export async function buildTransferInstructions(
  session:TransferSession,
  webauthnResponse: AuthenticationResponseJSON,
  recipient:TransactionSigner
): Promise<Instruction[]> {
  const tokenProgram = TOKEN_2022_PROGRAM_ADDRESS;
  const compressedPubkey = extractCompressedPubkeyFromAuthResponse(
    webauthnResponse,
  );
  const expectedCardInstance = await findCardInstancePda([compressedPubkey]);
  if (address(expectedCardInstance) !== address(session.nft.cardInstance)) {
    throw new Error("Passkey public key does not match this card instance");
  }

  const { secp256r1Verify, origin, crossOrigin, truncatedClientDataJson } =
    await buildSecp256r1VerifyInstructionFromWebAuthn({
      response: webauthnResponse,
      compressedPubkey,
    });

  const recipientTokenAccount = await findAssociatedTokenAddress(
    recipient.address,
    session.nft.mint,
    tokenProgram,
  );
  const senderTokenAccount = await findAssociatedTokenAddress(
    session.nft.currentOwner,
    session.nft.mint,
    tokenProgram,
  );

  const executeTransfer = await getExecuteTransferInstructionAsync({
    recipient,
    sender: session.nft.currentOwner,
    cardInstance: session.nft.cardInstance,
    mint: session.nft.mint,
    senderTokenAccount,
    recipientTokenAccount,
    transferHookProgram: TRANSFER_HOOK_PROGRAM_ADDRESS,
    tokenProgram,
    signedMessageIndex: 0,
    slotNumber: session.slotNumber,
    origin,
    crossOrigin,
    truncatedClientDataJson,
  });

  return [secp256r1Verify, executeTransfer];
}
