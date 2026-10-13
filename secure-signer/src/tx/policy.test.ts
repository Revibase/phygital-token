import { describe, expect, it } from "vitest";
import {
  getAddressEncoder,
  createTransactionMessage,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  getTransactionEncoder,
  type Blockhash,
  type Address,
} from "@solana/kit";

import {
  encodeWire,
  executeWithOwnerWire,
  foreignProgramWire,
  lookupTableWire,
  randomAddress,
  refilledSendWire,
  removeOwnerWire,
  setOwnerWire,
  updatePolicyWire,
} from "../testing/tx-fixtures.js";
import { decodeTransaction, TxError } from "./decode.js";
import { evaluatePolicy, previewPolicy } from "./policy.js";

const pubkey = (a: Address) => Uint8Array.from(getAddressEncoder().encode(a));

describe("decodeTransaction", () => {
  it("accepts v0 wires and refuses lookup tables", () => {
    const owner = randomAddress();
    expect(decodeTransaction(removeOwnerWire({ owner })).version).toBe(0);
    expect(() => decodeTransaction(lookupTableWire({ owner }))).toThrow(TxError);
  });

  it("refuses trailing bytes", () => {
    const wire = removeOwnerWire({ owner: randomAddress() });
    expect(() => decodeTransaction(Uint8Array.from([...wire, 0]))).toThrow(TxError);
  });
});

describe("evaluatePolicy", () => {
  it("decodes v1 and displays the signed total priority fee without multiplying it", () => {
    const owner = randomAddress();
    const instructions = decodeTransaction(removeOwnerWire({ owner, feePayer: owner })).message
      .instructions;
    const message = appendTransactionMessageInstructions(
      instructions,
      setTransactionMessageConfig(
        {
          computeUnitLimit: 200_000,
          loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
          priorityFeeLamports: 10_000n,
        },
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: randomAddress() as unknown as Blockhash, lastValidBlockHeight: 100n },
          setTransactionMessageFeePayer(owner, createTransactionMessage({ version: 1 })),
        ),
      ),
    );
    const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
    const decoded = decodeTransaction(wire);
    expect(decoded.version).toBe(1);
    const result = evaluatePolicy(decoded, pubkey(owner));
    expect(result.ok && result.summary.config).toEqual({
      computeUnitLimit: 200_000,
      priorityFeeLamports: 10_000n,
    });
    expect(() => decodeTransaction(Uint8Array.from([...wire, 0]))).toThrow();
  });
  it("accepts execute_with_owner and clear-signs the inner spend", () => {
    const owner = randomAddress();
    const destination = randomAddress();
    const result = evaluatePolicy(
      decodeTransaction(executeWithOwnerWire({ owner, destination })),
      pubkey(owner),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [ix] = result.summary.instructions;
    expect(ix!.kind).toBe("send");
    expect(ix!.inner?.[0]).toMatchObject({ title: "Send 1 SOL", opaque: false, dangerous: false });
    expect(ix!.inner?.[0]!.details).toContainEqual({ label: "To", value: destination });
  });

  it("accepts a link with its secp256r1 verify, unlink and tap-payment changes", () => {
    const owner = randomAddress();
    for (const [wire, kind] of [
      [setOwnerWire({ recipient: owner }), "link"],
      [removeOwnerWire({ owner, feePayer: owner }), "unlink"],
      [updatePolicyWire({ owner }), "tapPayments"],
    ] as const) {
      const result = evaluatePolicy(decodeTransaction(wire), pubkey(owner));
      expect(result.ok && result.summary.instructions.map((i) => i.kind)).toEqual([kind]);
    }
  });

  it("signs when a Revibase fee payer pays and funds tap payments, and says so", () => {
    const owner = randomAddress();
    const feePayer = randomAddress();
    const result = evaluatePolicy(
      decodeTransaction(updatePolicyWire({ owner, feePayer })),
      pubkey(owner),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.feePayer).toBe(feePayer);
    expect(result.summary.instructions[0]!.signers).toEqual([owner]);
    expect(result.summary.instructions[0]!.details).toContainEqual({
      label: "Deposit paid by",
      value: feePayer,
    });

    const stranger = randomAddress();
    const funded = evaluatePolicy(
      decodeTransaction(updatePolicyWire({ owner, funder: stranger })),
      pubkey(owner),
    );
    expect(funded.ok && funded.summary.instructions[0]!.details).toContainEqual({
      label: "Deposit paid by",
      value: stranger,
    });
  });

  it("shows the accessory wallet paying the fee payer back as a network-fee refill", () => {
    const owner = randomAddress();
    const feePayer = randomAddress();
    const result = evaluatePolicy(
      decodeTransaction(refilledSendWire({ owner, feePayer })),
      pubkey(owner),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [send, refill] = result.summary.instructions;
    expect(send!.inner?.[0]!.title).toBe("Send 1 SOL");
    expect(refill!.inner?.[0]).toMatchObject({
      title: "Refill network fees",
      opaque: false,
      dangerous: false,
    });
    expect(refill!.inner?.[0]!.details).toContainEqual({ label: "To", value: feePayer });
  });

  it("rejects when the authenticated wallet is not a signer (WALLET_MISMATCH)", () => {
    const result = evaluatePolicy(
      decodeTransaction(removeOwnerWire({ owner: randomAddress() })),
      pubkey(randomAddress()),
    );
    expect(result).toEqual({ ok: false, code: "WALLET_MISMATCH" });
  });

  it("never co-signs another wallet's operation, even as fee payer", () => {
    const wallet = randomAddress();
    const result = evaluatePolicy(
      decodeTransaction(removeOwnerWire({ owner: randomAddress(), feePayer: wallet })),
      pubkey(wallet),
    );
    expect(result).toEqual({ ok: false, code: "POLICY_REJECTED" });
  });

  it("rejects a top-level program the app never uses", () => {
    const payer = randomAddress();
    expect(evaluatePolicy(decodeTransaction(foreignProgramWire({ payer })), pubkey(payer))).toEqual(
      { ok: false, code: "POLICY_REJECTED" },
    );
  });

  it("allows a secp256r1 verify only beside a link", () => {
    const owner = randomAddress();
    const verify = {
      programAddress: "Secp256r1SigVerify1111111111111111111111111" as Address,
      data: new Uint8Array(16),
    };
    const [unlink] = decodeTransaction(removeOwnerWire({ owner, feePayer: owner })).message
      .instructions;
    const wire = encodeWire({ feePayer: owner, instructions: [verify, unlink!] });
    expect(evaluatePolicy(decodeTransaction(wire), pubkey(owner))).toEqual({
      ok: false,
      code: "POLICY_REJECTED",
    });
  });

  it("reads compute budget into the summary", () => {
    const owner = randomAddress();
    const [unlink] = decodeTransaction(removeOwnerWire({ owner, feePayer: owner })).message
      .instructions;
    const budget = (data: number[]) => ({
      programAddress: "ComputeBudget111111111111111111111111111111" as Address,
      data: Uint8Array.from(data),
    });
    const wire = encodeWire({
      feePayer: owner,
      instructions: [
        budget([2, 0x40, 0x0d, 0x03, 0]),
        budget([3, 0x50, 0xc3, 0, 0, 0, 0, 0, 0]),
        unlink!,
      ],
    });
    const result = previewPolicy(decodeTransaction(wire));
    expect(result.ok && result.summary.config).toEqual({
      computeUnitLimit: 200_000,
      priorityFeeLamports: 10_000n,
    });
  });
});
