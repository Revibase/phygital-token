/**
 * Trusted clear-signing helpers for confirmation UI.
 * Decodes the instruction layouts the app builds (sends, sweeps, tap-payment
 * policies) and flags anything it can't verify.
 */

import type { Option } from "@solana/kit";
import { ruleFromProgram, type PolicyAction, type ProgramAccess } from "phygital-token-sdk";

import { knownProgram, nameRule, ruleRisk, toHex } from "../shared/programs.js";

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

const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const MEMO = "MemoSq4gqBnyyd8CMoPbUxRWDFBIdzy9SHRdJrEqeL";
const MEMO_V1 = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";
const METADATA = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const BUBBLEGUM = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";
const CORE = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

const METADATA_TRANSFER_V1 = 49;
const BUBBLEGUM_TRANSFER = [163, 52, 200, 231, 140, 3, 69, 186] as const;
const CORE_TRANSFER_V1 = 14;

/** SPL Token / Token-2022 instructions that hand over control of an account. */
const TOKEN_CONTROL_IXS: ReadonlyMap<number, string> = new Map([
  [4, "Approve delegate"],
  [13, "Approve delegate"],
  [6, "Change token authority"],
  [9, "Close token account"],
]);

/**
 * Mint → decimals/symbol for clear-signing. Policy caps and some token transfers
 * only carry raw amounts; the signer never trusts parent-supplied decimals.
 */
const KNOWN_MINT_META: ReadonlyMap<string, { decimals: number; symbol: string }> =
  new Map([
    [
      "So11111111111111111111111111111111111111112",
      { decimals: 9, symbol: "SOL" },
    ],
    [
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      { decimals: 6, symbol: "USDC" },
    ],
    [
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDnm3",
      { decimals: 6, symbol: "USDC" },
    ],
    [
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      { decimals: 6, symbol: "USDT" },
    ],
  ]);

export function mintMeta(
  mint: string,
): { decimals: number; symbol: string } | null {
  return KNOWN_MINT_META.get(mint) ?? null;
}

/** UI amount + symbol when decimals are known; otherwise a clear fallback. */
export function formatTokenAmount(
  raw: bigint,
  mint: string,
  decimalsHint?: number | null,
): string {
  const known = mintMeta(mint);
  const decimals = known?.decimals ?? decimalsHint ?? null;
  const symbol = known?.symbol;
  if (decimals == null) {
    return symbol
      ? `${raw.toString()} ${symbol}`
      : `${raw.toString()} · mint ${shorten(mint)}`;
  }
  const amount = formatUnits(raw, decimals);
  return symbol ? `${amount} ${symbol}` : `${amount} · mint ${shorten(mint)}`;
}

function readU32LE(data: Uint8Array, o: number): number | null {
  if (o + 4 > data.length) return null;
  return (
    (data[o]! |
      (data[o + 1]! << 8) |
      (data[o + 2]! << 16) |
      (data[o + 3]! << 24)) >>>
    0
  );
}

function readU64LE(data: Uint8Array, o: number): bigint | null {
  if (o + 8 > data.length) return null;
  let v = 0n;
  for (let i = 0; i < 8; i++) v |= BigInt(data[o + i]!) << BigInt(8 * i);
  return v;
}

function shorten(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
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
  if (windowSeconds === 0n) return "lifetime";
  if (windowSeconds === 86_400n) return "every day";
  if (windowSeconds === 604_800n) return "every week";
  if (windowSeconds === 2_592_000n) return "every month";
  if (windowSeconds % 86_400n === 0n) {
    const days = windowSeconds / 86_400n;
    return `every ${days} day${days === 1n ? "" : "s"}`;
  }
  return `every ${windowSeconds}s`;
}

function accessLabel(access: ProgramAccess): string {
  return access.__kind === "AllInstructions"
    ? "All instructions"
    : `${access.fields[0].length} rule${access.fields[0].length === 1 ? "" : "s"}`;
}

function optionSome<T>(opt: Option<T>): T | null {
  if (opt && typeof opt === "object" && "__option" in opt) {
    return opt.__option === "Some" ? (opt.value as T) : null;
  }
  return null;
}

