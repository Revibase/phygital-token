import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { getAddressEncoder, type Address, type Instruction } from "@solana/kit";
import { getSecp256r1VerifyInstruction } from "../../instructions/internal/secp256r1Verify";
import { SECP256R1_PROGRAM_ADDRESS, TRANSFER_ACTION_BYTES } from "../consts";
import {
  base64URLStringToBuffer,
  convertSignatureDERtoRS,
  getSecp256r1Message,
  parseWebAuthnClientData,
} from "./internal";
import { TransferSession } from "../../instructions/transfer";
import { findDomainConfigPda } from "../pdas/domainConfig";
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
  session: TransferSession;
  response: AuthenticationResponseJSON;
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
        publicKey: base64URLStringToBuffer(input.session.nft.publicKey),
        signature,
        message,
      },
    ],
    crossOrigin: clientData.crossOrigin,
    truncatedClientDataJson: clientData.truncatedClientDataJson,
    origin: clientData.origin,
    rpIdHash: message.subarray(0, 32),
  };
}

export async function buildTransferMessageHash(input: {
  asset: Address;
  sender: Address;
}): Promise<Uint8Array> {
  return sha256(
    concatBytes(encodeAddress(input.asset), encodeAddress(input.sender)),
  );
}

export async function buildTransferChallenge(input: {
  tokenProgram: Address;
  asset: Address;
  sender: Address;
  slotHash: Uint8Array;
}): Promise<Uint8Array> {
  const messageHash = await buildTransferMessageHash({
    asset: input.asset,
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
  domainConfig: Address;
};

export async function buildSecp256r1VerifyInstructionFromWebAuthn(input: {
  session: TransferSession;
  response: AuthenticationResponseJSON;
}): Promise<WebAuthnSecp256r1Verification> {
  const parsed = buildSecp256r1VerifyInputFromWebAuthn(input);

  return {
    secp256r1Verify: getSecp256r1VerifyInstruction(parsed.verifyInput),
    origin: parsed.origin,
    crossOrigin: parsed.crossOrigin,
    truncatedClientDataJson: parsed.truncatedClientDataJson,
    domainConfig: await findDomainConfigPda(undefined, parsed.rpIdHash),
  };
}
