import { describe, expect, it } from "vitest";

import type { ParsedInstructionSummary } from "./parser.js";
import type { TransactionSummary } from "./policy.js";
import { classifySignRisk, instructionLabel, riskCallout } from "./sign-risk.js";

const ix = (
  kind: ParsedInstructionSummary["kind"],
  inner: ParsedInstructionSummary["inner"] = null,
): ParsedInstructionSummary => ({
  kind,
  signers: ["wallet"],
  phygitalToken: null,
  inner,
  details: [],
});
const summary = (...instructions: ParsedInstructionSummary[]): TransactionSummary => ({
  feePayer: "11111111111111111111111111111111",
  walletAddress: "wallet",
  instructions,
  config: {},
  signatureCount: 1,
});
const inner = (opaque: boolean, dangerous: boolean) => ({
  title: "x",
  details: [],
  opaque,
  dangerous,
  programAddress: "p",
  accounts: [],
  dataLength: 0,
});

describe("sign-risk", () => {
  it("labels each owner action", () => {
    expect(instructionLabel("setOwner")).toBe("Link accessory");
    expect(instructionLabel("send")).toBe("Send from accessory wallet");
    expect(instructionLabel("tapPaymentsOff")).toBe("Disable tap transactions");
  });

  it("rates links and turning tap payments off as normal", () => {
    expect(classifySignRisk(summary(ix("setOwner")))).toBe("normal");
    expect(classifySignRisk(summary(ix("tapPaymentsOff")))).toBe("normal");
  });

  it("rates sends, unlinks and tap-payment changes as elevated", () => {
    expect(classifySignRisk(summary(ix("send", [inner(false, false)])))).toBe("elevated");
    expect(classifySignRisk(summary(ix("removeOwner")))).toBe("elevated");
    expect(classifySignRisk(summary(ix("tapPayments")))).toBe("elevated");
  });

  it("rates a send the signer can't verify, or that hands over control, as critical", () => {
    expect(classifySignRisk(summary(ix("send", [inner(true, false)])))).toBe("critical");
    expect(classifySignRisk(summary(ix("send", [inner(false, true)])))).toBe("critical");
    expect(classifySignRisk(summary(ix("send", [])))).toBe("critical");
  });

  it("rates a destructive permission change as critical", () => {
    expect(classifySignRisk(summary({ ...ix("tapPayments"), permissionDanger: true }))).toBe(
      "critical",
    );
  });

  it("explains what's at stake", () => {
    expect(riskCallout([ix("removeOwner")])).toMatch(/links the accessory next/);
    expect(riskCallout([ix("setOwner")])).toBeNull();
  });
});