function capPhrase(cap: { cap: bigint; windowSeconds: bigint; maxPerTx: bigint }, format: (raw: bigint) => string): string {
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
            ? { label: "SOL taps can spend", value: capPhrase(cap, (raw) => `${formatUnits(raw, 9)} SOL`) }
            : { label: "SOL taps can spend", value: "None" },
        );
        break;
      }
      case "SetMintCap": {
        const [mint, cap] = action.fields;
        rows.push({ label: "Token taps can spend", value: capPhrase(cap, (raw) => formatTokenAmount(raw, String(mint))) });
        break;
      }
      case "RemoveMintCap":
        rows.push({ label: "Token taps can spend", value: `None · mint ${String(action.fields[0])}` });
        break;
      case "SetAllowedOrigins": {
        const origins = action.fields[0];
        rows.push({ label: "Taps allowed from", value: origins.length ? origins.join("\n") : "Any site" });
        break;
      }
      case "SetProgramPermission": {
        const permission = action.fields[0];
        rows.push({ label: "Allow program", value: `${knownProgram(permission.programId)?.name ?? "Unknown program"} · ${full(String(permission.programId))}` });
        rows.push({ label: "Access", value: accessLabel(permission.access) });
        if (permission.access.__kind === "Restricted") {
          for (const rule of permission.access.fields[0]) {
            const named = nameRule(permission.programId, rule);
            const count = rule.accounts.length + rule.arguments.length;
            rows.push({ label: "Allowed instruction", value: named?.name ?? `Custom rule: selector 0x${toHex(rule.selector)}, plus ${count} account / data checks` });
            if (!named) rows.push({ label: "Rule details", value: JSON.stringify(ruleFromProgram(rule)) });
            const risk = ruleRisk(permission.programId, rule.selector);
            if (risk) rows.push({ label: "Permission warning", value: risk });
          }
        } else if (!knownProgram(permission.programId)?.metered || [TOKEN, TOKEN_2022].includes(permission.programId)) {
          rows.push({ label: "Permission warning", value: "Allows every instruction, including potentially destructive actions" });
        }
        break;
      }
      case "RemoveProgramPermission":
        rows.push({ label: "Remove program", value: full(String(action.fields[0])) });
        break;
    }
  }
  return rows;
}

/** Full address for detail rows (titles stay short) — defeats address poisoning. */
function full(addr: string | undefined): string {
  return addr ? String(addr) : "?";
}

function hasPrefix(data: Uint8Array, prefix: readonly number[]): boolean {
  if (data.length < prefix.length) return false;
  return prefix.every((b, i) => data[i] === b);
}

function generic(title: string, accounts: readonly string[], data: Uint8Array): ClearedInner {
  return {
    title,
    details: [
      { label: "Accounts", value: String(accounts.length) },
      { label: "Data bytes", value: String(data.length) },
    ],
    opaque: true,
    dangerous: false,
  };
}

/**
 * Decode one compact CPI inside `execute_with_owner`. `self` is the signing
 * owner: closing a token account with the rent sent back to it is safe.
 */
