import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { getAddressEncoder, type Address, type Instruction } from "@solana/kit";
import { getSecp256r1VerifyInstruction } from "../../instructions/internal/secp256r1Verify.js";
import {
  SECP256R1_PROGRAM_ADDRESS,
  TRANSFER_ACTION_BYTES,
  VERIFY_ASSET_ACTION_BYTES,
} from "../consts.js";
import {
  base64URLStringToBuffer,
  convertSignatureDERtoRS,
  getClientDataJsonBytes,
  getSecp256r1Message,
} from "./internal.js";
import { sha256 } from "@noble/hashes/sha2.js";

export type Secp256r1VerifyInput = {
  publicKey: Uint8Array;
  signature: Uint8Array;
  message: Uint8Array;
};

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
}): Secp256r1VerifyInput {
  const signature = convertSignatureDERtoRS(
    base64URLStringToBuffer(input.response.response.signature),
  );
  const message = getSecp256r1Message(input.response);

  return {
    publicKey: base64URLStringToBuffer(input.publicKey),
    signature,
    message,
  };
}

export async function buildTransferChallenge(input: {
  asset: Address;
  slotHash: Uint8Array;
}): Promise<Uint8Array> {
  const messageHash = sha256(encodeAddress(input.asset));

  return sha256(
    concatBytes(
      TRANSFER_ACTION_BYTES,
      messageHash,
      new Uint8Array(input.slotHash),
    ),
  );
}

export async function buildVerifyAssetChallenge(input: {
  message: Uint8Array;
  slotHash: Uint8Array;
}): Promise<Uint8Array> {
  const messageHash = sha256(input.message);

  return sha256(
    concatBytes(
      VERIFY_ASSET_ACTION_BYTES,
      messageHash,
      new Uint8Array(input.slotHash),
    ),
  );
}

export type WebAuthnSecp256r1Verification = {
  signedMessageIndex: number;
  secp256r1Verify: Instruction<typeof SECP256R1_PROGRAM_ADDRESS>;
  clientDataJson: Uint8Array;
};

export async function buildSecp256r1VerifyInstructionFromWebAuthnResponse(input: {
  publicKey: string;
  response: AuthenticationResponseJSON;
  existingSecp256r1VerifyInputs?: Secp256r1VerifyInput[];
}): Promise<WebAuthnSecp256r1Verification> {
  const parsed = buildSecp256r1VerifyInputFromWebAuthn(input);
  let signedMessageIndex = 0;
  if (input.existingSecp256r1VerifyInputs?.length) {
    signedMessageIndex = input.existingSecp256r1VerifyInputs.length;
    input.existingSecp256r1VerifyInputs.push(parsed);
  }
  return {
    signedMessageIndex,
    secp256r1Verify: getSecp256r1VerifyInstruction(input.existingSecp256r1VerifyInputs ?? [parsed]),
    clientDataJson: getClientDataJsonBytes(input.response),
  };
}
