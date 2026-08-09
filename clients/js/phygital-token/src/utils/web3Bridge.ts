import {
  AccountRole,
  address,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
} from "@solana/kit";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

/** Accept a web3.js `Connection` or an RPC URL string. */
export function resolveConnection(connection: Connection | string): Connection {
  if (typeof connection === "string") {
    return new Connection(connection, "confirmed");
  }
  return connection;
}

export function toPublicKey(value: Address | string | PublicKey): PublicKey {
  if (value instanceof PublicKey) return value;
  return new PublicKey(String(value));
}

export function toAddress(value: PublicKey | string): Address {
  return address(value.toString());
}

export function kitInstructionToWeb3(
  instruction: Instruction,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: toPublicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((account) => ({
      pubkey: toPublicKey(account.address),
      isSigner:
        account.role === AccountRole.READONLY_SIGNER ||
        account.role === AccountRole.WRITABLE_SIGNER,
      isWritable:
        account.role === AccountRole.WRITABLE ||
        account.role === AccountRole.WRITABLE_SIGNER,
    })),
    data: Buffer.from(instruction.data ?? new Uint8Array()),
  });
}

export function web3InstructionToKit(
  instruction: TransactionInstruction,
): Instruction {
  return {
    programAddress: toAddress(instruction.programId),
    accounts: instruction.keys.map((key) => ({
      address: toAddress(key.pubkey),
      role: key.isSigner
        ? key.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : key.isWritable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY,
    })),
    data: new Uint8Array(instruction.data) as ReadonlyUint8Array,
  };
}