export function describeInnerInstruction(
  programAddress: string,
  accounts: readonly string[],
  data: Uint8Array,
  self?: string,
): ClearedInner {
  if (programAddress === SYSTEM) {
    const disc = readU32LE(data, 0);
    if (disc === 2 && data.length === 12) {
      const lamports = readU64LE(data, 4);
      if (lamports !== null) {
        const amount = `${formatUnits(lamports, 9)} SOL`;
        return {
          title: `Send ${amount}`,
          details: [
            { label: "Amount", value: amount },
            { label: "From", value: full(accounts[0]) },
            { label: "To", value: full(accounts[1]) },
          ],
          opaque: false,
          dangerous: false,
        };
      }
    }
    return generic("System program", accounts, data);
  }

  if (programAddress === MEMO || programAddress === MEMO_V1) {
    let text = "";
    try {
      text = new TextDecoder().decode(data);
    } catch {
      text = `(${data.length} bytes)`;
    }
    if (text.length > 80) text = `${text.slice(0, 77)}…`;
    return {
      title: "Memo",
      details: [{ label: "Text", value: text || "(empty)" }],
      opaque: false,
      dangerous: false,
    };
  }

  if (programAddress === TOKEN || programAddress === TOKEN_2022) {
    const kind = programAddress === TOKEN_2022 ? "Token-2022" : "Token";
    const disc = data[0];
    if (disc === 12 && data.length >= 10) {
      const amount = readU64LE(data, 1);
      const decimals = data[9]!;
      const mint = accounts[1] ? String(accounts[1]) : "";
      if (amount !== null) {
        const amountLabel = mint
          ? formatTokenAmount(amount, mint, decimals)
          : formatUnits(amount, decimals);
        return {
          title: `Send ${amountLabel} (${kind})`,
          details: [
            { label: "Amount", value: amountLabel },
            { label: "Mint", value: full(mint || undefined) },
            { label: "From", value: full(accounts[0]) },
            { label: "To", value: full(accounts[2]) },
          ],
          opaque: false,
          dangerous: false,
        };
      }
    }
    if (disc === 3 && data.length >= 9) {
      const amount = readU64LE(data, 1);
      if (amount !== null) {
        // Transfer (unchecked) has no mint/decimals in the ix — amount stays opaque.
        return {
          title: `Send tokens (${kind})`,
          details: [
            { label: "Amount", value: amount.toString() },
            { label: "From", value: full(accounts[0]) },
            { label: "To", value: full(accounts[1]) },
          ],
          opaque: false,
          dangerous: false,
        };
      }
    }
    if (disc === 9 && data.length === 1 && self && accounts[1] === self) {
      return {
        title: `Close token account (${kind})`,
        details: [
          { label: "Account", value: full(accounts[0]) },
          { label: "Rent to", value: full(accounts[1]) },
        ],
        opaque: false,
        dangerous: false,
      };
    }
    const control = disc === undefined ? undefined : TOKEN_CONTROL_IXS.get(disc);
    if (control) {
      return {
        title: `${control} (${kind})`,
        details: accounts.slice(0, 3).map((a, i) => ({
          label: `Account ${i + 1}`,
          value: full(a),
        })),
        opaque: false,
        dangerous: true,
      };
    }
    return generic(`${kind} instruction`, accounts, data);
  }

  if (programAddress === ATA) {
    const isCreate = data.length === 0 || data[0] === 0 || data[0] === 1;
    return {
      title: isCreate ? "Create token account" : "Associated token",
      details: [
        { label: "Owner", value: full(accounts[2]) },
        { label: "Mint", value: full(accounts[3]) },
      ],
      opaque: !isCreate,
      dangerous: false,
    };
  }

  if (programAddress === METADATA) {
    if (data[0] === METADATA_TRANSFER_V1) {
      return {
        title: "Transfer pNFT (Token Metadata)",
        details: accounts.slice(0, 4).map((a, i) => ({
          label: `Account ${i + 1}`,
          value: full(a),
        })),
        opaque: false,
        dangerous: false,
      };
    }
    return generic("Token Metadata instruction", accounts, data);
  }
  if (programAddress === BUBBLEGUM) {
    if (hasPrefix(data, BUBBLEGUM_TRANSFER)) {
      return {
        title: "Transfer cNFT (Bubblegum)",
        details: [
          { label: "Accounts", value: String(accounts.length) },
          { label: "Data bytes", value: String(data.length) },
        ],
        opaque: false,
        dangerous: false,
      };
    }
    return generic("Bubblegum instruction", accounts, data);
  }
  if (programAddress === CORE) {
    if (data[0] === CORE_TRANSFER_V1) {
      return {
        title: "Transfer NFT (Core)",
        details: accounts.slice(0, 3).map((a, i) => ({
          label: `Account ${i + 1}`,
          value: full(a),
        })),
        opaque: false,
        dangerous: false,
      };
    }
    return generic("Core instruction", accounts, data);
  }

  return generic(`Call ${shorten(programAddress)}`, accounts, data);
}
