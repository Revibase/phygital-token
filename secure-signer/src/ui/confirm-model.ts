/**
 * What the transaction confirm screen says, as plain data: built only from the
 * signer's own decode (never parent text), rendered by ui.ts, and tested
 * without a DOM (confirm-model.test.ts) so every screen stays readable.
 */

import { formatUnits } from "../tx/clear-sign.js";
import type { TransactionSummary } from "../tx/policy.js";
import { classifySignRisk, instructionLabel, instructionSubtitle, riskCallout, type SignRisk } from "../tx/sign-risk.js";

export interface Row {
  label: string;
  value: string;
}

export interface ConfirmModel {
  risk: SignRisk;
  hero: { title: string; subtitle: string | null };
  callout: { tone: "warn" | "danger"; text: string } | null;
  /** Always visible. */
  rows: Row[];
  /** Behind "Details". */
  details: Row[];
  cta: { label: string; danger: boolean };
}

const BASE58_ADDRESS = "[1-9A-HJ-NP-Za-km-z]{32,44}";
const ADDRESS_ONLY = new RegExp(`^${BASE58_ADDRESS}$`);

/** A value that is exactly one address: rendered shortened, expandable to every character. */
export function isAddress(value: string): boolean {
  return ADDRESS_ONLY.test(value);
}

type Inner = NonNullable<TransactionSummary["instructions"][number]["inner"]>[number];

/** Where an action sends to: a person when known, else the token account. */
function destination(details: readonly Row[]): string | null {
  return details.find((d) => d.label === "To")?.value ?? details.find((d) => d.label === "To token account")?.value ?? null;
}

const SOL_SEND = /^Send ([\d.]+) SOL$/;

function confirmHero(summary: TransactionSummary, name: (value: string) => string): ConfirmModel["hero"] {
  const spends = summary.instructions.flatMap((ix) => ix.inner ?? []);
  const payments = spends.filter((s) => s.title !== "Refill network fees");
  const to = (s: Inner) => {
    const where = destination(s.details);
    if (!where) return null;
    return s.details.some((d) => d.label === "To") ? `To ${name(where)}` : `To token account ${where}`;
  };
  // Several SOL payments: the total, so the amount at stake is the first thing read.
  if (payments.length > 1 && payments.every((s) => SOL_SEND.test(s.title))) {
    const total = payments.reduce((sum, s) => sum + BigInt(Math.round(Number(SOL_SEND.exec(s.title)![1]) * 1e9)), 0n);
    return { title: `Send ${formatUnits(total, 9)} SOL`, subtitle: `In ${payments.length} payments` };
  }
  const send = payments.find((s) => /^Send\b/i.test(s.title));
  if (send && payments.length <= 2) return { title: send.title, subtitle: to(send) };
  if (spends.length === 1) return { title: spends[0]!.title, subtitle: to(spends[0]!) };
  if (spends.length > 1) return { title: `${spends.length} actions`, subtitle: spends.map((s) => s.title).join(" · ") };
  const first = summary.instructions[0];
  if (!first) return { title: "Authorize", subtitle: null };
  return { title: instructionLabel(first.kind), subtitle: instructionSubtitle(first.kind) };
}

/** Lamports per signature: the base network fee. */
const LAMPORTS_PER_SIGNATURE = 5_000n;

/** The network fee: what this wallet pays, or who pays it instead. */
function feeRow(summary: TransactionSummary): Row {
  if (summary.feePayer === summary.walletAddress) {
    const fee = LAMPORTS_PER_SIGNATURE * BigInt(summary.signatureCount) + (summary.config.priorityFeeLamports ?? 0n);
    return { label: "Network fee", value: `${formatUnits(fee, 9)} SOL` };
  }
  return summary.revibaseFeePayers?.includes(summary.feePayer)
    ? { label: "Network fee", value: "Free" }
    : { label: "Network fee paid by", value: summary.feePayer };
}

/** Names Revibase's fee payers wherever their address would show (refills, tap-payments deposits). */
function namer(summary: TransactionSummary) {
  const known = new Set(summary.revibaseFeePayers ?? []);
  return (value: string) => (known.has(value) ? "Revibase network fees" : value);
}

/** The rows that are always visible: every action, with what it moves and to whom. */
function primaryActionRows(summary: TransactionSummary): Row[] {
  const spends = summary.instructions.flatMap((ix) => ix.inner ?? []);
  if (spends.length === 1) return [...spends[0]!.details];
  if (spends.length > 1) {
    return spends.map((s) => ({
      label: s.title,
      // A refill always goes to the fee service, so what matters is how much.
      value:
        (s.title === "Refill network fees" ? s.details.find((d) => d.label === "Amount")?.value : undefined) ??
        destination(s.details) ??
        s.details.find((d) => d.label === "Owner")?.value ??
        s.details.find((d) => d.label === "Text")?.value ??
        s.details.find((d) => d.label === "Program")?.value ??
        "—",
    }));
  }
  // Link, unlink and permission changes: every row is the thing being approved.
  return summary.instructions.flatMap((ix) => ix.details);
}

function advancedRows(summary: TransactionSummary, primary: readonly Row[]): Row[] {
  const rows: Row[] = [{ label: "Your wallet", value: summary.walletAddress }];
  const shown = new Set(primary.map((r) => `${r.label}|${r.value}`));
  const add = (r: Row) => {
    if (!shown.has(`${r.label}|${r.value}`)) rows.push(r);
  };

  for (const [i, ix] of summary.instructions.entries()) {
    if (summary.instructions.length > 1) rows.push({ label: `Step ${i + 1}`, value: instructionLabel(ix.kind) });
    ix.details.forEach(add);
    const inner = ix.inner ?? [];
    for (const [n, action] of inner.entries()) {
      if (inner.length > 1) rows.push({ label: `Action ${n + 1}`, value: action.title });
      action.details.forEach(add);
    }
  }

  if (summary.config.priorityFeeLamports !== undefined) {
    rows.push({ label: "Priority fee", value: `${formatUnits(BigInt(summary.config.priorityFeeLamports), 9)} SOL` });
  }
  if (summary.config.computeUnitLimit !== undefined) {
    rows.push({ label: "Compute units", value: String(summary.config.computeUnitLimit) });
  }
  return rows;
}

export function confirmModel(summary: TransactionSummary): ConfirmModel {
  const risk = classifySignRisk(summary);
  const callout = riskCallout(summary.instructions);
  const name = namer(summary);
  const named = (rows: Row[]) => rows.map((r) => ({ ...r, value: name(r.value) }));
  const rows = named([...primaryActionRows(summary), feeRow(summary)]);
  return {
    risk,
    hero: confirmHero(summary, name),
    callout: callout ? { tone: risk === "critical" ? "danger" : "warn", text: callout } : null,
    rows,
    details: named(advancedRows(summary, rows)),
    cta: risk === "critical" ? { label: "Authorize anyway", danger: true } : { label: "Authorize", danger: false },
  };
}
