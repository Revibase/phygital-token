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
  getClosePolicyInstruction,
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
  return new Uint8Array(
    getTransactionEncoder().encode(compileTransaction(message(opts.feePayer, opts.instructions))),
  );
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
export function executeWithOwnerWire(opts: {
  owner: Address;
  feePayer?: Address;
  destination?: Address;
}): Uint8Array {
  const wallet = randomAddress();
  const { compactInstructions, remainingAccounts } = compileWalletInstructions(
    [systemTransfer(wallet, opts.destination ?? randomAddress())],
    wallet,
  );
  const ix = withRemainingAccounts(
    getExecuteWithOwnerInstruction({
      owner: createNoopSigner(opts.owner),
      phygitalToken: randomAddress(),
      wallet,
      compactInstructions,
    }),
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
    secp256r1VerifyArgs: {
      verifyArgsRelativeIndex: -1,
      signedMessageIndex: 0,
      clientDataJson: new Uint8Array(8),
    },
    slotNumber: 1n,
  });
  return encodeWire({ feePayer: opts.recipient, instructions: [verify, ix] });
}

/** update_policy setting a daily SOL cap; `feePayer` (default: the owner) also funds its rent. */
export function updatePolicyWire(opts: {
  owner: Address;
  feePayer?: Address;
  funder?: Address;
}): Uint8Array {
  const feePayer = opts.feePayer ?? opts.owner;
  const funder = opts.funder ?? feePayer;
  const ix = getUpdatePolicyInstruction({
    owner: createNoopSigner(opts.owner),
    payer: createNoopSigner(funder),
    phygitalToken: randomAddress(),
    policy: randomAddress(),
    actions: [
      {
        __kind: "SetSolCap",
        fields: [{ cap: 500_000_000n, windowSeconds: 86_400n, maxPerTx: 0n }],
      },
    ],
  });
  return encodeWire({ feePayer, instructions: [ix] });
}

/** A Revibase fee payer paying for an owner action, refilled from the accessory wallet in a second execute. */
export function refilledSendWire(opts: { owner: Address; feePayer: Address }): Uint8Array {
  const wallet = randomAddress();
  const phygitalToken = randomAddress();
  const execute = (to: Address) => {
    const { compactInstructions, remainingAccounts } = compileWalletInstructions(
      [systemTransfer(wallet, to)],
      wallet,
    );
    return withRemainingAccounts(
      getExecuteWithOwnerInstruction({
        owner: createNoopSigner(opts.owner),
        phygitalToken,
        wallet,
        compactInstructions,
      }),
      remainingAccounts,
    );
  };
  return encodeWire({
    feePayer: opts.feePayer,
    instructions: [execute(randomAddress()), execute(opts.feePayer)],
  });
}

/** A top-level program the app never asks an owner to sign. */
export function foreignProgramWire(opts: { payer: Address }): Uint8Array {
  return encodeWire({
    feePayer: opts.payer,
    instructions: [systemTransfer(opts.payer, randomAddress())],
  });
}

/** remove_owner with its accessory address hidden behind a lookup table. */
export function lookupTableWire(opts: { owner: Address }): Uint8Array {
  const phygitalToken = randomAddress();
  const ix = getRemoveOwnerInstruction({
    owner: createNoopSigner(opts.owner),
    phygitalToken,
    policy: randomAddress(),
    wallet: randomAddress(),
  });
  const compressed = compressTransactionMessageUsingAddressLookupTables(message(opts.owner, [ix]), {
    [randomAddress()]: [phygitalToken],
  });
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(compressed)));
}

/** execute_with_owner calling a program the signer can't decode: shown as critical, never silently. */
export function opaqueExecuteWire(opts: { owner: Address }): Uint8Array {
  const wallet = randomAddress();
  const unknown: Instruction = {
    programAddress: randomAddress(),
    accounts: [{ address: wallet, role: 3 }],
    data: Uint8Array.from([9, 9, 9, 9]),
  };
  const { compactInstructions, remainingAccounts } = compileWalletInstructions([unknown], wallet);
  const ix = withRemainingAccounts(
    getExecuteWithOwnerInstruction({
      owner: createNoopSigner(opts.owner),
      phygitalToken: randomAddress(),
      wallet,
      compactInstructions,
    }),
    remainingAccounts,
  );
  return encodeWire({ feePayer: opts.owner, instructions: [ix] });
}

/** remove_owner behind a durable-nonce advance, so a signature would stay valid indefinitely. */
export function durableNonceWire(opts: { owner: Address }): Uint8Array {
  const advance: Instruction = {
    programAddress: SYSTEM,
    accounts: [
      { address: randomAddress(), role: 1 },
      { address: "SysvarRecentB1ockHashes11111111111111111111" as Address, role: 0 },
      { address: opts.owner, role: 2 },
    ],
    data: Uint8Array.from([4, 0, 0, 0]),
  };
  const ix = getRemoveOwnerInstruction({
    owner: createNoopSigner(opts.owner),
    phygitalToken: randomAddress(),
    policy: randomAddress(),
    wallet: randomAddress(),
  });
  return encodeWire({ feePayer: opts.owner, instructions: [advance, ix] });
}

