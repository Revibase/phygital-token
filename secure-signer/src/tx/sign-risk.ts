/**
 * Classify owner transactions for confirmation UX.
 * Critical = the user can't verify what an inner instruction does, or it hands
 * over control; elevated = moves funds or changes what taps can spend.
 */

import type { InstructionKind, ParsedInstructionSummary } from "./parser.js";
import type { TransactionSummary } from "./policy.js";

export type SignRisk = "normal" | "elevated" | "critical";

const LABELS: Record<InstructionKind, string> = {
  link: "Link accessory",
  unlink: "Unlink accessory",
  send: "Send from accessory wallet",
  tapPayments: "Change tap permissions",
  tapPaymentsOff: "Disable tap transactions",
  createTokenAccount: "Create token account",
};

const SUBTITLES: Partial<Record<InstructionKind, string>> = {
  link: "This wallet becomes the accessory’s owner",
  unlink: "The accessory wallet stays with the accessory",
  send: "Approved with your wallet — not limited by tap permissions",
  tapPayments: "Changes what a tap of the accessory can do",
  tapPaymentsOff:
    "The accessory can’t approve transactions anymore. Authenticating with a tap still works",
};

export function instructionLabel(kind: InstructionKind): string {
  return LABELS[kind];
}

export function instructionSubtitle(kind: InstructionKind): string | null {
  return SUBTITLES[kind] ?? null;
}

function sendRisk(ixs: ParsedInstructionSummary[]): SignRisk | null {
  const sends = ixs.filter((ix) => ix.kind === "send");
  if (sends.length === 0) return null;
  for (const ix of sends) {
    const inner = ix.inner ?? [];
    if (inner.length === 0) return "critical";
    if (inner.some((row) => row.opaque || row.dangerous)) return "critical";
  }
  return "elevated";
}

export function classifySignRisk(summary: TransactionSummary): SignRisk {
  if (summary.instructions.some((ix) => ix.permissionDanger)) return "critical";
  const send = sendRisk(summary.instructions);
  if (send === "critical") return "critical";
  if (send || summary.instructions.some((ix) => ix.kind === "tapPayments" || ix.kind === "unlink"))
    return "elevated";
  return "normal";
}

export function riskCallout(ixs: ParsedInstructionSummary[]): string | null {
  if (ixs.some((ix) => ix.permissionDanger))
    return "These permissions allow potentially destructive actions. Review every allowed instruction carefully.";
  const inner = ixs.flatMap((ix) => ix.inner ?? []);
  if (ixs.some((ix) => ix.kind === "send" && !ix.inner?.length))
    return "This does nothing the signer can show. Don’t continue unless you know why it was asked for.";
  if (inner.some((row) => row.opaque))
    return "Part of this is a call the signer can’t read, so it can’t show what it does. Only continue if you trust the site that asked for it.";
  if (inner.some((row) => row.dangerous))
    return "This hands control of your tokens to someone else. Only continue if you meant to.";
  const kinds = new Set(ixs.map((i) => i.kind));
  if (kinds.has("send"))
    return "Moves funds out of the accessory wallet. Confirm the amount and destination carefully.";
  if (kinds.has("tapPayments"))
    return "Anyone holding the accessory can use these programs and spending limits with a tap.";
  if (kinds.has("unlink")) return "Whoever links the accessory next controls its wallet.";
  return null;
}
