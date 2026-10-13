/**
 * Decode the top-level instructions the Revibase app asks an owner to sign,
 * producing a TRUSTED summary for the confirmation UI.
 *
 * Each instruction reports the accounts that must sign it (`signers`), so the
 * policy can bind them to the authenticated wallet. For `execute_with_owner`
 * the inner compact instructions are DECOMPILED so the user sees the real
 * spend; they are displayed, not blocked: the owner may do anything with its
 * accessory wallet.
 *
 * The wallet's own transfers (SOL, tokens, NFTs out of the passkey wallet
 * itself) are allowed top-level too, but only when every one decodes fully:
 * nothing opaque, nothing that hands over control.
 */

import { PROGRAM_IDS } from "../shared/programs.js";
import {
  isSignerRole,
  type AccountMeta,
  type Instruction,
  type ReadonlyUint8Array,
} from "@solana/kit";
import {
  EXECUTE_WITH_OWNER_NAMED_ACCOUNT_COUNT,
  parsePhygitalTokenInstruction,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
  PhygitalTokenInstruction,
} from "phygital-token-sdk";
import {
  describeInnerInstruction,
  describePolicyActions,
  mintMeta,
  type ClearedInner,
  type DetailRow,
} from "./clear-sign.js";

export const COMPUTE_BUDGET_PROGRAM: string = PROGRAM_IDS.computeBudget;
export const SECP256R1_PROGRAM: string = PROGRAM_IDS.secp256r1;
export const ATA_PROGRAM: string = PROGRAM_IDS.associatedToken;

export type InstructionKind =
  | "setOwner"
  | "removeOwner"
  | "send"
  | "transfer"
  | "tapPayments"
  | "tapPaymentsOff"
  | "createTokenAccount";

/** Programs whose transfers the wallet may sign top-level, moving its own assets. */
const WALLET_TRANSFER_PROGRAMS: ReadonlySet<string> = new Set([
  PROGRAM_IDS.system,
  PROGRAM_IDS.token,
  PROGRAM_IDS.token2022,
  PROGRAM_IDS.tokenMetadata,
  PROGRAM_IDS.metaplexCore,
  PROGRAM_IDS.bubblegum,
]);

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
  /** Decoded spend: the inner instructions of `execute_with_owner`, or a top-level transfer itself; else null. */
  inner: InnerInstructionSummary[] | null;
  /** Extra trusted rows. */
  details: DetailRow[];
  /** Derived from decoded policy actions, never parent text. */
  permissionDanger?: boolean;
}

type KitInstruction = Instruction & {
  accounts?: readonly AccountMeta[];
  data?: ReadonlyUint8Array;
};

/** What the instruction can't tell on its own: who pays this transaction's fee. */
export type ParseContext = { feePayer?: string };

