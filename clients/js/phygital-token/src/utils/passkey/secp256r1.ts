import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { getAddressEncoder, type Address, type Instruction } from "@solana/kit";
import { getSecp256r1VerifyInstruction } from "../../instructions/internal/secp256r1Verify.js";
import { SECP256R1_PROGRAM_ADDRESS, TRANSFER_ACTION_BYTES, VERIFY_ACTION_BYTES } from "../consts.js";
import {
  base64URLStringToBuffer,
  convertSignatureDERtoRS,
  getClientDataJsonBytes,
  getSecp256r1Message,
} from "./internal.js";
import { type TransferSession } from "../../instructions/transfer.js";
import { sha256 } from "@noble/hashes/sha2.js";

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

function buildSecp256r1VerifyInputFromWebAuthn(input: {
  publicKey: string;
  response: AuthenticationResponseJSON;
}) {
  const signature = convertSignatureDERtoRS(
    base64URLStringToBuffer(input.response.response.signature),
  );
  const message = getSecp256r1Message(input.response);

  return {
    verifyInput: [
      {
        publicKey: base64URLStringToBuffer(input.publicKey),
        signature,
        message,
      },
    ],
  };
}

async function buildTransferMessageHash(input: {
  recipient: Address;
}): Promise<Uint8Array> {
  return sha256(
    concatBytes(encodeAddress(input.recipient)),
  );
}

async function buildVerifyMessageHash(input: {
  message: string;
}): Promise<Uint8Array> {
  return sha256(
    concatBytes(new TextEncoder().encode(input.message)),
  );
}

export async function buildTransferChallenge(input: {
  recipient: Address;
  slotHash: Uint8Array;
}): Promise<Uint8Array> {
  const messageHash = await buildTransferMessageHash({
    recipient: input.recipient,
  });

  return sha256(
    concatBytes(
      TRANSFER_ACTION_BYTES,
      messageHash,
      new Uint8Array(input.slotHash),
    ),
  );
}


export async function buildVerifyMessage(input: {
  message: string;
  slotHash: Uint8Array;
}): Promise<Uint8Array> {
  const messageHash = await buildVerifyMessageHash({
    message: input.message,
  });

  return sha256(
    concatBytes(
      VERIFY_ACTION_BYTES,
      messageHash,
      new Uint8Array(input.slotHash),
    ),
  );
}


export type WebAuthnSecp256r1Verification = {
  secp256r1Verify: Instruction<typeof SECP256R1_PROGRAM_ADDRESS>;
  clientDataJson: Uint8Array;
};

export async function buildSecp256r1VerifyInstructionFromWebAuthnResponse(input: {
  publicKey: string;
  response: AuthenticationResponseJSON;
}): Promise<WebAuthnSecp256r1Verification> {
  const parsed = buildSecp256r1VerifyInputFromWebAuthn(input);

  return {
    secp256r1Verify: getSecp256r1VerifyInstruction(parsed.verifyInput),
    clientDataJson: getClientDataJsonBytes(input.response),
  };
}