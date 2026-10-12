/**
 * Decode the top-level instructions the Revibase app asks an owner to sign,
 * producing a TRUSTED summary for the confirmation UI.
 *
 * Each phygital-token instruction reports the accounts that must sign it
 * (`signers`), so the policy can bind them to the authenticated wallet. For
 * `execute_with_owner` the inner compact instructions are DECOMPILED so the
 * user sees the real spend; they are displayed, not blocked: the owner may do
 * anything with its accessory wallet.
 */

import { type AccountMeta, type Instruction, type ReadonlyUint8Array } from "@solana/kit";
import {
  EXECUTE_WITH_OWNER_NAMED_ACCOUNT_COUNT,
  parsePhygitalTokenInstruction,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
  PhygitalTokenInstruction,
} from "phygital-token-sdk";
import { describeInnerInstruction, describePolicyActions, type ClearedInner, type DetailRow } from "./clear-sign.js";

export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const SECP256R1_PROGRAM = "Secp256r1SigVerify1111111111111111111111111";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export type InstructionKind = "link" | "unlink" | "send" | "tapPayments" | "tapPaymentsOff" | "createTokenAccount";

export interface InnerInstructionSummary extends ClearedInner {
  programAddress: string;
  accounts: string[];
  dataLength: number;
}

export interface ParsedInstructionSummary {
  kind: InstructionKind;
  /** Accounts that sign this instruction; the policy requires each to be the wallet. */
  signers: string[];
  /** The phygital token account referenced by the instruction, if present. */
  phygitalToken: string | null;
  /** Decoded inner spend for `execute_with_owner`, else null. */
  inner: InnerInstructionSummary[] | null;
  /** Extra trusted rows. */
  details: DetailRow[];
  /** Derived from decoded policy actions, never parent text. */
  permissionDanger?: boolean;
}

type KitInstruction = Instruction & { accounts?: readonly AccountMeta[]; data?: ReadonlyUint8Array };

/** What the instruction can't tell on its own: who pays this transaction's fee. */
export type ParseContext = { feePayer?: string };

function summarizeInner(
  compactInstructions: ReadonlyArray<{ programIdIndex: number; accountIndexes: ReadonlyUint8Array; data: ReadonlyUint8Array }>,
  remaining: readonly AccountMeta[],
  self: string,
  wallet: string,
  context: ParseContext,
): InnerInstructionSummary[] {
  // Compact indices are relative to remaining only (on-chain ctx.remaining_accounts).
  return compactInstructions.map((ci) => {
    const prog = remaining[ci.programIdIndex];
    if (!prog) throw new Error("inner program index out of range");
    const accounts = [...ci.accountIndexes].map((ai) => {
      const meta = remaining[ai];
      if (!meta) throw new Error("inner account index out of range");
      return meta.address;
    });
    const data = Uint8Array.from(ci.data);
    const described = describeInnerInstruction(prog.address, accounts, data, self);
    // The accessory wallet paying this transaction's fee payer back: the prepaid network-fee refill.
    const feePayer = context.feePayer;
    const refill =
      feePayer !== undefined &&
      feePayer !== self &&
      accounts[0] === wallet &&
      accounts[1] === feePayer &&
      /^Send\b/.test(described.title);
    const cleared = refill && feePayer
      ? {
          ...described,
          title: "Refill network fees",
          details: [
            ...described.details.filter((d) => d.label === "Amount"),
            { label: "From", value: wallet },
            { label: "To", value: feePayer },
          ],
        }
      : described;
    return { ...cleared, programAddress: prog.address, accounts, dataLength: data.length };
  });
}

/**
 * `null` for instructions shown only as transaction settings (compute budget)
 * or as part of another one (the link's secp256r1 verify). Throws for anything
 * the app never asks an owner to sign.
 */
export function parseInstruction(ix: KitInstruction, context: ParseContext = {}): ParsedInstructionSummary | null {
  const accounts = [...(ix.accounts ?? [])];
  const data = Uint8Array.from(ix.data ?? []);

  if (ix.programAddress === COMPUTE_BUDGET_PROGRAM || ix.programAddress === SECP256R1_PROGRAM) return null;

  if (ix.programAddress === ATA_PROGRAM) {
    // createIdempotent: payer, ata, owner, mint, system, token program.
    if (data.length !== 1 || data[0] !== 1 || accounts.length < 6) throw new Error("unsupported ATA instruction");
    return {
      kind: "createTokenAccount",
      signers: [accounts[0]!.address],
      phygitalToken: null,
      inner: null,
      details: [
        { label: "For", value: accounts[2]!.address },
        { label: "Mint", value: accounts[3]!.address },
      ],
    };
  }

  if (ix.programAddress !== PHYGITAL_TOKEN_PROGRAM_ADDRESS) throw new Error("program not allowed");
  const parsed = parsePhygitalTokenInstruction({ programAddress: PHYGITAL_TOKEN_PROGRAM_ADDRESS, accounts, data });

  switch (parsed.instructionType) {
    case PhygitalTokenInstruction.SetOwner:
      return {
        kind: "link",
        signers: [parsed.accounts.recipient.address],
        phygitalToken: parsed.accounts.phygitalToken.address,
        inner: null,
        details: [
          { label: "Accessory", value: parsed.accounts.phygitalToken.address },
          { label: "New owner", value: parsed.accounts.recipient.address },
        ],
      };
    case PhygitalTokenInstruction.RemoveOwner:
      return {
        kind: "unlink",
        signers: [parsed.accounts.owner.address],
        phygitalToken: parsed.accounts.phygitalToken.address,
        inner: null,
        details: [{ label: "Accessory", value: parsed.accounts.phygitalToken.address }],
      };
    case PhygitalTokenInstruction.ExecuteWithOwner: {
      const owner = parsed.accounts.owner.address;
      return {
        kind: "send",
        signers: [owner],
        phygitalToken: parsed.accounts.phygitalToken.address,
        inner: summarizeInner(parsed.data.compactInstructions, accounts.slice(EXECUTE_WITH_OWNER_NAMED_ACCOUNT_COUNT), owner, parsed.accounts.wallet.address, context),
        details: [{ label: "Accessory wallet", value: parsed.accounts.wallet.address }],
      };
    }
    case PhygitalTokenInstruction.UpdatePolicy: {
      // The payer only funds the account's rent (it returns to the accessory wallet), so it may be anyone.
      const owner = parsed.accounts.owner.address;
      const funder = parsed.accounts.payer.address;
      return {
        kind: "tapPayments",
        permissionDanger: describePolicyActions(parsed.data.actions).some((row) => row.label === "Permission warning"),
        signers: [owner],
        phygitalToken: parsed.accounts.phygitalToken.address,
        inner: null,
        details: [
          ...describePolicyActions(parsed.data.actions),
          ...(funder !== owner
            ? [{ label: "Deposit paid by", value: funder }]
            : []),
        ],
      };
    }
    case PhygitalTokenInstruction.ClosePolicy:
      return {
        kind: "tapPaymentsOff",
        signers: [parsed.accounts.owner.address],
        phygitalToken: parsed.accounts.phygitalToken.address,
        inner: null,
        details: [
          { label: "Effect", value: "Taps can’t spend anything" },
          { label: "Deposit returns to", value: parsed.accounts.wallet.address },
        ],
      };
    default:
      throw new Error("instruction not allowed");
  }
}
