import { AccountRole, type Address, type Instruction } from "@solana/kit";

export const LAMPORTS_PER_SIGNATURE = 5_000n;
/** What Revibase prepays in network fees for each accessory. */
export const DEFAULT_PREPAID_FEE_LAMPORTS = 5_000_000n;
/** Rent-exempt minimum of a data-less system account (the accessory wallet). */
export const WALLET_RENT_EXEMPT_LAMPORTS = 890_880n;
/** Refill once the balance can't cover twice this transaction, so a slightly higher final fee still fits. */
const REFILL_HEADROOM = 2n;

const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111" as Address;
const TRANSFER_SOL_DISCRIMINATOR = 2;

/** Base fee (every signature, including secp256r1 precompile ones) plus the priority fee. */
export function networkFeeLamports(input: {
  signatures: number;
  precompileSignatures?: number;
  priorityFeeLamports?: bigint;
}): bigint {
  return (
    LAMPORTS_PER_SIGNATURE * BigInt(input.signatures + (input.precompileSignatures ?? 0)) +
    (input.priorityFeeLamports ?? 0n)
  );
}

/**
 * How much the accessory wallet must refill this transaction: nothing while
 * the prepaid balance covers it, otherwise enough to bring the balance back
 * to `prepaid` after paying `cost`.
 */
export function planFee(input: { balance: bigint; prepaid: bigint; cost: bigint }): {
  refill: bigint;
} {
  if (input.balance >= input.cost * REFILL_HEADROOM) return { refill: 0n };
  const refill = input.prepaid - input.balance + input.cost;
  const shortfall = input.cost - input.balance;
  const needed = refill > shortfall ? refill : shortfall;
  return { refill: needed > 0n ? needed : 0n };
}

/** A system account may end at exactly 0 or stay rent-exempt; anything between is rejected on chain. */
export function canSpendLamports(balance: bigint, amount: bigint): boolean {
  const after = balance - amount;
  return after === 0n || after >= WALLET_RENT_EXEMPT_LAMPORTS;
}

/** Lamports the wallet still needs before it can spend `amount`. */
export function topUpNeeded(balance: bigint, amount: bigint): bigint {
  if (canSpendLamports(balance, amount)) return 0n;
  return amount + WALLET_RENT_EXEMPT_LAMPORTS - balance;
}

/** The refill: a System transfer from the accessory wallet to the fee payer, run inside an execute. */
export function getRefillInstruction(
  wallet: Address,
  feePayer: Address,
  lamports: bigint,
): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, TRANSFER_SOL_DISCRIMINATOR, true);
  view.setBigUint64(4, lamports, true);
  return {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [
      { address: wallet, role: AccountRole.WRITABLE_SIGNER },
      { address: feePayer, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

/** Reads a refill back: `{ from, to, lamports }` for a System transfer, else `null`. */
export function parseSolTransfer(
  instruction: Pick<Instruction, "programAddress" | "accounts" | "data">,
): { from: Address; to: Address; lamports: bigint } | null {
  const data = instruction.data;
  const accounts = instruction.accounts ?? [];
  if (
    instruction.programAddress !== SYSTEM_PROGRAM_ADDRESS ||
    !data ||
    data.length !== 12 ||
    accounts.length !== 2
  ) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== TRANSFER_SOL_DISCRIMINATOR) return null;
  return {
    from: accounts[0].address,
    to: accounts[1].address,
    lamports: view.getBigUint64(4, true),
  };
}

/** The accessory wallet must hold more SOL before its network fees can be refilled. */
export class AccessoryWalletTopUpRequired extends Error {
  readonly wallet: Address;
  readonly neededLamports: bigint;

  constructor(wallet: Address, neededLamports: bigint) {
    super("Add SOL to the accessory wallet to cover network fees.");
    this.name = "AccessoryWalletTopUpRequired";
    this.wallet = wallet;
    this.neededLamports = neededLamports;
  }
}

/** The accessory's tap-payment limits don't allow the refill its network fees need. */
export class RefillBlockedByTapLimit extends Error {
  readonly neededLamports: bigint;
  readonly manageUrl: string;

  constructor(neededLamports: bigint, manageUrl: string) {
    super(
      "This accessory's network fees need a refill that its tap-payment limits don't allow. The owner can refill them in the Revibase app.",
    );
    this.name = "RefillBlockedByTapLimit";
    this.neededLamports = neededLamports;
    this.manageUrl = manageUrl;
  }
}
