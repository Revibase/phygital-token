/**
 * Strict parsing of permission JSON: unknown keys are rejected and every rule is
 * checked the way the program's `validate_permissions` checks it.
 */
import { isAddress } from "@solana/kit";
import { PHYGITAL_TOKEN_PROGRAM_ADDRESS } from "../generated/index.js";
import {
  type AccountCheckJson,
  COMPARISONS,
  type DataCheckJson,
  PERIOD_SECONDS,
  PERMISSION_LIMITS,
  type Period,
  PermissionFormatError,
  type PermissionSet,
  type ProgramJson,
  type RuleJson,
  U64_MAX,
  WIDTH_BYTES,
  WSOL,
  clean,
  isValidOrigin,
} from "./model.js";
import { accountContradiction, contradiction } from "./contradictions.js";

export type Obj = Record<string, unknown>;

export function object(v: unknown, path: string, keys: readonly string[]): Obj {
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

export function hex(v: unknown, path: string, max = 1024): string {
  if (typeof v !== "string" || !/^([0-9a-f]{2})+$/.test(v) || v.length > max * 2)
    throw new PermissionFormatError(path, "must be lowercase hex bytes");
  return v;
}

export function amount(v: unknown, path: string): string {
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

/** Rules match by selector prefix, so two rules in one program can't have one selector prefix the other. */
export function selectorsOverlap(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

/** Parses one rule strictly; throws `PermissionFormatError` naming the bad field. */
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

/**
 * Parses a permission set strictly: unknown keys, out-of-range values and
 * rules the program would reject or could never match all throw
 * `PermissionFormatError`. A set that parses can be saved as-is.
 */
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
