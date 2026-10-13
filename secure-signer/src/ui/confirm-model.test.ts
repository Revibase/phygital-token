/**
 * Every confirm screen the signer can show, as the words a person reads.
 *
 * - Golden snapshots (`__screens__/<name>.txt`) make each screen reviewable in
 *   a diff: a change to what the user sees can't slip through unnoticed.
 * - The readability lint fails on things people can't check: raw JSON or hex,
 *   amounts without units, addresses buried in text (shortened, never
 *   expandable), recipients or amounts that never reach the screen, and
 *   warnings hidden under "Details".
 */
import { getAddressEncoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { CATALOG, confirmScreenCatalog } from "../../testing/tx-fixtures.js";
import { decodeTransaction } from "../tx/decode.js";
import { evaluatePolicy, type TransactionSummary } from "../tx/policy.js";
import { confirmModel, isAddress, type ConfirmModel } from "./confirm-model.js";

const owner = new Uint8Array(getAddressEncoder().encode(CATALOG.owner));

function summaryOf(wire: Uint8Array): TransactionSummary {
  const result = evaluatePolicy(decodeTransaction(wire), owner);
  if (!result.ok) throw new Error(`policy refused the fixture: ${result.code}`);
  return { ...result.summary, revibaseFeePayers: [CATALOG.feePayer] };
}

/** The screen as text: what a person reads, top to bottom. */
function screenText(model: ConfirmModel): string {
  const rows = (rs: ConfirmModel["rows"]) =>
    rs.map((r) => `  ${r.label}: ${r.value.replaceAll("\n", "\n    ")}`);
  return [
    `# ${model.hero.title}`,
    ...(model.hero.subtitle ? [model.hero.subtitle] : []),
    ...(model.callout ? [`[${model.callout.tone}] ${model.callout.text}`] : []),
    ...rows(model.rows),
    "Details",
    ...rows(model.details),
    `[${model.cta.label}]`,
    "",
  ].join("\n");
}

const ADDRESS_IN_TEXT = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

/** Problems a person would hit reading this screen; empty when it reads cleanly. */
function readabilityProblems(model: ConfirmModel, summary: TransactionSummary): string[] {
  const problems: string[] = [];
  const all = [...model.rows, ...model.details];
  for (const r of all) {
    const where = `"${r.label}: ${r.value}"`;
    if (/[{}]|"\w+":/.test(r.value)) problems.push(`raw JSON in ${where}`);
    if (!isAddress(r.value) && /\b(0x)?[0-9a-f]{16,}\b/i.test(r.value))
      problems.push(`long hex in ${where}`);
    if (ADDRESS_IN_TEXT.test(r.value) && !isAddress(r.value))
      problems.push(`address buried in text (can't be expanded) in ${where}`);
    if (/^(Amount|.*can spend)$/.test(r.label) && /^\d[\d.,]*$/.test(r.value.trim()))
      problems.push(`amount without a unit in ${where}`);
    if (/every \d+s\b/.test(r.value)) problems.push(`time window in raw seconds in ${where}`);
    if (/^(Compute units|Priority fee)$/.test(r.label) && /^0( SOL)?$/.test(r.value))
      problems.push(`unset setting shown as zero in ${where}`);
    if (/^(Accounts|Data bytes)$/.test(r.label) && model.risk !== "critical")
      problems.push(`account/byte counts instead of meaning in ${where}`);
  }
  for (const r of model.details) {
    if (r.label === "Permission warning") problems.push(`warning hidden under Details: ${r.value}`);
  }
  const visible =
    model.rows.map((r) => `${r.label} ${r.value}`).join("\n") + "\n" + model.hero.title;
  for (const inner of summary.instructions.flatMap((ix) => ix.inner ?? [])) {
    const amount = inner.details.find((d) => d.label === "Amount")?.value;
    if (amount && !visible.includes(amount))
      problems.push(`amount ${amount} of "${inner.title}" isn't on screen`);
    // A token send to an existing account can only name the account: the transaction doesn't say whose it is.
    const to = inner.details.find((d) => d.label === "To" || d.label === "To token account")?.value;
    const namedFeePayer =
      !!to &&
      !!summary.revibaseFeePayers?.includes(to) &&
      all.some((r) => r.value === "Revibase network fees");
    if (to && !visible.includes(to) && !namedFeePayer)
      problems.push(`recipient ${to} of "${inner.title}" isn't on screen`);
    if (inner.opaque && !all.some((r) => r.value === inner.programAddress))
      problems.push(`unreadable call to ${inner.programAddress} without its full program address`);
    if (/^(Send|Transfer)\b/.test(inner.title) && !to)
      problems.push(`"${inner.title}" doesn't say who receives it`);
    for (const d of inner.details) {
      const named =
        !!summary.revibaseFeePayers?.includes(d.value) &&
        all.some((r) => r.label === d.label && r.value === "Revibase network fees");
      if (
        !named &&
        !all.some(
          (r) =>
            (r.label === d.label && r.value === d.value) ||
            (r.label === inner.title && r.value === d.value),
        )
      )
        problems.push(`"${d.label}: ${d.value}" of "${inner.title}" never reaches the screen`);
    }
  }
  if (model.risk === "critical" && model.callout?.tone !== "danger")
    problems.push("critical without a danger callout");
  return problems;
}

describe("confirm screens", () => {
  const catalog = confirmScreenCatalog();

  for (const [name, wire] of Object.entries(catalog)) {
    describe(name, () => {
      const summary = summaryOf(wire);
      const model = confirmModel(summary);

      it("matches its reviewed text", async () => {
        await expect(screenText(model)).toMatchFileSnapshot(`./__screens__/${name}.txt`);
      });

      it("reads cleanly", () => {
        expect(readabilityProblems(model, summary)).toEqual([]);
      });
    });
  }

  it("covers every kind of instruction the signer allows", () => {
    const kinds = new Set(
      Object.values(catalog).flatMap((w) => summaryOf(w).instructions.map((ix) => ix.kind)),
    );
    expect([...kinds].sort()).toEqual([
      "createTokenAccount",
      "link",
      "send",
      "tapPayments",
      "tapPaymentsOff",
      "unlink",
    ]);
  });
});
