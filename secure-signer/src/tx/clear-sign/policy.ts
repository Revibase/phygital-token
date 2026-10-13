/** Plain-language rows for `update_policy` actions: caps, sites and program rules. */
import type { Option } from "@solana/kit";
import { ruleFromProgram, type PolicyAction, type ProgramAccess } from "phygital-token-sdk";
import { knownProgram, nameRule, ruleRisk, toHex } from "../../shared/programs.js";
import {
  type DetailRow,
  SYSTEM,
  TOKEN,
  TOKEN_2022,
  formatTokenAmount,
  formatUnits,
  windowPhrase,
} from "./format.js";

function accessLabel(access: ProgramAccess): string {
  return access.__kind === "AllInstructions"
    ? "All instructions"
    : `${access.fields[0].length} rule${access.fields[0].length === 1 ? "" : "s"}`;
}

function optionSome<T>(opt: Option<T>): T | null {
  if (opt && typeof opt === "object" && "__option" in opt) {
    return opt.__option === "Some" ? opt.value : null;
  }
  return null;
}

function capPhrase(
  cap: { cap: bigint; windowSeconds: bigint; maxPerTx: bigint },
  format: (raw: bigint) => string,
): string {
  const perPayment = cap.maxPerTx > 0n ? `, at most ${format(cap.maxPerTx)} per payment` : "";
  return `${format(cap.cap)} ${windowPhrase(cap.windowSeconds)}${perPayment}`;
}

/** One row per `update_policy` action, in order. */
export function describePolicyActions(actions: readonly PolicyAction[]): DetailRow[] {
  const rows: DetailRow[] = [];
  for (const action of actions) {
    switch (action.__kind) {
      case "SetSolCap": {
        const cap = optionSome(action.fields[0]);
        rows.push(
          cap
            ? {
                label: "SOL taps can spend",
                value: capPhrase(cap, (raw) => `${formatUnits(raw, 9)} SOL`),
              }
            : { label: "SOL taps can spend", value: "None" },
        );
        break;
      }
      case "SetMintCap": {
        const [mint, cap] = action.fields;
        rows.push({
          label: "Token taps can spend",
          value: capPhrase(cap, (raw) => formatTokenAmount(raw, String(mint))),
        });
        rows.push({ label: "Mint", value: String(mint) });
        break;
      }
      case "RemoveMintCap":
        rows.push({ label: "Token taps can spend", value: "None" });
        rows.push({ label: "Mint", value: String(action.fields[0]) });
        break;
      case "SetAllowedOrigins": {
        const origins = action.fields[0];
        rows.push({
          label: "Taps allowed from",
          value: origins.length ? origins.join("\n") : "Any site",
        });
        break;
      }
      case "SetProgramPermission": {
        const permission = action.fields[0];
        const program = String(permission.programId);
        rows.push({
          label: "Allow program",
          value: knownProgram(program)?.name ?? "Unknown program",
        });
        rows.push({ label: "Program address", value: program });
        rows.push({ label: "Access", value: accessLabel(permission.access) });
        if (permission.access.__kind === "Restricted") {
          for (const rule of permission.access.fields[0]) {
            rows.push(...describeRule(program, rule));
            const risk = ruleRisk(program, rule.selector);
            if (risk) rows.push({ label: "Permission warning", value: risk });
          }
        } else if (!knownProgram(program)?.metered || [TOKEN, TOKEN_2022].includes(program)) {
          rows.push({
            label: "Permission warning",
            value: "Allows every instruction, including potentially destructive actions",
          });
        }
        break;
      }
      case "RemoveProgramPermission": {
        const program = String(action.fields[0]);
        rows.push({
          label: "Remove program",
          value: knownProgram(program)?.name ?? "Unknown program",
        });
        rows.push({ label: "Program address", value: program });
        break;
      }
    }
  }
  return rows;
}

const COMPARISON: Record<string, string> = {
  eq: "is",
  ne: "is not",
  lt: "is less than",
  le: "is at most",
  gt: "is more than",
  ge: "is at least",
};

/**
 * One instruction rule in plain words: the instruction it allows, then one row
 * per condition. Addresses get rows of their own, so each can be expanded and
 * checked in full; nothing is shown as JSON or hex beyond the selector.
 */
function describeRule(
  program: string,
  rule: Parameters<typeof nameRule>[1] & Parameters<typeof ruleFromProgram>[0],
): DetailRow[] {
  const named = nameRule(program, rule);
  if (named) return [{ label: "Allowed instruction", value: named.name }];
  const json = ruleFromProgram(rule);
  const selector = Array.from(rule.selector);
  const base = knownProgram(program)?.instructions.find(
    (i) => i.selector.length === selector.length && i.selector.every((b, n) => b === selector[n]),
  );
  const isSolTransfer = program === SYSTEM && base?.name === "Transfer SOL";
  const rows: DetailRow[] = [
    {
      label: "Allowed instruction",
      value: base ? base.name : `Instructions starting 0x${toHex(rule.selector)}`,
    },
  ];
  const data = (
    check: {
      offset: number;
      bytes?: string;
      unsigned?: { width: string; is: string; value: string };
    },
    subject: string,
  ) => {
    if (check.unsigned) {
      const { width, is, value } = check.unsigned;
      if (
        isSolTransfer &&
        subject === "instruction data" &&
        check.offset === 4 &&
        width === "u64"
      ) {
        return `the amount ${COMPARISON[is]} ${formatUnits(BigInt(value), 9)} SOL`;
      }
      return `the ${width} at byte ${check.offset} of the ${subject} ${COMPARISON[is]} ${value}`;
    }
    return `bytes ${check.offset}–${check.offset + (check.bytes?.length ?? 0) / 2 - 1} of the ${subject} are 0x${check.bytes}`;
  };
  if (json.dataLength !== undefined)
    rows.push({
      label: "Only if",
      value: `the instruction data is exactly ${json.dataLength} bytes`,
    });
  if (json.accountCount !== undefined)
    rows.push({ label: "Only if", value: `it uses exactly ${json.accountCount} accounts` });
  for (const account of json.accounts ?? []) {
    const name = isSolTransfer
      ? (["the sender", "the recipient"][account.index] ?? `account ${account.index + 1}`)
      : `account ${account.index + 1}`;
    if (account.key === "wallet")
      rows.push({ label: "Only if", value: `${name} is the accessory wallet` });
    else if (account.key) rows.push({ label: `Only if ${name} is`, value: account.key });
    if (account.owner) rows.push({ label: `Only if ${name} belongs to`, value: account.owner });
    if (account.signer !== undefined)
      rows.push({
        label: "Only if",
        value: `${name} ${account.signer ? "signs" : "doesn’t sign"}`,
      });
    if (account.writable !== undefined)
      rows.push({
        label: "Only if",
        value: `${name} is ${account.writable ? "writable" : "read-only"}`,
      });
    for (const check of account.data ?? [])
      rows.push({ label: "Only if", value: data(check, `${name}’s data`) });
  }
  for (const check of json.args ?? [])
    rows.push({ label: "Only if", value: data(check, "instruction data") });
  return rows;
}
