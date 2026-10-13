/** Program ids and the amount, unit and window formatting shared by the clear-signing describers. */
import { PROGRAM_IDS } from "../../shared/programs.js";
import { getAddressDecoder } from "@solana/kit";

export const getBase58Address = (bytes: Uint8Array) => getAddressDecoder().decode(bytes);

export interface DetailRow {
  label: string;
  value: string;
}

export interface ClearedInner {
  title: string;
  details: DetailRow[];
  /** Not fully decoded — the user can't verify what it does. */
  opaque: boolean;
  /** Hands over control (approve, set authority, close). */
  dangerous: boolean;
}

export const SYSTEM: string = PROGRAM_IDS.system;

export const TOKEN: string = PROGRAM_IDS.token;

export const TOKEN_2022: string = PROGRAM_IDS.token2022;

export const ATA: string = PROGRAM_IDS.associatedToken;

export const MEMO: string = PROGRAM_IDS.memo;

export const MEMO_V1: string = PROGRAM_IDS.memoV1;

export const METADATA: string = PROGRAM_IDS.tokenMetadata;

export const BUBBLEGUM: string = PROGRAM_IDS.bubblegum;

export const CORE: string = PROGRAM_IDS.metaplexCore;

/**
 * Mint → decimals/symbol for clear-signing. Policy caps and some token transfers
 * only carry raw amounts; the signer never trusts parent-supplied decimals.
 */
const KNOWN_MINT_META: ReadonlyMap<string, { decimals: number; symbol: string }> = new Map([
  ["So11111111111111111111111111111111111111112", { decimals: 9, symbol: "SOL" }],
  ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", { decimals: 6, symbol: "USDC" }],
  ["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDnm3", { decimals: 6, symbol: "USDC" }],
  ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", { decimals: 6, symbol: "USDT" }],
]);

export function mintMeta(mint: string): { decimals: number; symbol: string } | null {
  return KNOWN_MINT_META.get(mint) ?? null;
}

/**
 * UI amount + symbol when decimals are known. A token the signer can't name
 * says "tokens" (its mint is shown on its own row); without decimals the
 * amount is labelled as raw units rather than passed off as a balance.
 */
export function formatTokenAmount(raw: bigint, mint: string, decimalsHint?: number | null): string {
  const known = mintMeta(mint);
  const decimals = known?.decimals ?? decimalsHint ?? null;
  if (decimals == null) return `${raw.toString()} raw units`;
  return `${formatUnits(raw, decimals)} ${known?.symbol ?? "tokens"}`;
}

export function readU32LE(data: Uint8Array, o: number): number | null {
  if (o + 4 > data.length) return null;
  return (data[o]! | (data[o + 1]! << 8) | (data[o + 2]! << 16) | (data[o + 3]! << 24)) >>> 0;
}

export function readU64LE(data: Uint8Array, o: number): bigint | null {
  if (o + 8 > data.length) return null;
  let v = 0n;
  for (let i = 0; i < 8; i++) v |= BigInt(data[o + i]!) << BigInt(8 * i);
  return v;
}

/** Format raw units with known decimals; trim trailing zeros. */
export function formatUnits(raw: bigint, decimals: number): string {
  if (decimals <= 0) return raw.toString();
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0");
  frac = frac.replace(/0+$/, "");
  const s = frac ? `${whole}.${frac}` : whole.toString();
  return neg ? `-${s}` : s;
}

export function windowPhrase(windowSeconds: bigint): string {
  if (windowSeconds === 0n) return "in total";
  if (windowSeconds === 86_400n) return "every day";
  if (windowSeconds === 604_800n) return "every week";
  if (windowSeconds === 2_592_000n) return "every month";
  const every = (n: bigint, unit: string) =>
    `every ${n === 1n ? "" : `${n} `}${unit}${n === 1n ? "" : "s"}`;
  if (windowSeconds % 86_400n === 0n) return every(windowSeconds / 86_400n, "day");
  if (windowSeconds % 3_600n === 0n) return every(windowSeconds / 3_600n, "hour");
  if (windowSeconds % 60n === 0n) return every(windowSeconds / 60n, "minute");
  return every(windowSeconds, "second");
}

/** Full address for detail rows (titles stay short) — defeats address poisoning. */
export function full(addr: string | undefined): string {
  return addr ? String(addr) : "?";
}

export function hasPrefix(data: Uint8Array, prefix: readonly number[]): boolean {
  if (data.length < prefix.length) return false;
  return prefix.every((b, i) => data[i] === b);
}
