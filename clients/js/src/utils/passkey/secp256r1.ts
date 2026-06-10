import {
  getAddressEncoder,
  getUtf8Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { DEFAULT_PUBKEY_BYTES, SECP256R1_PROGRAM_ADDRESS } from "../consts";
import { getSecp256r1VerifyInstruction } from "../../instructions/internal/secp256r1Verify";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { buildSecp256r1VerifyInputFromWebAuthn } from ".";

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encodeAddress(addressValue: Address): Uint8Array {
  return new Uint8Array(getAddressEncoder().encode(addressValue));
}

export type TransferTermsInput = {
  transferPrice: bigint;
  paymentTokenMint: Address | null;
  allowedRecipient: Address | null;
};

function encodeU64LE(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  let current = value;
  for (let i = 0; i < 8; i += 1) {
    bytes[i] = Number(current & 0xffn);
    current >>= 8n;
  }
  return bytes;
}

function encodeOptionalPubkey(value: Address | null): Uint8Array {
  return value ? encodeAddress(value) : new Uint8Array(DEFAULT_PUBKEY_BYTES);
}

export async function buildTransferMessageHash(input: {
  mint: Address;
  sender: Address;
  transferTerms: TransferTermsInput;
}): Promise<Uint8Array> {
  return sha256(
    concatBytes(
      encodeAddress(input.mint),
      encodeAddress(input.sender),
      encodeU64LE(input.transferTerms.transferPrice),
      encodeOptionalPubkey(input.transferTerms.paymentTokenMint),
      encodeOptionalPubkey(input.transferTerms.allowedRecipient),
    ),
  );
}

export async function buildTransferChallenge(input: {
  tokenProgram: Address;
  mint: Address;
  sender: Address;
  slotHash: Uint8Array;
  transferTerms: TransferTermsInput;
}): Promise<Uint8Array> {
  const messageHash = await buildTransferMessageHash({
    mint: input.mint,
    sender: input.sender,
    transferTerms: input.transferTerms,
  });

  return sha256(
    concatBytes(
      new Uint8Array(getUtf8Encoder().encode("transfer")),
      encodeAddress(input.tokenProgram),
      messageHash,
      new Uint8Array(input.slotHash),
    ),
  );
}

export type WebAuthnSecp256r1Verification = {
  secp256r1Verify: Instruction<typeof SECP256R1_PROGRAM_ADDRESS>;
  originIndex: number;
  crossOrigin: boolean;
  truncatedClientDataJson: Uint8Array;
};

export async function buildSecp256r1VerifyInstructionFromWebAuthn(input: {
  domainConfig: Address;
  response: AuthenticationResponseJSON;
  compressedPubkey: Uint8Array;
}): Promise<WebAuthnSecp256r1Verification> {
  const parsed = buildSecp256r1VerifyInputFromWebAuthn({
    response: input.response,
    compressedPubkey: input.compressedPubkey,
  });
 

  return {
    secp256r1Verify: getSecp256r1VerifyInstruction(parsed.verifyInput),
    originIndex: 0,
    crossOrigin: parsed.crossOrigin,
    truncatedClientDataJson: parsed.truncatedClientDataJson,
  };
}
