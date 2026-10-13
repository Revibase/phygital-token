/**
 * A readable JSON form of accessory permissions (the policy's spending limits,
 * allowed sites and program rules): what the Revibase editor copies and pastes, and what a
 * project puts in a permission request link. Addresses are base58, bytes hex,
 * amounts raw-unit strings. `parsePermissionSet` is strict: anything it
 * doesn't know is rejected, and every rule is checked the way the program
 * checks it, so a set that parses can always be saved. It also rejects a rule
 * whose checks can never all hold, which the program would save but never match.
 */
import { address, isAddress, isSome, type Address, type Option } from "@solana/kit";
import {
  Comparison,
  NumericWidth,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
  type AccountConstraint,
  type DataConstraint,
  type DataConstraintArgs,
  type InstructionRule,
  type InstructionRuleArgs,
} from "../generated/index.js";

export type Period = "day" | "week" | "month" | "lifetime" | number;

export type DataCheckJson = {
  offset: number;
  bytes?: string;
  unsigned?: {
    width: "u8" | "u16" | "u32" | "u64";
    is: "eq" | "ne" | "lt" | "le" | "gt" | "ge";
    value: string;
  };
};

export type AccountCheckJson = {
  index: number;
  /** A base58 address, "wallet" (the accessory wallet), or omitted for any. */
  key?: string;
  owner?: string;
  signer?: boolean;
  writable?: boolean;
  data?: DataCheckJson[];
};

export type RuleJson = {
  selector: string;
  dataLength?: number;
  accountCount?: number;
  accounts?: AccountCheckJson[];
  args?: DataCheckJson[];
};

export type ProgramJson = {
  id: string;
  access: "all" | { only: RuleJson[] };
  /** The requester's own words, shown as such. */
  reason?: string;
};

export type LimitJson = {
  /** "SOL" or a mint address. */
  asset: string;
  amount: string;
  period: Period;
  maxPerTap?: string;
};

export type PermissionSet = {
  v: 1;
  name?: string;
  reason?: string;
  programs: ProgramJson[];
  limits: LimitJson[];
  /**
   * Sites accessory taps may come from, e.g. `https://app.example.com`.
   * Omitted = any site. Browsers write the origin a tap is signed on, so this
   * stops other websites using a tap; a native app talking to the accessory
   * directly can still claim any origin.
   */
  origins?: string[];
};

export const PERMISSION_LIMITS = {
  programs: 64,
  rulesPerProgram: 32,
  limits: 16,
  origins: 16,
  textLength: 280,
} as const;

export class PermissionFormatError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "PermissionFormatError";
  }
}

const WIDTH_BYTES = { u8: 1, u16: 2, u32: 4, u64: 8 } as const;
const WIDTHS = {
  u8: NumericWidth.U8,
  u16: NumericWidth.U16,
  u32: NumericWidth.U32,
  u64: NumericWidth.U64,
} as const;
const COMPARISONS = {
  eq: Comparison.Equal,
  ne: Comparison.NotEqual,
  lt: Comparison.LessThan,
  le: Comparison.LessThanOrEqual,
  gt: Comparison.GreaterThan,
  ge: Comparison.GreaterThanOrEqual,
} as const;
const PERIOD_SECONDS = { day: 86_400n, week: 604_800n, month: 2_592_000n, lifetime: 0n } as const;
const U64_MAX = (1n << 64n) - 1n;
const WSOL = "So11111111111111111111111111111111111111112";

export function periodSeconds(period: Period): bigint {
  return typeof period === "number" ? BigInt(period) : PERIOD_SECONDS[period];
}

export function periodFromSeconds(seconds: bigint): Period {
  const named = (Object.entries(PERIOD_SECONDS) as [Exclude<Period, number>, bigint][]).find(
    ([, s]) => s === seconds,
  );
  return named ? named[0] : Number(seconds);
}

