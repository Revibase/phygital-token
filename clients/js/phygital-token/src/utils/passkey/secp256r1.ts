import type { AuthenticationResponseJSON } from "./webauthn.js";
import { getAddressEncoder, type Address, type Instruction } from "@solana/kit";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyEntry,
} from "../../instructions/internal/secp256r1Verify.js";
import {
  SECP256R1_PROGRAM_ADDRESS,
  TRANSFER_ACTION_BYTES,
} from "../consts.js";
import {
  base64URLStringToBuffer,
  convertSignatureDERtoRS,
  getClientDataJsonBytes,
  getSecp256r1Message,
} from "./internal.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Secp256r1Pubkey } from "../../generated/index.js";

export type { Secp256r1VerifyEntry };

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

export function buildVerifyInputFromWebAuthn(input: {
  secp256r1PublicKey: Secp256r1Pubkey;
  response: AuthenticationResponseJSON;
}): Secp256r1VerifyEntry {
  const signature = convertSignatureDERtoRS(
    base64URLStringToBuffer(input.response.response.signature),
  );
  const message = getSecp256r1Message(input.response);

  return {
    publicKey: input.secp256r1PublicKey[0],
    signature,
    message,
  };
}

export async function buildTransferChallenge(input: {
  phygitalToken: Address;
  slotHash: Uint8Array;
}): Promise<Uint8Array> {
  return sha256(
    concatBytes(
      TRANSFER_ACTION_BYTES,
      encodeAddress(input.phygitalToken),
      new Uint8Array(input.slotHash),
    ),
  );
}

export type WebAuthnSecp256r1Verification = {
  signedMessageIndex: number;
  secp256r1VerifyInstruction: Instruction<typeof SECP256R1_PROGRAM_ADDRESS>;
  clientDataJson: Uint8Array;
};

export async function buildSecp256r1VerifyInstructionFromWebAuthnResponse(input: {
  secp256r1PublicKey: Secp256r1Pubkey;
  response: AuthenticationResponseJSON;
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[];
}): Promise<WebAuthnSecp256r1Verification> {
  const existing = input.existingSecp256r1VerifyInputs;
  const parsed = buildVerifyInputFromWebAuthn(input);
  let signedMessageIndex = 0;
  if (existing?.length) {
    signedMessageIndex = existing.length;
    existing.push(parsed);
  }
  return {
    signedMessageIndex,
    secp256r1VerifyInstruction: getSecp256r1VerifyInstruction(existing ?? [parsed]),
    clientDataJson: getClientDataJsonBytes(input.response),
  };
}
