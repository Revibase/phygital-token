import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import {
  getAddressEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { getSecp256r1VerifyInstruction } from "../../instructions/internal/secp256r1Verify";
import {
  SECP256R1_PROGRAM_ADDRESS,
  TRANSFER_ACTION_BYTES,
} from "../consts";
import {
  base64URLStringToBuffer,
  convertSignatureDERtoRS,
  getSecp256r1Message,
  parseWebAuthnClientData,
} from "./internal";

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

function buildSecp256r1VerifyInputFromWebAuthn(input: {
  response: AuthenticationResponseJSON;
  compressedPubkey: Uint8Array;
}) {
  const clientData = parseWebAuthnClientData(
    input.response.response.clientDataJSON,
  );
  const signature = convertSignatureDERtoRS(
    base64URLStringToBuffer(input.response.response.signature),
  );
  const message = getSecp256r1Message(input.response);

  return {
    verifyInput: [
      {
        publicKey: input.compressedPubkey,
        signature,
        message,
      },
    ],
    crossOrigin: clientData.crossOrigin,
    truncatedClientDataJson: clientData.truncatedClientDataJson,
    origin: clientData.origin,
  };
}

export async function buildTransferMessageHash(input: {
  cardInstance: Address;
  sender: Address;
}): Promise<Uint8Array> {
  return sha256(
    concatBytes(encodeAddress(input.cardInstance), encodeAddress(input.sender)),
  );
}

export async function buildTransferChallenge(input: {
  tokenProgram: Address;
  cardInstance: Address;
  sender: Address;
  slotHash: Uint8Array;
}): Promise<Uint8Array> {
  const messageHash = await buildTransferMessageHash({
    cardInstance: input.cardInstance,
    sender: input.sender,
  });

  return sha256(
    concatBytes(
      TRANSFER_ACTION_BYTES,
      encodeAddress(input.tokenProgram),
      messageHash,
      new Uint8Array(input.slotHash),
    ),
  );
}

export type WebAuthnSecp256r1Verification = {
  secp256r1Verify: Instruction<typeof SECP256R1_PROGRAM_ADDRESS>;
  origin: string;
  crossOrigin: boolean;
  truncatedClientDataJson: Uint8Array;
};

export async function buildSecp256r1VerifyInstructionFromWebAuthn(input: {
  response: AuthenticationResponseJSON;
  compressedPubkey: Uint8Array;
}): Promise<WebAuthnSecp256r1Verification> {
  const parsed = buildSecp256r1VerifyInputFromWebAuthn({
    response: input.response,
    compressedPubkey: input.compressedPubkey,
  });

  return {
    secp256r1Verify: getSecp256r1VerifyInstruction(parsed.verifyInput),
    origin: parsed.origin,
    crossOrigin: parsed.crossOrigin,
    truncatedClientDataJson: parsed.truncatedClientDataJson,
  };
}
