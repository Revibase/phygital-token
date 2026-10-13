/**
 * Decode a legacy, v0 or v1 Solana transaction for signing via @solana/kit codecs.
 *
 * Kit owns the wire format. We add a pre-parse size cap, reject trailing
 * bytes and address lookup tables (every account must be visible to the
 * policy), and sign the EXACT `messageBytes` returned by the decoder — never a
 * re-encode.
 */

import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Transaction,
  type TransactionMessage,
  type TransactionMessageWithFeePayer,
  type TransactionMessageWithLifetime,
} from "@solana/kit";

import { MAX_TX_BYTES } from "../constants.js";

export class TxError extends Error {}

export type DecodedTransaction = {
  version: "legacy" | 0 | 1;
  /** Exact bytes the Ed25519 signature covers. Sign THESE, unchanged. */
  messageBytes: Uint8Array;
  /** Kit wire transaction (signatures map + message bytes). */
  transaction: Transaction;
  /** Decompiled message (fee payer, lifetime, instructions). */
  message: TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithLifetime;
};

const txDecoder = getTransactionDecoder();
const messageDecoder = getCompiledTransactionMessageDecoder();

export function decodeTransaction(bytes: Uint8Array): DecodedTransaction {
  if (bytes.length < 1) throw new TxError("empty");
  if (bytes.length > MAX_TX_BYTES) throw new TxError("too large");

  try {
    const transaction = txDecoder.decode(bytes);
    const [compiled, end] = messageDecoder.read(transaction.messageBytes, 0);
    if (end !== transaction.messageBytes.length) throw new TxError("trailing bytes");
    if (compiled.version !== "legacy" && compiled.version !== 0 && compiled.version !== 1)
      throw new TxError("unsupported version");
    if ("addressTableLookups" in compiled && (compiled.addressTableLookups?.length ?? 0) > 0) {
      throw new TxError("address lookup tables");
    }
    const message = decompileTransactionMessage(compiled);
    return {
      version: compiled.version,
      messageBytes: new Uint8Array(transaction.messageBytes),
      transaction,
      message,
    };
  } catch (e) {
    if (e instanceof TxError) throw e;
    throw new TxError(e instanceof Error ? e.message : "malformed");
  }
}
