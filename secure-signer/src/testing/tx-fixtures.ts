/**
 * Transaction wires for signer tests, built with the real phygital-token SDK
 * instruction builders and kit's compiler.
 */

import {
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createTransactionMessage,
  getAddressDecoder,
  getBase58Decoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import {
  compileWalletInstructions,
  getExecuteWithOwnerInstruction,
  getRemoveOwnerInstruction,
  getSetOwnerInstruction,
  getUpdatePolicyInstruction,
  withRemainingAccounts,
} from "phygital-token-sdk";

import { randomBytes } from "../crypto.js";
import { bytesToBase64 } from "../encoding.js";

const addr = getAddressDecoder();
const SYSTEM = "11111111111111111111111111111111" as Address;
const SECP256R1 = "Secp256r1SigVerify1111111111111111111111111" as Address;

export const randomAddress = (): Address => addr.decode(randomBytes(32));
export const toB64 = (wire: Uint8Array): string => bytesToBase64(wire, "std");

const lifetime = {
  blockhash: getBase58Decoder().decode(new Uint8Array(32).fill(7)) as Blockhash,
  lastValidBlockHeight: 0n,
};

function message(feePayer: Address, instructions: Instruction[]) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
}

export function encodeWire(opts: { feePayer: Address; instructions: Instruction[] }): Uint8Array {
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message(opts.feePayer, opts.instructions))));
}

const systemTransfer = (from: Address, to: Address): Instruction => ({
  programAddress: SYSTEM,
  accounts: [
    { address: from, role: 3 },
    { address: to, role: 1 },
  ],
  data: Uint8Array.from([2, 0, 0, 0, 0, 202, 154, 59, 0, 0, 0, 0]),
});

/** execute_with_owner moving 1 SOL out of the wallet PDA, authorized by `owner`. */
export function executeWithOwnerWire(opts: { owner: Address; feePayer?: Address; destination?: Address }): Uint8Array {
  const wallet = randomAddress();
  const { compactInstructions, remainingAccounts } = compileWalletInstructions(
    [systemTransfer(wallet, opts.destination ?? randomAddress())],
    wallet,
  );
  const ix = withRemainingAccounts(
    getExecuteWithOwnerInstruction({ owner: createNoopSigner(opts.owner), phygitalToken: randomAddress(), wallet, compactInstructions }),
    remainingAccounts,
  );
  return encodeWire({ feePayer: opts.feePayer ?? opts.owner, instructions: [ix] });
}

/** remove_owner (unlink), the simplest instruction an owner signs. */
export function removeOwnerWire(opts: { owner: Address; feePayer?: Address }): Uint8Array {
  const ix = getRemoveOwnerInstruction({
    owner: createNoopSigner(opts.owner),
    phygitalToken: randomAddress(),
    policy: randomAddress(),
    wallet: randomAddress(),
  });
  return encodeWire({ feePayer: opts.feePayer ?? randomAddress(), instructions: [ix] });
}

/** set_owner (link) preceded by its secp256r1 verify, with the recipient paying. */
export function setOwnerWire(opts: { recipient: Address }): Uint8Array {
  const verify: Instruction = { programAddress: SECP256R1, data: new Uint8Array(16) };
  const ix = getSetOwnerInstruction({
    recipient: createNoopSigner(opts.recipient),
    phygitalToken: randomAddress(),
    policy: randomAddress(),
    wallet: randomAddress(),
    secp256r1VerifyArgs: { verifyArgsRelativeIndex: -1, signedMessageIndex: 0, clientDataJson: new Uint8Array(8) },
    slotNumber: 1n,
  });
  return encodeWire({ feePayer: opts.recipient, instructions: [verify, ix] });
}

/** update_policy setting a daily SOL cap; `feePayer` (default: the owner) also funds its rent. */
export function updatePolicyWire(opts: { owner: Address; feePayer?: Address; funder?: Address }): Uint8Array {
  const feePayer = opts.feePayer ?? opts.owner;
  const funder = opts.funder ?? feePayer;
  const ix = getUpdatePolicyInstruction({
    owner: createNoopSigner(opts.owner),
    payer: createNoopSigner(funder),
    phygitalToken: randomAddress(),
    policy: randomAddress(),
    actions: [{ __kind: "SetSolCap", fields: [{ cap: 500_000_000n, windowSeconds: 86_400n, maxPerTx: 0n }] }],
  });
  return encodeWire({ feePayer, instructions: [ix] });
}

/** A Revibase fee payer paying for an owner action, refilled from the accessory wallet in a second execute. */
export function refilledSendWire(opts: { owner: Address; feePayer: Address }): Uint8Array {
  const wallet = randomAddress();
  const phygitalToken = randomAddress();
  const execute = (to: Address) => {
    const { compactInstructions, remainingAccounts } = compileWalletInstructions([systemTransfer(wallet, to)], wallet);
    return withRemainingAccounts(
      getExecuteWithOwnerInstruction({ owner: createNoopSigner(opts.owner), phygitalToken, wallet, compactInstructions }),
      remainingAccounts,
    );
  };
  return encodeWire({ feePayer: opts.feePayer, instructions: [execute(randomAddress()), execute(opts.feePayer)] });
}

/** A top-level program the app never asks an owner to sign. */
export function foreignProgramWire(opts: { payer: Address }): Uint8Array {
  return encodeWire({ feePayer: opts.payer, instructions: [systemTransfer(opts.payer, randomAddress())] });
}

/** remove_owner with its accessory address hidden behind a lookup table. */
export function lookupTableWire(opts: { owner: Address }): Uint8Array {
  const phygitalToken = randomAddress();
  const ix = getRemoveOwnerInstruction({ owner: createNoopSigner(opts.owner), phygitalToken, policy: randomAddress(), wallet: randomAddress() });
  const compressed = compressTransactionMessageUsingAddressLookupTables(message(opts.owner, [ix]), {
    [randomAddress()]: [phygitalToken],
  });
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(compressed)));
}