/**
 * `https://host[:port]`, or `http://localhost[:port]`, exactly as browsers
 * write `clientDataJSON.origin`: lowercase host, no path or trailing slash.
 * The program applies the same check.
 */
export function isValidOrigin(origin: string): boolean {
  const scheme = origin.startsWith("https://")
    ? "https://"
    : origin.startsWith("http://")
      ? "http://"
      : null;
  if (!scheme) return false;
  const host = origin.slice(scheme.length);
  if (scheme === "http://" && host !== "localhost" && !host.startsWith("localhost:")) return false;
  const colon = host.indexOf(":");
  const name = colon < 0 ? host : host.slice(0, colon);
  const port = colon < 0 ? undefined : host.slice(colon + 1);
  return (
    /^[a-z0-9.-]+$/.test(name) &&
    !/^[.-]|[.-]$/.test(name) &&
    (port === undefined || /^\d{1,5}$/.test(port))
  );
}

export const hexToBytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
export const bytesToHex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// --- strict parsing -----------------------------------------------------------

type Obj = Record<string, unknown>;

function object(v: unknown, path: string, keys: readonly string[]): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new PermissionFormatError(path, "must be an object");
  for (const k of Object.keys(v)) {
    if (!keys.includes(k)) throw new PermissionFormatError(path, `unknown field "${k}"`);
  }
  return v as Obj;
}

function array(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v)) throw new PermissionFormatError(path, "must be a list");
  if (v.length > max) throw new PermissionFormatError(path, `at most ${max} entries`);
  return v;
}

function int(v: unknown, path: string, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > max)
    throw new PermissionFormatError(path, `must be a whole number from 0 to ${max}`);
  return v;
}

function hex(v: unknown, path: string, max = 1024): string {
  if (typeof v !== "string" || !/^([0-9a-f]{2})+$/.test(v) || v.length > max * 2)
    throw new PermissionFormatError(path, "must be lowercase hex bytes");
  return v;
}

function amount(v: unknown, path: string): string {
  if (typeof v !== "string" || !/^\d{1,20}$/.test(v) || BigInt(v) > U64_MAX)
    throw new PermissionFormatError(path, "must be a raw amount in a string");
  return v;
}

function addr(v: unknown, path: string): string {
  if (typeof v !== "string" || !isAddress(v))
    throw new PermissionFormatError(path, "must be a Solana address");
  return v;
}

function text(v: unknown, path: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.length > PERMISSION_LIMITS.textLength)
    throw new PermissionFormatError(
      path,
      `must be text up to ${PERMISSION_LIMITS.textLength} characters`,
    );
  return v;
}

function bool(v: unknown, path: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new PermissionFormatError(path, "must be true or false");
  return v;
}

function dataCheck(v: unknown, path: string, dataLength?: number): DataCheckJson {
  const o = object(v, path, ["offset", "bytes", "unsigned"]);
  const offset = int(o.offset, `${path}.offset`, 65_535);
  if ((o.bytes === undefined) === (o.unsigned === undefined))
    throw new PermissionFormatError(path, 'needs exactly one of "bytes" or "unsigned"');
  let width: number;
  let check: DataCheckJson;
  if (o.bytes !== undefined) {
    check = { offset, bytes: hex(o.bytes, `${path}.bytes`) };
    width = check.bytes!.length / 2;
  } else {
    const u = object(o.unsigned, `${path}.unsigned`, ["width", "is", "value"]);
    if (typeof u.width !== "string" || !(u.width in WIDTH_BYTES))
      throw new PermissionFormatError(`${path}.unsigned.width`, "must be u8, u16, u32 or u64");
    if (typeof u.is !== "string" || !(u.is in COMPARISONS))
      throw new PermissionFormatError(`${path}.unsigned.is`, "must be eq, ne, lt, le, gt or ge");
    const value = amount(u.value, `${path}.unsigned.value`);
    const w = u.width as keyof typeof WIDTH_BYTES;
    if (w !== "u64" && BigInt(value) >= 1n << BigInt(WIDTH_BYTES[w] * 8))
      throw new PermissionFormatError(`${path}.unsigned.value`, `doesn't fit in ${w}`);
    check = { offset, unsigned: { width: w, is: u.is as keyof typeof COMPARISONS, value } };
    width = WIDTH_BYTES[w];
  }
  if (dataLength !== undefined && offset + width > dataLength)
    throw new PermissionFormatError(path, "reaches past the data length");
  return check;
}

