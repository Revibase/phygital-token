import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bufferToBase64URLString, startAuthentication, type AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction, type ReadonlyUint8Array } from "@solana/kit";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  RP_ID,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "../consts";
import { getExecuteTransferInstructionAsync } from "../../generated";
import { TransferInput } from "../../instructions/transfer";
import type { TransferMintContext } from "../metadata";
import { buildSecp256r1VerifyInstructionFromWebAuthn } from "./secp256r1";

export function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToUint8Array(hex: string): Uint8Array {
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

export function extractAdditionalFields(clientData: Record<string, unknown>) {
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

export function parseOrigins(
  originsBytes: ReadonlyUint8Array,
  numOrigins: number,
): string[] {
  const origins: string[] = [];
  let cursor = 0;
  const decoder = new TextDecoder();

  for (let i = 0; i < numOrigins; i += 1) {
    if (cursor + 2 > originsBytes.length) {
      throw new Error("MaxLengthExceeded");
    }

    const strLen = originsBytes[cursor] | (originsBytes[cursor + 1] << 8);
    cursor += 2;

    if (cursor + strLen > originsBytes.length) {
      throw new Error("MaxLengthExceeded");
    }

    const strBytes = originsBytes.slice(cursor, cursor + strLen);
    origins.push(decoder.decode(strBytes));
    cursor += strLen;
  }

  return origins;
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

export async function findAssociatedTokenAddress(
  owner: Address,
  mint: Address,
  tokenProgram: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      getAddressEncoder().encode(owner),
      getAddressEncoder().encode(tokenProgram),
      getAddressEncoder().encode(mint),
    ],
  });
  return ata;
}
export async function authenticateTransferPasskey(input: {
  challenge: Uint8Array;
  secp256r1Pubkey: Uint8Array;
}): Promise<AuthenticationResponseJSON> {
  return startAuthentication({
    optionsJSON: {
      challenge: bufferToBase64URLString(
        new Uint8Array(input.challenge).buffer as ArrayBuffer,
      ),
      rpId: RP_ID,
      userVerification: "preferred",
      allowCredentials: [
        {
          id: bufferToBase64URLString(
            new Uint8Array(input.secp256r1Pubkey).buffer as ArrayBuffer,
          ),
          type: "public-key",
          transports: ["nfc", "usb", "ble", "internal"],
        },
      ],
    },
  });
}

export async function buildTransferInstructions(
  input: TransferInput & {
    currentOwner: Address;
    webauthnResponse: AuthenticationResponseJSON;
    slotNumber: bigint;
    mintContext: TransferMintContext;
  },
): Promise<Instruction[]> {
  const tokenProgram = TOKEN_2022_PROGRAM_ADDRESS;
  const recipientAddress = input.recipient.address;

  const { secp256r1Verify, originIndex, crossOrigin, truncatedClientDataJson } = await buildSecp256r1VerifyInstructionFromWebAuthn({
    domainConfig: input.mintContext.domainConfig,
    response: input.webauthnResponse,
    compressedPubkey: input.mintContext.secp256r1Pubkey,
  });

  const recipientTokenAccount = await findAssociatedTokenAddress(
    recipientAddress,
    input.mint,
    tokenProgram,
  );
  const senderTokenAccount = await findAssociatedTokenAddress(
    input.currentOwner,
    input.mint,
    tokenProgram,
  );

  let recipientPaymentTokenAccount: Address | undefined;
  let senderPaymentTokenAccount: Address | undefined;
  let groupOwnerPaymentTokenAccount: Address | undefined;
  let domainAuthorityPaymentTokenAccount: Address | undefined;
  let paymentTokenMint: Address | undefined;
  let paymentTokenProgram: Address = TOKEN_2022_PROGRAM_ADDRESS;

  if (input.mintContext.transferPrice > 0n &&
    input.mintContext.paymentTokenMint) {
    paymentTokenMint = input.mintContext.paymentTokenMint;
    paymentTokenProgram =
      input.mintContext.paymentTokenProgram ?? TOKEN_2022_PROGRAM_ADDRESS;
    recipientPaymentTokenAccount = await findAssociatedTokenAddress(
      recipientAddress,
      paymentTokenMint,
      paymentTokenProgram,
    );
    senderPaymentTokenAccount = await findAssociatedTokenAddress(
      input.currentOwner,
      paymentTokenMint,
      paymentTokenProgram,
    );
    groupOwnerPaymentTokenAccount = await findAssociatedTokenAddress(
      input.mintContext.groupOwner,
      paymentTokenMint,
      paymentTokenProgram,
    );
    domainAuthorityPaymentTokenAccount = await findAssociatedTokenAddress(
      input.mintContext.domainAuthority,
      paymentTokenMint,
      paymentTokenProgram,
    );
  }

  const executeTransfer = await getExecuteTransferInstructionAsync({
    recipient: input.recipient,
    sender: input.currentOwner,
    tokenMint: input.mint,
    groupMint: input.mintContext.groupMint,
    domainConfig: input.mintContext.domainConfig,
    senderTokenAccount,
    recipientTokenAccount,
    groupOwner: input.mintContext.groupOwner,
    domainAuthority: input.mintContext.domainAuthority,
    recipientPaymentTokenAccount,
    senderPaymentTokenAccount,
    groupOwnerPaymentTokenAccount,
    domainAuthorityPaymentTokenAccount,
    paymentTokenMint,
    paymentTokenProgram,
    tokenProgram,
    signedMessageIndex: 0,
    slotNumber: input.slotNumber,
    originIndex,
    crossOrigin,
    truncatedClientDataJson,
  });

  return [secp256r1Verify, executeTransfer];
}

