/** The permission JSON types, limits and small shared helpers. */
import { Comparison, NumericWidth } from "../generated/index.js";

/** A cap window: a named period, or a custom length in seconds (`0` = lifetime). */
export type Period = "day" | "week" | "month" | "lifetime" | number;

/** A check on bytes at `offset` in instruction or account data. */
export type DataCheckJson = {
  offset: number;
  bytes?: string;
  unsigned?: {
    width: "u8" | "u16" | "u32" | "u64";
    is: "eq" | "ne" | "lt" | "le" | "gt" | "ge";
    value: string;
  };
};

/** A check on the account at position `index` in an instruction. */
export type AccountCheckJson = {
  index: number;
  /** A base58 address, "wallet" (the accessory wallet), or omitted for any. */
  key?: string;
  owner?: string;
  signer?: boolean;
  writable?: boolean;
  data?: DataCheckJson[];
};

/** One allowed instruction, matched by its data prefix (`selector`, hex). */
export type RuleJson = {
  selector: string;
  dataLength?: number;
  accountCount?: number;
  accounts?: AccountCheckJson[];
  args?: DataCheckJson[];
};

/** A program the accessory may call: every instruction, or only those matching `rules`. */
export type ProgramJson = {
  id: string;
  access: "all" | { only: RuleJson[] };
  /** The requester's own words, shown as such. */
  reason?: string;
};

/** A spending cap on SOL or one mint, in raw units per `period`. */
export type LimitJson = {
  /** "SOL" or a mint address. */
  asset: string;
  amount: string;
  period: Period;
  maxPerTap?: string;
};

/** A complete accessory policy in its readable JSON form (version 1). */
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

/** Size limits `parsePermissionSet` enforces, keeping a saved policy within one transaction. */
export const PERMISSION_LIMITS = {
  programs: 64,
  rulesPerProgram: 32,
  limits: 16,
  origins: 16,
  textLength: 280,
} as const;

/** Thrown by the permission parsers; `path` points at the offending field, e.g. `programs[2].rules[0]`. */
export class PermissionFormatError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "PermissionFormatError";
  }
}

export const WIDTH_BYTES = { u8: 1, u16: 2, u32: 4, u64: 8 } as const;

export const WIDTHS = {
  u8: NumericWidth.U8,
  u16: NumericWidth.U16,
  u32: NumericWidth.U32,
  u64: NumericWidth.U64,
} as const;

export const COMPARISONS = {
  eq: Comparison.Equal,
  ne: Comparison.NotEqual,
  lt: Comparison.LessThan,
  le: Comparison.LessThanOrEqual,
  gt: Comparison.GreaterThan,
  ge: Comparison.GreaterThanOrEqual,
} as const;

export const PERIOD_SECONDS = {
  day: 86_400n,
  week: 604_800n,
  month: 2_592_000n,
  lifetime: 0n,
} as const;

export const U64_MAX = (1n << 64n) - 1n;

export const WSOL = "So11111111111111111111111111111111111111112";

/** Window length in seconds for a `Period` (`0` = lifetime). */
export function periodSeconds(period: Period): bigint {
  return typeof period === "number" ? BigInt(period) : PERIOD_SECONDS[period];
}

/** The named `Period` for a window length, or the number of seconds if none matches. */
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

/**
 * Hex string to bytes. Throws `PermissionFormatError` on odd length or any
 * non-hex character, rather than silently producing different bytes (which
 * `ruleToArgs` would otherwise write into an on-chain rule).
 */
export const hexToBytes = (hex: string): Uint8Array<ArrayBuffer> => {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new PermissionFormatError("hex", "expected an even number of hex digits");
  }
  return Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
};

/** Bytes to lowercase hex. */
export const bytesToHex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Drops keys whose value is `undefined`, in place, so JSON output stays minimal. */
export function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}