function accountCheck(v: unknown, path: string, accountCount?: number): AccountCheckJson {
  const o = object(v, path, ["index", "key", "owner", "signer", "writable", "data"]);
  const index = int(o.index, `${path}.index`, 255);
  if (accountCount !== undefined && index >= accountCount)
    throw new PermissionFormatError(`${path}.index`, "is past the account count");
  const key =
    o.key === undefined || o.key === "wallet"
      ? (o.key as string | undefined)
      : addr(o.key, `${path}.key`);
  const owner = o.owner === undefined ? undefined : addr(o.owner, `${path}.owner`);
  const data =
    o.data === undefined
      ? undefined
      : array(o.data, `${path}.data`, 16).map((d, i) => dataCheck(d, `${path}.data[${i}]`));
  if (data?.length && !owner)
    throw new PermissionFormatError(path, "checking account data needs its owner program");
  return clean({
    index,
    key,
    owner,
    signer: bool(o.signer, `${path}.signer`),
    writable: bool(o.writable, `${path}.writable`),
    data,
  });
}

type Located = { check: DataCheckJson; path: string };

/** Whether some value passes every check on one number field. */
function canAllHold(checks: NonNullable<DataCheckJson["unsigned"]>[]): boolean {
  let lo = 0n;
  let hi = (1n << BigInt(WIDTH_BYTES[checks[0].width] * 8)) - 1n;
  const excluded = new Set<bigint>();
  for (const { is, value } of checks) {
    const v = BigInt(value);
    if (is === "ne") excluded.add(v);
    if ((is === "eq" || is === "ge") && v > lo) lo = v;
    if (is === "gt" && v + 1n > lo) lo = v + 1n;
    if ((is === "eq" || is === "le") && v < hi) hi = v;
    if (is === "lt" && v - 1n < hi) hi = v - 1n;
  }
  return lo <= hi && BigInt([...excluded].filter((v) => v >= lo && v <= hi).length) <= hi - lo;
}

/** Whether two byte checks agree wherever they overlap. */
function bytesAgree(a: DataCheckJson, b: DataCheckJson): boolean {
  const from = Math.max(a.offset, b.offset);
  const to = Math.min(a.offset + a.bytes!.length / 2, b.offset + b.bytes!.length / 2);
  for (let at = from; at < to; at++) {
    if (
      a.bytes!.slice((at - a.offset) * 2, (at - a.offset) * 2 + 2) !==
      b.bytes!.slice((at - b.offset) * 2, (at - b.offset) * 2 + 2)
    )
      return false;
  }
  return true;
}

/**
 * Checks on the same bytes that can never all hold. The program would accept
 * them (checks only narrow a rule), but the rule could never match. Number
 * checks are compared per field (same offset and width); partly overlapping
 * fields of different widths are left alone.
 */
function contradiction(checks: Located[]): [Located, Located[]] | null {
  const bytes = checks.filter((c) => c.check.bytes !== undefined);
  for (const [j, b] of bytes.entries()) {
    const clash = bytes.slice(0, j).filter((a) => !bytesAgree(a.check, b.check));
    if (clash.length) return [b, clash];
  }
  const fields = new Map<string, Located[]>();
  for (const c of checks) {
    if (!c.check.unsigned) continue;
    const key = `${c.check.offset}:${c.check.unsigned.width}`;
    const field = [...(fields.get(key) ?? []), c];
    fields.set(key, field);
    if (!canAllHold(field.map((f) => f.check.unsigned!))) return [c, field.slice(0, -1)];
  }
  return null;
}