/** set_owner with two secp256r1 verifies in front of it: one link, one verify. */
export function doubleVerifyWire(opts: { recipient: Address }): Uint8Array {
  const verify: Instruction = { programAddress: SECP256R1, data: new Uint8Array(16) };
  const ix = getSetOwnerInstruction({
    recipient: createNoopSigner(opts.recipient),
    phygitalToken: randomAddress(),
    policy: randomAddress(),
    wallet: randomAddress(),
    secp256r1VerifyArgs: {
      verifyArgsRelativeIndex: -1,
      signedMessageIndex: 0,
      clientDataJson: new Uint8Array(8),
    },
    slotNumber: 1n,
  });
  return encodeWire({ feePayer: opts.recipient, instructions: [verify, verify, ix] });
}

// -----------------------------------------------------------------------------
// Confirm-screen catalog: one wire per kind of screen the signer can show, with
// fixed addresses so confirm-model.test.ts can snapshot exactly what it says.
// -----------------------------------------------------------------------------

/** A fixed, readable-in-diffs address for slot `n`. */
export const fixedAddress = (n: number): Address => addr.decode(new Uint8Array(32).fill(n));

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as Address;
const METADATA = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" as Address;
const BUBBLEGUM = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY" as Address;
const CORE = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d" as Address;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
const SYSVAR_INSTRUCTIONS = "Sysvar1nstructions1111111111111111111111111" as Address;

const u64 = (v: bigint) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
};
const bytes = (...parts: Array<number[] | Uint8Array>) =>
  Uint8Array.from(parts.flatMap((p) => [...p]));

/** The named actors every catalog screen shares. */
export const CATALOG = {
  owner: fixedAddress(1),
  feePayer: fixedAddress(2),
  accessory: fixedAddress(3),
  wallet: fixedAddress(4),
  recipient: fixedAddress(5),
  recipientTokenAccount: fixedAddress(6),
  walletTokenAccount: fixedAddress(7),
  unknownMint: fixedAddress(8),
  nft: fixedAddress(9),
  unknownProgram: fixedAddress(10),
} as const;

const sol = (to: Address, lamports: bigint): Instruction => ({
  programAddress: SYSTEM,
  accounts: [
    { address: CATALOG.wallet, role: 3 },
    { address: to, role: 1 },
  ],
  data: bytes([2, 0, 0, 0], u64(lamports)),
});
const createAta = (owner: Address, ata: Address, mint: Address): Instruction => ({
  programAddress: ATA,
  accounts: [
    { address: CATALOG.wallet, role: 3 },
    { address: ata, role: 1 },
    { address: owner, role: 0 },
    { address: mint, role: 0 },
    { address: SYSTEM, role: 0 },
    { address: TOKEN, role: 0 },
  ],
  data: Uint8Array.of(1),
});
const transferChecked = (
  mint: Address,
  to: Address,
  amount: bigint,
  decimals: number,
): Instruction => ({
  programAddress: TOKEN,
  accounts: [
    { address: CATALOG.walletTokenAccount, role: 1 },
    { address: mint, role: 0 },
    { address: to, role: 1 },
    { address: CATALOG.wallet, role: 2 },
  ],
  data: bytes([12], u64(amount), [decimals]),
});

