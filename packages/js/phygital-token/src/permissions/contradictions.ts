/**
 * Finds checks that can never all hold at once (for example `x < 5` and `x > 9`
 * on the same bytes). The program would save such a rule but never match it.
 */
import { type AccountCheckJson, type DataCheckJson, WIDTH_BYTES } from "./model.js";

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
export function contradiction(checks: Located[]): [Located, Located[]] | null {
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
export function accountContradiction(accounts: AccountCheckJson[]): [string, string[]] | null {
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