/** Account checks on the same account that can never all hold. */
function accountContradiction(accounts: AccountCheckJson[]): [string, string[]] | null {
  for (const [j, b] of accounts.entries()) {
    // The program counts the accessory wallet as a signer.
    if (b.key === "wallet" && b.signer === false)
      return [`accounts[${j}]`, ["the accessory wallet, which always signs"]];
    const same = accounts
      .map((a, i) => ({ a, i }))
      .filter(({ a, i }) => i < j && a.index === b.index);
    const clash = same.filter(
      ({ a }) =>
        (a.key !== undefined &&
          b.key !== undefined &&
          a.key !== "wallet" &&
          b.key !== "wallet" &&
          a.key !== b.key) ||
        (a.owner !== undefined && b.owner !== undefined && a.owner !== b.owner) ||
        (a.signer !== undefined && b.signer !== undefined && a.signer !== b.signer) ||
        (a.writable !== undefined && b.writable !== undefined && a.writable !== b.writable) ||
        (a.key === "wallet" && b.signer === false) ||
        (b.key === "wallet" && a.signer === false),
    );
    if (clash.length) return [`accounts[${j}]`, clash.map(({ i }) => `accounts[${i}]`)];
    const data = [...same, { a: b, i: j }].flatMap(({ a, i }) =>
      (a.data ?? []).map((check, k) => ({ check, path: `accounts[${i}].data[${k}]` })),
    );
    const found = contradiction(data);
    if (found) return [found[0].path, found[1].map((c) => c.path)];
  }
  return null;
}

