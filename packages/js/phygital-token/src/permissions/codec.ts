/** Conversion between permission JSON and the program's instruction-rule types. */
import { address, isSome, type Address, type Option } from "@solana/kit";
import {
  Comparison,
  NumericWidth,
  type AccountConstraint,
  type DataConstraint,
  type DataConstraintArgs,
  type InstructionRule,
  type InstructionRuleArgs,
} from "../generated/index.js";
import {
  COMPARISONS,
  type DataCheckJson,
  type RuleJson,
  WIDTHS,
  bytesToHex,
  clean,
  hexToBytes,
} from "./model.js";
import type { Obj } from "./validate.js";

function dataArgs(d: DataCheckJson): DataConstraintArgs {
  return {
    offset: d.offset,
    predicate:
      d.bytes !== undefined
        ? { __kind: "BytesEqual", fields: [hexToBytes(d.bytes)] }
        : {
            __kind: "Unsigned",
            width: WIDTHS[d.unsigned!.width],
            comparison: COMPARISONS[d.unsigned!.is],
            value: BigInt(d.unsigned!.value),
          },
  };
}

export function ruleToArgs(rule: RuleJson): InstructionRuleArgs {
  return {
    selector: hexToBytes(rule.selector),
    dataLength: rule.dataLength ?? null,
    accountCount: rule.accountCount ?? null,
    accounts: (rule.accounts ?? []).map((a) => ({
      index: a.index,
      key:
        a.key === undefined
          ? { __kind: "Any" }
          : a.key === "wallet"
            ? { __kind: "Wallet" }
            : { __kind: "Address", fields: [address(a.key)] },
      owner: a.owner ? address(a.owner) : null,
      isSigner: a.signer ?? null,
      isWritable: a.writable ?? null,
      data: (a.data ?? []).map(dataArgs),
    })),
    arguments: (rule.args ?? []).map(dataArgs),
  };
}

export const some = <T>(o: Option<T> | T | null): T | undefined => {
  if (o && typeof o === "object" && "__option" in (o as object))
    return isSome(o as Option<T>) ? (o as { value: T }).value : undefined;
  return (o ?? undefined) as T | undefined;
};

const widthName = (w: NumericWidth) =>
  (Object.keys(WIDTHS) as (keyof typeof WIDTHS)[]).find((k) => WIDTHS[k] === w)!;

const comparisonName = (c: Comparison) =>
  (Object.keys(COMPARISONS) as (keyof typeof COMPARISONS)[]).find((k) => COMPARISONS[k] === c)!;

function dataJson(d: DataConstraint | DataConstraintArgs): DataCheckJson {
  return d.predicate.__kind === "BytesEqual"
    ? { offset: d.offset, bytes: bytesToHex(d.predicate.fields[0]) }
    : {
        offset: d.offset,
        unsigned: {
          width: widthName(d.predicate.width),
          is: comparisonName(d.predicate.comparison),
          value: String(d.predicate.value),
        },
      };
}

export function ruleFromProgram(rule: InstructionRule | InstructionRuleArgs): RuleJson {
  return clean({
    selector: bytesToHex(rule.selector),
    dataLength: some(rule.dataLength),
    accountCount: some(rule.accountCount),
    accounts: rule.accounts.length
      ? rule.accounts.map((a: AccountConstraint | InstructionRuleArgs["accounts"][number]) =>
          clean({
            index: a.index,
            key:
              a.key.__kind === "Any"
                ? undefined
                : a.key.__kind === "Wallet"
                  ? "wallet"
                  : String(a.key.fields[0]),
            owner: some(a.owner as Option<Address>)
              ? String(some(a.owner as Option<Address>))
              : undefined,
            signer: some(a.isSigner as Option<boolean>),
            writable: some(a.isWritable as Option<boolean>),
            data: a.data.length ? a.data.map(dataJson) : undefined,
          }),
        )
      : undefined,
    args: rule.arguments.length ? rule.arguments.map(dataJson) : undefined,
  });
}

/** Same rule, byte for byte once encoded. */
export function sameRule(a: RuleJson, b: RuleJson): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Obj)[k])]),
    );
  return v;
}
