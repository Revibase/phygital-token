/**
 * Trusted clear-signing helpers for confirmation UI.
 * Decodes the instruction layouts the app builds (sends, sweeps, tap-payment
 * policies) and flags anything it can't verify.
 */

import type { Option } from "@solana/kit";
import { ruleFromProgram, type PolicyAction, type ProgramAccess } from "phygital-token-sdk";

import { getAddressDecoder } from "@solana/kit";

import { knownProgram, nameRule, ruleRisk, toHex } from "../shared/programs.js";

const getBase58Address = (bytes: Uint8Array) => getAddressDecoder().decode(bytes);

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
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
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

function readU32LE(data: Uint8Array, o: number): number | null {
  if (o + 4 > data.length) return null;
  return (data[o]! | (data[o + 1]! << 8) | (data[o + 2]! << 16) | (data[o + 3]! << 24)) >>> 0;
}

function readU64LE(data: Uint8Array, o: number): bigint | null {
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

/** Full address for detail rows (titles stay short) — defeats address poisoning. */
function full(addr: string | undefined): string {
  return addr ? String(addr) : "?";
}

function hasPrefix(data: Uint8Array, prefix: readonly number[]): boolean {
  if (data.length < prefix.length) return false;
  return prefix.every((b, i) => data[i] === b);
}

function generic(
  title: string,
  programAddress: string,
  accounts: readonly string[],
  data: Uint8Array,
): ClearedInner {
  return {
    title,
    details: [
      { label: "Program", value: programAddress },
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
    return generic("Unreadable System Program call", programAddress, accounts, data);
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
        // The destination is a token account; its owner is named when the
        // transaction creates it (see the parser), else it's labelled as one.
        return {
          title: `Send ${amountLabel}`,
          details: [
            { label: "Amount", value: amountLabel },
            { label: "Mint", value: full(mint || undefined) },
            { label: "From token account", value: full(accounts[0]) },
            { label: "To token account", value: full(accounts[2]) },
          ],
          opaque: false,
          dangerous: false,
        };
      }
    }
    if (disc === 3 && data.length >= 9) {
      const amount = readU64LE(data, 1);
      if (amount !== null) {
        // Transfer (unchecked) carries no mint or decimals: say so instead of guessing a balance.
        return {
          title: "Send tokens",
          details: [
            {
              label: "Amount",
              value: `${amount.toString()} raw units (token not named in the transaction)`,
            },
            { label: "From token account", value: full(accounts[0]) },
            { label: "To token account", value: full(accounts[1]) },
          ],
          opaque: false,
          dangerous: false,
        };
      }
    }
    if (disc === 9 && data.length === 1 && self && accounts[1] === self) {
      return {
        title: "Close token account",
        details: [
          { label: "Token account", value: full(accounts[0]) },
          { label: "Rent back to", value: full(accounts[1]) },
        ],
        opaque: false,
        dangerous: false,
      };
    }
    const control = disc === undefined ? undefined : TOKEN_CONTROL_IXS.get(disc);
    if (control) {
      // Token layouts: approve(d) = account, [mint,] delegate; set_authority = account (new authority in data);
      // close = account, destination.
      const delegateIndex = disc === 13 ? 2 : 1;
      const named: DetailRow[] =
        disc === 4 || disc === 13
          ? [
              { label: "Token account", value: full(accounts[0]) },
              { label: "Delegate", value: full(accounts[delegateIndex]) },
              { label: "Amount", value: `${readU64LE(data, 1)?.toString() ?? "?"} raw units` },
            ]
          : disc === 6
            ? [
                { label: "Account", value: full(accounts[0]) },
                {
                  label: "New authority",
                  value:
                    data[2] === 1 && data.length >= 35
                      ? getBase58Address(data.slice(3, 35))
                      : "None (removes it)",
                },
              ]
            : [
                { label: "Token account", value: full(accounts[0]) },
                { label: "Rent goes to", value: full(accounts[1]) },
              ];
      return { title: control, details: named, opaque: false, dangerous: true };
    }
    return generic(`Unreadable ${kind} call`, programAddress, accounts, data);
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
    // TransferV1: token, token owner, destination token, destination owner, mint, ...
    if (data[0] === METADATA_TRANSFER_V1) {
      return {
        title: "Send NFT",
        details: [
          { label: "NFT", value: full(accounts[4]) },
          { label: "From", value: full(accounts[1]) },
          { label: "To", value: full(accounts[3]) },
        ],
        opaque: false,
        dangerous: false,
      };
    }
    return generic("Unreadable Token Metadata call", programAddress, accounts, data);
  }
  if (programAddress === BUBBLEGUM) {
    // transfer: tree config, leaf owner, leaf delegate, new leaf owner, merkle tree, ...; the leaf index ends the data.
    if (hasPrefix(data, BUBBLEGUM_TRANSFER)) {
      const index = readU32LE(data, data.length - 4);
      return {
        title: "Send compressed NFT",
        details: [
          { label: "Tree", value: full(accounts[4]) },
          { label: "Leaf", value: index === null ? "?" : `#${index}` },
          { label: "From", value: full(accounts[1]) },
          { label: "To", value: full(accounts[3]) },
        ],
        opaque: false,
        dangerous: false,
      };
    }
    return generic("Unreadable Bubblegum call", programAddress, accounts, data);
  }
  if (programAddress === CORE) {
    // TransferV1: asset, collection, payer, authority, new owner, ...
    if (data[0] === CORE_TRANSFER_V1) {
      return {
        title: "Send NFT",
        details: [
          { label: "NFT", value: full(accounts[0]) },
          { label: "Collection", value: full(accounts[1]) },
          { label: "To", value: full(accounts[4]) },
        ],
        opaque: false,
        dangerous: false,
      };
    }
    return generic("Unreadable Metaplex Core call", programAddress, accounts, data);
  }

  return generic("Call an unknown program", programAddress, accounts, data);
}