/** Rules match by selector prefix, so two rules in one program can't have one selector prefix the other. */
export function selectorsOverlap(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

export function parseRule(v: unknown, path = "rule"): RuleJson {
  const o = object(v, path, ["selector", "dataLength", "accountCount", "accounts", "args"]);
  const selector = hex(o.selector, `${path}.selector`, 64);
  const dataLength =
    o.dataLength === undefined ? undefined : int(o.dataLength, `${path}.dataLength`, 65_535);
  if (dataLength !== undefined && dataLength < selector.length / 2)
    throw new PermissionFormatError(`${path}.dataLength`, "is shorter than the selector");
  const accountCount =
    o.accountCount === undefined ? undefined : int(o.accountCount, `${path}.accountCount`, 255);
  const accounts =
    o.accounts === undefined
      ? undefined
      : array(o.accounts, `${path}.accounts`, 16).map((a, i) =>
          accountCheck(a, `${path}.accounts[${i}]`, accountCount),
        );
  const args =
    o.args === undefined
      ? undefined
      : array(o.args, `${path}.args`, 16).map((a, i) =>
          dataCheck(a, `${path}.args[${i}]`, dataLength),
        );
  // The selector is a byte check on the instruction data too.
  const argClash = contradiction([
    { check: { offset: 0, bytes: selector }, path: "selector" },
    ...(args ?? []).map((check, i) => ({ check, path: `args[${i}]` })),
  ]);
  const clash = argClash
    ? ([argClash[0].path, argClash[1].map((c) => c.path)] as const)
    : accountContradiction(accounts ?? []);
  if (clash)
    throw new PermissionFormatError(
      `${path}.${clash[0]}`,
      `can never match together with ${clash[1].join(" and ")}`,
    );
  return clean({ selector, dataLength, accountCount, accounts, args });
}

export function parsePermissionSet(v: unknown): PermissionSet {
  const o = object(v, "permissions", ["v", "name", "reason", "programs", "limits", "origins"]);
  if (o.v !== 1) throw new PermissionFormatError("permissions.v", "must be 1");
  const seen = new Set<string>();
  const programs = array(o.programs ?? [], "programs", PERMISSION_LIMITS.programs).map((p, i) => {
    const path = `programs[${i}]`;
    const po = object(p, path, ["id", "access", "reason"]);
    const id = addr(po.id, `${path}.id`);
    if (id === PHYGITAL_TOKEN_PROGRAM_ADDRESS)
      throw new PermissionFormatError(
        `${path}.id`,
        "can't allow the phygital-token program itself",
      );
    if (seen.has(id)) throw new PermissionFormatError(`${path}.id`, "is listed twice");
    seen.add(id);
    let access: ProgramJson["access"];
    if (po.access === "all") access = "all";
    else {
      const ao = object(po.access, `${path}.access`, ["only"]);
      const rules = array(ao.only, `${path}.access.only`, PERMISSION_LIMITS.rulesPerProgram);
      if (rules.length === 0)
        throw new PermissionFormatError(`${path}.access.only`, "needs at least one rule");
      const only = rules.map((r, n) => parseRule(r, `${path}.access.only[${n}]`));
      // One rule per instruction, as the program requires.
      only.forEach((rule, n) => {
        const other = only.findIndex(
          (o, m) => m < n && selectorsOverlap(o.selector, rule.selector),
        );
        if (other >= 0)
          throw new PermissionFormatError(
            `${path}.access.only[${n}].selector`,
            `covers the same instruction as rule ${other}; combine them into one rule`,
          );
      });
      access = { only };
    }
    return clean({ id, access, reason: text(po.reason, `${path}.reason`) });
  });
  const assets = new Set<string>();
  const limits = array(o.limits ?? [], "limits", PERMISSION_LIMITS.limits).map((l, i) => {
    const path = `limits[${i}]`;
    const lo = object(l, path, ["asset", "amount", "period", "maxPerTap"]);
    const asset = lo.asset === "SOL" ? "SOL" : addr(lo.asset, `${path}.asset`);
    if (asset === WSOL || asset === "11111111111111111111111111111111")
      throw new PermissionFormatError(`${path}.asset`, 'use "SOL" for SOL');
    if (assets.has(asset)) throw new PermissionFormatError(`${path}.asset`, "is listed twice");
    assets.add(asset);
    const cap = amount(lo.amount, `${path}.amount`);
    if (BigInt(cap) === 0n)
      throw new PermissionFormatError(`${path}.amount`, "must be more than 0");
    const period = lo.period;
    if (
      !(typeof period === "string" && period in PERIOD_SECONDS) &&
      !(typeof period === "number" && Number.isInteger(period) && period >= 0)
    ) {
      throw new PermissionFormatError(
        `${path}.period`,
        "must be day, week, month, lifetime or a number of seconds",
      );
    }
    const maxPerTap =
      lo.maxPerTap === undefined ? undefined : amount(lo.maxPerTap, `${path}.maxPerTap`);
    if (maxPerTap !== undefined && BigInt(maxPerTap) > BigInt(cap))
      throw new PermissionFormatError(`${path}.maxPerTap`, "can't be more than the amount");
    return clean({ asset, amount: cap, period: period as Period, maxPerTap });
  });
  const origins = array(o.origins ?? [], "origins", PERMISSION_LIMITS.origins).map((origin, i) => {
    const path = `origins[${i}]`;
    if (typeof origin !== "string" || !isValidOrigin(origin)) {
      throw new PermissionFormatError(
        path,
        "must be a site like https://app.example.com, with no path or trailing slash",
      );
    }
    return origin;
  });
  origins.forEach((origin, i) => {
    if (origins.indexOf(origin) !== i)
      throw new PermissionFormatError(`origins[${i}]`, "is listed twice");
  });
  return clean({
    v: 1 as const,
    name: text(o.name, "permissions.name"),
    reason: text(o.reason, "permissions.reason"),
    programs,
    limits,
    origins: origins.length ? origins : undefined,
  });
}

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

// --- to and from the program's types -------------------------------------------

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

const some = <T>(o: Option<T> | T | null): T | undefined => {
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
