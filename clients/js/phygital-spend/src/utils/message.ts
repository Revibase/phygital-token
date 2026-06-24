import { getAddressEncoder, getU64Encoder, type Address } from "@solana/kit";
import { buildVerifyChallenge } from "phygital-token-sdk";

export const SPEND_MESSAGE_TAG = "phygital-spend";

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

/** Mirrors on-chain `build_spend_verify_message`. */
export function buildSpendVerifyMessage(input: {
  recipient: Address;
  mint: Address;
  amount: bigint;
}): Uint8Array {
  return concatBytes(
    new TextEncoder().encode(SPEND_MESSAGE_TAG),
    new Uint8Array(getAddressEncoder().encode(input.recipient)),
    new Uint8Array(getAddressEncoder().encode(input.mint)),
    new Uint8Array(getU64Encoder().encode(input.amount)),
  );
}

/** WebAuthn challenge for a passkey-gated spend authorization. */
export async function buildSpendChallenge(input: {
  recipient: Address;
  mint: Address;
  amount: bigint;
  slotHash: Uint8Array;
}): Promise<Uint8Array> {
  return buildVerifyChallenge({
    message: buildSpendVerifyMessage(input),
    slotHash: input.slotHash,
  });
}