function execute(
  inner: Instruction[],
  feePayer: Address = CATALOG.owner,
  version: 0 | 1 | "legacy" = 0,
): Uint8Array {
  const { compactInstructions, remainingAccounts } = compileWalletInstructions(
    inner,
    CATALOG.wallet,
  );
  const ix = withRemainingAccounts(
    getExecuteWithOwnerInstruction({
      owner: createNoopSigner(CATALOG.owner),
      phygitalToken: CATALOG.accessory,
      wallet: CATALOG.wallet,
      compactInstructions,
    }),
    remainingAccounts,
  );
  if (version === 0) return encodeWire({ feePayer, instructions: [ix] });
  const m = pipe(
    createTransactionMessage({ version }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions([ix], m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(m)));
}

const policy = (actions: Parameters<typeof getUpdatePolicyInstruction>[0]["actions"]) =>
  encodeWire({
    feePayer: CATALOG.owner,
    instructions: [
      getUpdatePolicyInstruction({
        owner: createNoopSigner(CATALOG.owner),
        payer: createNoopSigner(CATALOG.owner),
        phygitalToken: CATALOG.accessory,
        policy: fixedAddress(11),
        actions,
      }),
    ],
  });
const none = { __option: "None" } as const;
const cap = (capValue: bigint, windowSeconds: bigint, maxPerTx = 0n) => ({
  cap: capValue,
  windowSeconds,
  maxPerTx,
});

/** Every confirm screen worth reading, by name. The owner signs all of them. */
export function confirmScreenCatalog(): Record<string, Uint8Array> {
  const C = CATALOG;
  return {
    link: setOwnerWireFixed(),
    unlink: encodeWire({
      feePayer: C.owner,
      instructions: [
        getRemoveOwnerInstruction({
          owner: createNoopSigner(C.owner),
          phygitalToken: C.accessory,
          policy: fixedAddress(11),
          wallet: C.wallet,
        }),
      ],
    }),
    "close-policy": encodeWire({
      feePayer: C.owner,
      instructions: [
        getClosePolicyInstruction({
          owner: createNoopSigner(C.owner),
          phygitalToken: C.accessory,
          policy: fixedAddress(11),
          wallet: C.wallet,
        }),
      ],
    }),
    "create-token-account": encodeWire({
      feePayer: C.owner,
      instructions: [
        {
          ...createAta(C.owner, fixedAddress(12), USDC),
          accounts: createAta(C.owner, fixedAddress(12), USDC).accounts!.map((a, i) =>
            i === 0 ? { address: C.owner, role: 3 as const } : a,
          ),
        },
      ],
    }),
    "send-sol": execute([sol(C.recipient, 250_000_000n)]),
    "send-sol-sponsored": execute([sol(C.recipient, 250_000_000n)], C.feePayer),
    "send-sol-with-refill": execute(
      [sol(C.recipient, 250_000_000n), sol(C.feePayer, 4_975_000n)],
      C.feePayer,
    ),
    "send-sol-v1": execute([sol(C.recipient, 250_000_000n)], C.owner, 1),
    "send-sol-legacy": execute([sol(C.recipient, 250_000_000n)], C.owner, "legacy"),
    "send-usdc-new-account": execute([
      createAta(C.recipient, C.recipientTokenAccount, USDC),
      transferChecked(USDC, C.recipientTokenAccount, 1_500_000n, 6),
    ]),
    "send-usdc-existing-account": execute([
      transferChecked(USDC, C.recipientTokenAccount, 1_500_000n, 6),
    ]),
    "send-unknown-token": execute([
      transferChecked(C.unknownMint, C.recipientTokenAccount, 42_000n, 3),
    ]),
    "send-token-unchecked": execute([
      {
        programAddress: TOKEN,
        accounts: [
          { address: C.walletTokenAccount, role: 1 },
          { address: C.recipientTokenAccount, role: 1 },
          { address: C.wallet, role: 2 },
        ],
        data: bytes([3], u64(1_500_000n)),
      },
    ]),
    "send-four-payments": execute([
      sol(fixedAddress(21), 100_000_000n),
      sol(fixedAddress(22), 200_000_000n),
      sol(fixedAddress(23), 300_000_000n),
      sol(fixedAddress(24), 400_000_000n),
    ]),
    "send-sol-with-memo": execute([
      sol(C.recipient, 250_000_000n),
      {
        programAddress: MEMO,
        accounts: [{ address: C.wallet, role: 2 }],
        data: new TextEncoder().encode("Invoice #1042"),
      },
    ]),
    "send-pnft": execute([
      {
        programAddress: METADATA,
        accounts: [
          { address: C.walletTokenAccount, role: 1 },
          { address: C.wallet, role: 0 },
          { address: C.recipientTokenAccount, role: 1 },
          { address: C.recipient, role: 0 },
          { address: C.nft, role: 0 },
          { address: fixedAddress(13), role: 1 },
          { address: fixedAddress(14), role: 0 },
          { address: fixedAddress(15), role: 1 },
          { address: fixedAddress(16), role: 1 },
          { address: C.wallet, role: 2 },
          { address: C.wallet, role: 3 },
          { address: SYSTEM, role: 0 },
          { address: SYSVAR_INSTRUCTIONS, role: 0 },
          { address: TOKEN, role: 0 },
          { address: ATA, role: 0 },
        ],
        data: bytes([49, 0], u64(1n), [0]),
      },
    ]),
    "send-core-nft": execute([
      {
        programAddress: CORE,
        accounts: [
          { address: C.nft, role: 1 },
          { address: fixedAddress(17), role: 0 },
          { address: C.wallet, role: 3 },
          { address: C.wallet, role: 2 },
          { address: C.recipient, role: 0 },
          { address: SYSTEM, role: 0 },
        ],
        data: Uint8Array.of(14, 0),
      },
    ]),
    "send-cnft": execute([
      {
        programAddress: BUBBLEGUM,
        accounts: [
          { address: fixedAddress(18), role: 0 },
          { address: C.wallet, role: 2 },
          { address: C.wallet, role: 0 },
          { address: C.recipient, role: 0 },
          { address: fixedAddress(19), role: 1 },
          { address: fixedAddress(20), role: 0 },
        ],
        data: bytes(
          [163, 52, 200, 231, 140, 3, 69, 186],
          new Uint8Array(96),
          u64(7n),
          [7, 0, 0, 0],
        ),
      },
    ]),
    "unknown-program": execute([
      {
        programAddress: C.unknownProgram,
        accounts: [{ address: C.wallet, role: 3 }],
        data: Uint8Array.of(9, 9, 9, 9),
      },
    ]),
    "approve-delegate": execute([
      {
        programAddress: TOKEN,
        accounts: [
          { address: C.walletTokenAccount, role: 1 },
          { address: C.recipient, role: 0 },
          { address: C.wallet, role: 2 },
        ],
        data: bytes([4], u64(1_000_000n)),
      },
    ]),
    "policy-sol-limit": policy([
      {
        __kind: "SetSolCap",
        fields: [{ __option: "Some", value: cap(100_000_000n, 86_400n, 10_000_000n) }],
      },
    ]),
    "policy-hourly-limit": policy([
      { __kind: "SetSolCap", fields: [{ __option: "Some", value: cap(10_000_000n, 3_600n) }] },
    ]),
    "policy-no-sol": policy([{ __kind: "SetSolCap", fields: [none] }]),
    "policy-usdc-limit": policy([
      { __kind: "SetMintCap", fields: [USDC, cap(20_000_000n, 604_800n)] },
    ]),
    "policy-unknown-token-limit": policy([
      { __kind: "SetMintCap", fields: [C.unknownMint, cap(20_000_000n, 86_400n)] },
    ]),
    "policy-remove-token-limit": policy([{ __kind: "RemoveMintCap", fields: [USDC] }]),
    "policy-allowed-sites": policy([
      { __kind: "SetAllowedOrigins", fields: [["https://shop.example", "https://pay.example"]] },
    ]),
    "policy-any-site": policy([{ __kind: "SetAllowedOrigins", fields: [[]] }]),
    "policy-allow-sol-transfers": policy([
      {
        __kind: "SetProgramPermission",
        fields: [
          {
            programId: SYSTEM,
            access: {
              __kind: "Restricted",
              fields: [
                [
                  {
                    selector: Uint8Array.of(2, 0, 0, 0),
                    dataLength: none,
                    accountCount: none,
                    accounts: [],
                    arguments: [],
                  },
                ],
              ],
            },
          },
        ],
      },
    ]),
    "policy-custom-rule": policy([
      {
        __kind: "SetProgramPermission",
        fields: [
          {
            programId: SYSTEM,
            access: {
              __kind: "Restricted",
              fields: [
                [
                  {
                    selector: Uint8Array.of(2, 0, 0, 0),
                    dataLength: { __option: "Some", value: 12 },
                    accountCount: none,
                    accounts: [
                      {
                        index: 1,
                        key: { __kind: "Address", fields: [C.recipient] },
                        owner: none,
                        isSigner: none,
                        isWritable: none,
                        data: [],
                      },
                    ],
                    arguments: [
                      {
                        offset: 4,
                        predicate: {
                          __kind: "Unsigned",
                          width: 3,
                          comparison: 3,
                          value: 50_000_000n,
                        },
                      },
                    ],
                  },
                ],
              ],
            },
          },
        ],
      },
    ]),
    "policy-all-token-instructions": policy([
      {
        __kind: "SetProgramPermission",
        fields: [{ programId: TOKEN, access: { __kind: "AllInstructions" } }],
      },
    ]),
    "policy-unknown-program": policy([
      {
        __kind: "SetProgramPermission",
        fields: [{ programId: C.unknownProgram, access: { __kind: "AllInstructions" } }],
      },
    ]),
    "policy-remove-program": policy([{ __kind: "RemoveProgramPermission", fields: [SYSTEM] }]),
  };
}

function setOwnerWireFixed(): Uint8Array {
  const verify: Instruction = { programAddress: SECP256R1, data: new Uint8Array(16) };
  const ix = getSetOwnerInstruction({
    recipient: createNoopSigner(CATALOG.owner),
    phygitalToken: CATALOG.accessory,
    policy: fixedAddress(11),
    wallet: CATALOG.wallet,
    secp256r1VerifyArgs: {
      verifyArgsRelativeIndex: -1,
      signedMessageIndex: 0,
      clientDataJson: new Uint8Array(8),
    },
    slotNumber: 1n,
  });
  return encodeWire({ feePayer: CATALOG.owner, instructions: [verify, ix] });
}
