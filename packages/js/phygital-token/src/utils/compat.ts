import {
  AccountRole,
  address,
  createNoopSigner,
  createSolanaRpc,
  getBase58Encoder,
  isSignerRole,
  isWritableRole,
  isTransactionSigner,
  type Address,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";

/**
 * Opt-in converters for web3.js callers. Hand-written SDK functions take Kit
 * types (`Rpc`, `Address`, `TransactionSigner`, `Instruction`) — convert
 * before calling in, and convert instructions back with
 * {@link toWeb3Instruction} before `transaction.add()`.
 *
 * Detected by shape — this module does not import `@solana/web3.js`.
 */

/** Base58 string or web3.js `PublicKey` (`toBase58()`). */
export type AddressInput = string | { toBase58(): string };

/** web3.js `Connection` (has `rpcEndpoint`), an RPC URL, or a Kit `Rpc`. */
export type RpcInput =
  | Rpc<SolanaRpcApi>
  | { readonly rpcEndpoint: string }
  | string;

/**
 * Kit `TransactionSigner`, web3.js `Keypair` / wallet (`publicKey`), or any
 * address-like value. Address-only inputs become a no-op signer so the
 * instruction marks the account as a signer; the caller signs the web3.js
 * transaction themselves.
 */
export type SignerInput =
  | TransactionSigner
  | AddressInput
  | { publicKey: AddressInput };

/** Duck-typed web3.js `PublicKey` (enough for `Transaction.add` / compile). */
export type Web3PublicKeyLike = {
  toBase58(): string;
  toString(): string;
  toJSON(): string;
  toBytes(): Uint8Array;
  equals(other: { toBase58?: () => string; toString?: () => string } | string): boolean;
};

/** Duck-typed web3.js `TransactionInstruction`. */
export type Web3Instruction = {
  programId: Web3PublicKeyLike;
  keys: Array<{
    pubkey: Web3PublicKeyLike;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  data: Uint8Array;
};

/** Convert a base58 string or web3.js `PublicKey` to a Kit `Address`. */
export function toAddress(value: AddressInput): Address {
  if (typeof value === "string") {
    return address(value);
  }
  return address(value.toBase58());
}

/** Convert a web3.js `Connection`, RPC URL, or Kit `Rpc` to a Kit `Rpc`. */
export function toRpc(rpc: RpcInput): Rpc<SolanaRpcApi> {
  if (typeof rpc === "string") {
    return createSolanaRpc(rpc);
  }
  if ("rpcEndpoint" in rpc && typeof rpc.rpcEndpoint === "string") {
    return createSolanaRpc(rpc.rpcEndpoint);
  }
  return rpc as Rpc<SolanaRpcApi>;
}

/** Convert a web3.js `Keypair` / `{ publicKey }` to a no-op Kit `TransactionSigner`. */
export function toTransactionSigner(value: SignerInput): TransactionSigner {
  if (isKitSigner(value)) {
    return value;
  }
  if (typeof value === "object" && value !== null && "publicKey" in value) {
    return createNoopSigner(toAddress(value.publicKey));
  }
  return createNoopSigner(toAddress(value));
}

function isKitSigner(value: SignerInput): value is TransactionSigner {
  return (
    typeof value === "object" &&
    value !== null &&
    "address" in value &&
    typeof (value as { address: unknown }).address === "string" &&
    isTransactionSigner(value as { address: Address })
  );
}

function toWeb3PublicKey(base58: string): Web3PublicKeyLike {
  const bytes = getBase58Encoder().encode(base58);
  return {
    toBase58: () => base58,
    toString: () => base58,
    toJSON: () => base58,
    toBytes: () => Uint8Array.from(bytes),
    equals(other) {
      const other58 =
        typeof other === "string"
          ? other
          : (other.toBase58?.() ?? other.toString?.());
      return base58 === other58;
    },
  };
}

function isSignerAccountRole(role: AccountRole): boolean {
  return isSignerRole(role);
}

function isWritableAccountRole(role: AccountRole): boolean {
  return isWritableRole(role);
}

/**
 * Convert a Kit `Instruction` into a web3.js `TransactionInstruction` shape
 * without importing `@solana/web3.js`. Pass the result to `transaction.add()`.
 */
export function toWeb3Instruction(instruction: Instruction): Web3Instruction {
  return {
    programId: toWeb3PublicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((account) => ({
      pubkey: toWeb3PublicKey(account.address),
      isSigner: isSignerAccountRole(account.role),
      isWritable: isWritableAccountRole(account.role),
    })),
    data: Uint8Array.from(instruction.data ?? []),
  };
}

/** Convert Kit `Instruction`s into web3.js `TransactionInstruction` shapes. */
export function toWeb3Instructions(
  instructions: readonly Instruction[],
): Web3Instruction[] {
  return instructions.map(toWeb3Instruction);
}