function summarizeInner(
  compactInstructions: ReadonlyArray<{
    programIdIndex: number;
    accountIndexes: ReadonlyUint8Array;
    data: ReadonlyUint8Array;
  }>,
  remaining: readonly AccountMeta[],
  self: string,
  wallet: string,
  context: ParseContext,
): InnerInstructionSummary[] {
  // Compact indices are relative to remaining only (on-chain ctx.remaining_accounts).
  const summaries = compactInstructions.map((ci) => {
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
    const cleared =
      refill && feePayer
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
  return nameTokenRecipients(summaries);
}

/**
 * A token send names a token account, not a person. When the same transaction
 * creates that account (ATA create: payer, account, owner, mint), its owner is
 * the recipient. Safe to show: the ATA program fails the whole transaction
 * unless the account is the owner's derived address for that mint.
 */
function nameTokenRecipients(summaries: InnerInstructionSummary[]): InnerInstructionSummary[] {
  const owners = new Map<string, string>();
  for (const s of summaries) {
    if (
      s.programAddress === ATA_PROGRAM &&
      s.title === "Create token account" &&
      s.accounts[1] &&
      s.accounts[2]
    )
      owners.set(s.accounts[1], s.accounts[2]);
  }
  return summaries.map((s) => {
    const account = s.details.find((d) => d.label === "To token account")?.value;
    const owner = account ? owners.get(account) : undefined;
    if (!owner) return s;
    const at = s.details.findIndex((d) => d.label === "To token account");
    return {
      ...s,
      details: [...s.details.slice(0, at), { label: "To", value: owner }, ...s.details.slice(at)],
    };
  });
}

/** Who signs `ix`: every account it lists that signs the transaction. */
function instructionSigners(accounts: readonly AccountMeta[]): string[] {
  return [...new Set(accounts.filter((a) => isSignerRole(a.role)).map((a) => a.address))];
}

/** A top-level transfer out of the signing wallet, or throws when it isn't one the signer can fully show. */
function walletTransfer(ix: KitInstruction): ParsedInstructionSummary {
  const metas = [...(ix.accounts ?? [])];
  const signers = instructionSigners(metas);
  if (signers.length === 0) throw new Error("transfer without a signer");
  const accounts = metas.map((a) => a.address);
  const data = Uint8Array.from(ix.data ?? []);
  // Closing a token account is only safe when its rent goes back to the one signer.
  const described = describeInnerInstruction(
    ix.programAddress,
    accounts,
    data,
    signers.length === 1 ? signers[0] : undefined,
  );
  if (described.opaque || described.dangerous || described.title === "Memo")
    throw new Error("transfer not allowed");
  return {
    kind: "transfer",
    signers,
    phygitalToken: null,
    inner: [{ ...described, programAddress: ix.programAddress, accounts, dataLength: data.length }],
    details: [],
  };
}

/**
 * Top-level wallet transfers read like an accessory send: a token account the
 * same transaction opens becomes one of the actions, and names its owner as
 * the recipient of the tokens sent to it.
 */
export function joinWalletTransfers(
  parsed: ReadonlyArray<{ ix: KitInstruction; summary: ParsedInstructionSummary }>,
): ParsedInstructionSummary[] {
  if (!parsed.some((p) => p.summary.kind === "transfer")) return parsed.map((p) => p.summary);
  const rows = parsed.map(({ ix, summary }) => {
    if (summary.kind === "transfer") return summary.inner ?? [];
    if (summary.kind !== "createTokenAccount") return [];
    const accounts = (ix.accounts ?? []).map((a) => a.address);
    const data = Uint8Array.from(ix.data ?? []);
    return [
      {
        ...describeInnerInstruction(ix.programAddress, accounts, data),
        programAddress: ix.programAddress,
        accounts,
        dataLength: data.length,
      },
    ];
  });
  const named = nameTokenRecipients(rows.flat());
  let next = 0;
  return parsed.map(({ summary }, i) => {
    const inner = named.slice(next, (next += rows[i]!.length));
    if (summary.kind === "createTokenAccount")
      return { ...summary, kind: "transfer", inner, details: [] };
    return summary.kind === "transfer" ? { ...summary, inner } : summary;
  });
}

/**
 * `null` for instructions shown only as transaction settings (compute budget)
 * or as part of another one (the link's secp256r1 verify). Throws for anything
 * the app never asks an owner to sign.
 */
export function parseInstruction(
  ix: KitInstruction,
  context: ParseContext = {},
): ParsedInstructionSummary | null {
  const accounts = [...(ix.accounts ?? [])];
  const data = Uint8Array.from(ix.data ?? []);

  if (ix.programAddress === COMPUTE_BUDGET_PROGRAM || ix.programAddress === SECP256R1_PROGRAM)
    return null;

  if (WALLET_TRANSFER_PROGRAMS.has(ix.programAddress)) return walletTransfer(ix);

  if (ix.programAddress === ATA_PROGRAM) {
    // createIdempotent: payer, ata, owner, mint, system, token program.
    if (data.length !== 1 || data[0] !== 1 || accounts.length < 6)
      throw new Error("unsupported ATA instruction");
    return {
      kind: "createTokenAccount",
      signers: [accounts[0]!.address],
      phygitalToken: null,
      inner: null,
      details: [
        { label: "For", value: accounts[2]!.address },
        ...(mintMeta(accounts[3]!.address)
          ? [{ label: "Token", value: mintMeta(accounts[3]!.address)!.symbol }]
          : []),
        { label: "Mint", value: accounts[3]!.address },
      ],
    };
  }

  if (ix.programAddress !== PHYGITAL_TOKEN_PROGRAM_ADDRESS) throw new Error("program not allowed");
  const parsed = parsePhygitalTokenInstruction({
    programAddress: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    accounts,
    data,
  });

  switch (parsed.instructionType) {
    case PhygitalTokenInstruction.SetOwner:
      return {
        kind: "setOwner",
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
        kind: "removeOwner",
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
        inner: summarizeInner(
          parsed.data.compactInstructions,
          accounts.slice(EXECUTE_WITH_OWNER_NAMED_ACCOUNT_COUNT),
          owner,
          parsed.accounts.wallet.address,
          context,
        ),
        details: [{ label: "Accessory wallet", value: parsed.accounts.wallet.address }],
      };
    }
    case PhygitalTokenInstruction.UpdatePolicy: {
      // The payer only funds the account's rent (it returns to the accessory wallet), so it may be anyone.
      const owner = parsed.accounts.owner.address;
      const funder = parsed.accounts.payer.address;
      return {
        kind: "tapPayments",
        permissionDanger: describePolicyActions(parsed.data.actions).some(
          (row) => row.label === "Permission warning",
        ),
        signers: [owner],
        phygitalToken: parsed.accounts.phygitalToken.address,
        inner: null,
        details: [
          ...describePolicyActions(parsed.data.actions),
          ...(funder !== owner ? [{ label: "Deposit paid by", value: funder }] : []),
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
