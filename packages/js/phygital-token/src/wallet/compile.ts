import {
  AccountRole,
  downgradeRoleToNonSigner,
  getAddressEncoder,
  getArrayEncoder,
  isSignerRole,
  isWritableRole,
  mergeRoles,
  upgradeRoleToSigner,
  upgradeRoleToWritable,
  type AccountMeta,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  findWalletPda,
  getCompactInstructionEncoder,
  getExecuteWithOwnerInstruction,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
  type CompactInstructionArgs,
} from "../generated/index.js";

const EXECUTE_ACTION_BYTES = new TextEncoder().encode("execute");

/**
 * Named accounts before `remaining_accounts`, which `CompactInstruction`
 * indexes address: `execute_with_owner` (owner, token, wallet, ixSysvar),
 * `execute_with_accessory` (token, policy, wallet, slotHashes, ixSysvar),
 * `preview_execute` (token, policy, wallet, ixSysvar).
 */
export const EXECUTE_WITH_OWNER_NAMED_ACCOUNT_COUNT = 4;
export const EXECUTE_WITH_ACCESSORY_NAMED_ACCOUNT_COUNT = 5;
export const PREVIEW_EXECUTE_NAMED_ACCOUNT_COUNT = 4;

/**
 * Kit instructions → compact execute format. Remaining accounts are keyed by
 * address with Kit `mergeRoles`; the wallet PDA's signer role is dropped (the
 * program signs for it).
 */
export function compileWalletInstructions(
  instructions: readonly Instruction[],
  walletPda: Address
): {
  remainingAccounts: AccountMeta[];
  compactInstructions: CompactInstructionArgs[];
} {
  if (instructions.length === 0) {
    throw new Error("At least one inner instruction is required");
  }

  const remainingAccounts: AccountMeta[] = [];
  const indexByAddress = new Map<string, number>();
  const indexOf = (meta: AccountMeta): number => {
    const role =
      meta.address === walletPda ? downgradeRoleToNonSigner(meta.role) : meta.role;
    const existing = indexByAddress.get(meta.address);
    if (existing !== undefined) {
      remainingAccounts[existing] = {
        address: meta.address,
        role: mergeRoles(remainingAccounts[existing]!.role, role),
      };
      return existing;
    }
    remainingAccounts.push({ address: meta.address, role });
    indexByAddress.set(meta.address, remainingAccounts.length - 1);
    return remainingAccounts.length - 1;
  };

  const compactInstructions = instructions.map((instruction) => {
    if (instruction.programAddress === PHYGITAL_TOKEN_PROGRAM_ADDRESS) {
      throw new Error(
        `Inner CPI to ${instruction.programAddress} is not allowed for wallet execute`
      );
    }
    return {
      programIdIndex: indexOf({
        address: instruction.programAddress,
        role: AccountRole.READONLY,
      }),
      accountIndexes: Uint8Array.from((instruction.accounts ?? []).map(indexOf)),
      data: instruction.data ?? new Uint8Array(),
    };
  });

  if (remainingAccounts.length > 256) {
    throw new Error("Too many accounts for compact u8 indexes");
  }
  return { remainingAccounts, compactInstructions };
}

/**
 * OR remaining-account privileges with the outer execute's named accounts and
 * the fee payer, so the challenge matches the on-chain `AccountInfo` flags.
 */
export function elevateRemainingForExecuteChallenge(
  remainingAccounts: readonly AccountMeta[],
  opts: {
    writableAddresses?: readonly Address[];
    signerAddresses?: readonly Address[];
  }
): AccountMeta[] {
  const writable = new Set(opts.writableAddresses ?? []);
  const signers = new Set(opts.signerAddresses ?? []);
  return remainingAccounts.map((meta) => {
    let role = meta.role;
    if (signers.has(meta.address)) role = upgradeRoleToSigner(role);
    if (writable.has(meta.address)) role = upgradeRoleToWritable(role);
    return role === meta.role ? meta : { address: meta.address, role };
  });
}

/**
 * The tap challenge for `execute_with_accessory`:
 * `SHA256("execute" || phygitalToken || slotHash || borsh(compactInstructions) || accounts)`,
 * where `accounts` is, for each instruction's program then accounts, the key
 * followed by `isSigner | isWritable << 1`. `remainingAccounts` must already
 * carry the transaction-level roles ({@link elevateRemainingForExecuteChallenge}).
 */
export function buildExecuteChallenge(input: {
  phygitalToken: Address;
  slotHash: Uint8Array;
  compactInstructions: readonly CompactInstructionArgs[];
  remainingAccounts: readonly AccountMeta[];
}): Uint8Array {
  const addressEncoder = getAddressEncoder();
  const accounts: number[] = [];
  for (const ix of input.compactInstructions) {
    for (const index of [ix.programIdIndex, ...ix.accountIndexes]) {
      const meta = input.remainingAccounts[index];
      if (!meta) throw new Error(`Compact account index ${index} out of range`);
      accounts.push(
        ...addressEncoder.encode(meta.address),
        (isSignerRole(meta.role) ? 1 : 0) | (isWritableRole(meta.role) ? 2 : 0)
      );
    }
  }
  const parts = [
    EXECUTE_ACTION_BYTES,
    new Uint8Array(addressEncoder.encode(input.phygitalToken)),
    input.slotHash,
    new Uint8Array(
      getArrayEncoder(getCompactInstructionEncoder()).encode([...input.compactInstructions])
    ),
    Uint8Array.from(accounts),
  ];
  const preimage = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((offset, part) => (preimage.set(part, offset), offset + part.length), 0);
  return sha256(preimage);
}

export function withRemainingAccounts(
  instruction: Instruction,
  remainingAccounts: readonly AccountMeta[]
): Instruction {
  return {
    ...instruction,
    accounts: [...(instruction.accounts ?? []), ...remainingAccounts],
  };
}

/** `execute_with_owner` running `instructions` as the token's wallet PDA. */
export async function buildExecuteWithOwnerInstruction(input: {
  owner: TransactionSigner;
  phygitalToken: Address;
  instructions: readonly Instruction[];
}): Promise<Instruction> {
  const [wallet] = await findWalletPda({ phygitalToken: input.phygitalToken });
  const { compactInstructions, remainingAccounts } = compileWalletInstructions(
    input.instructions,
    wallet
  );
  return withRemainingAccounts(
    getExecuteWithOwnerInstruction({
      owner: input.owner,
      phygitalToken: input.phygitalToken,
      wallet,
      compactInstructions,
    }),
    remainingAccounts
  );
}
