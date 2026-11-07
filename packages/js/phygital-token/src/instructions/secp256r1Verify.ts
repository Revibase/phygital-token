import type { Instruction, InstructionWithData, ReadonlyUint8Array } from "@solana/kit";

import { SECP256R1_PROGRAM_ADDRESS } from "../utils/consts.js";
import { PhygitalTokenError } from "../utils/errors.js";

/** One signature for the secp256r1 precompile. `verifyResponse` returns exactly this shape. */
export type Secp256r1VerifyEntry = {
  /** 33-byte compressed P-256 public key. */
  publicKey: ReadonlyUint8Array;
  /** 64-byte compact `r || s`, low S. */
  signature: ReadonlyUint8Array;
  message: ReadonlyUint8Array;
};

const HEADER_SIZE = 2; // num_signatures u8, padding u8
const OFFSETS_SIZE = 14; // seven u16s per signature
const PUBKEY_SIZE = 33;
const SIGNATURE_SIZE = 64;
const THIS_INSTRUCTION = 0xffff;

/** One secp256r1 precompile instruction verifying every entry, data inline; entry `i` is `signatureIndex: i`. */
export function getSecp256r1VerifyInstruction(
  entries: readonly Secp256r1VerifyEntry[],
): Instruction<typeof SECP256R1_PROGRAM_ADDRESS> & InstructionWithData<Uint8Array> {
  const tableEnd = HEADER_SIZE + entries.length * OFFSETS_SIZE;
  const size = entries.reduce(
    (sum, e) => sum + PUBKEY_SIZE + SIGNATURE_SIZE + e.message.length,
    tableEnd,
  );
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  data[0] = entries.length;

  let cursor = tableEnd;
  entries.forEach((entry, i) => {
    if (entry.publicKey.length !== PUBKEY_SIZE || entry.signature.length !== SIGNATURE_SIZE) {
      throw new PhygitalTokenError(
        "INVALID_ARGUMENT",
        "A secp256r1 entry needs a 33-byte public key and a 64-byte signature.",
      );
    }
    const publicKeyOffset = cursor;
    const signatureOffset = publicKeyOffset + PUBKEY_SIZE;
    const messageOffset = signatureOffset + SIGNATURE_SIZE;
    const fields = [
      signatureOffset,
      THIS_INSTRUCTION,
      publicKeyOffset,
      THIS_INSTRUCTION,
      messageOffset,
      entry.message.length,
      THIS_INSTRUCTION,
    ];
    fields.forEach((value, j) =>
      view.setUint16(HEADER_SIZE + i * OFFSETS_SIZE + j * 2, value, true),
    );
    data.set(entry.publicKey, publicKeyOffset);
    data.set(entry.signature, signatureOffset);
    data.set(entry.message, messageOffset);
    cursor = messageOffset + entry.message.length;
  });

  return { programAddress: SECP256R1_PROGRAM_ADDRESS, accounts: [], data };
}
