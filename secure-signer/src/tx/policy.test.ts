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
  walletTransferWire,
} from "../../testing/tx-fixtures.js";
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
      [setOwnerWire({ recipient: owner }), "setOwner"],
      [removeOwnerWire({ owner, feePayer: owner }), "removeOwner"],
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

  it("signs the wallet's own top-level transfer and shows it", () => {
    const wallet = randomAddress();
    const to = randomAddress();
    const result = evaluatePolicy(
      decodeTransaction(walletTransferWire({ from: wallet, to })),
      pubkey(wallet),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [ix] = result.summary.instructions;
    expect(ix).toMatchObject({ kind: "transfer", signers: [wallet], phygitalToken: null });
    expect(ix!.inner?.[0]).toMatchObject({ title: "Send 1 SOL", opaque: false, dangerous: false });
    expect(ix!.inner?.[0]!.details).toContainEqual({ label: "To", value: to });
  });

  it("never signs a transfer out of someone else's wallet, even as its fee payer", () => {
    const wallet = randomAddress();
    expect(
      evaluatePolicy(
        decodeTransaction(walletTransferWire({ from: randomAddress(), feePayer: wallet })),
        pubkey(wallet),
      ),
    ).toEqual({ ok: false, code: "POLICY_REJECTED" });
    expect(
      evaluatePolicy(
        decodeTransaction(walletTransferWire({ from: randomAddress() })),
        pubkey(wallet),
      ),
    ).toEqual({ ok: false, code: "WALLET_MISMATCH" });
  });

  it("refuses a transfer another key co-signs", () => {
    const wallet = randomAddress();
    const other = randomAddress();
    const coreTransfer = {
      programAddress: "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d" as Address,
      accounts: [
        { address: randomAddress(), role: 1 as const },
        { address: randomAddress(), role: 0 as const },
        { address: other, role: 3 as const },
        { address: wallet, role: 2 as const },
        { address: randomAddress(), role: 0 as const },
      ],
      data: Uint8Array.of(14, 0),
    };
    const wire = encodeWire({ feePayer: wallet, instructions: [coreTransfer] });
    expect(evaluatePolicy(decodeTransaction(wire), pubkey(wallet))).toEqual({
      ok: false,
      code: "POLICY_REJECTED",
    });
  });

  it("refuses top-level token instructions that hand over control or can't be read", () => {
    const wallet = randomAddress();
    const tokenAccount = randomAddress();
    const token = (data: number[], accounts: Address[]) => ({
      programAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address,
      accounts: accounts.map((address) => ({
        address,
        role: address === wallet ? (2 as const) : (1 as const),
      })),
      data: Uint8Array.from(data),
    });
    for (const ix of [
      // Close with the rent going to someone else.
      token([9], [tokenAccount, randomAddress(), wallet]),
      // Approve a delegate.
      token([4, 1, 0, 0, 0, 0, 0, 0, 0], [tokenAccount, randomAddress(), wallet]),
      // Burn: not something the signer reads as a transfer.
      token([8, 1, 0, 0, 0, 0, 0, 0, 0], [tokenAccount, randomAddress(), wallet]),
    ]) {
      const wire = encodeWire({ feePayer: wallet, instructions: [ix] });
      expect(evaluatePolicy(decodeTransaction(wire), pubkey(wallet))).toEqual({
        ok: false,
        code: "POLICY_REJECTED",
      });
    }
    // Closing its own account with the rent back to itself is fine.
    const close = encodeWire({
      feePayer: wallet,
      instructions: [token([9], [tokenAccount, wallet, wallet])],
    });
    const closed = evaluatePolicy(decodeTransaction(close), pubkey(wallet));
    expect(closed.ok && closed.summary.instructions[0]!.inner?.[0]!.title).toBe(
      "Close token account",
    );
  });

  it("names the recipient of a top-level token send when the same transaction opens their account", () => {
    const wallet = randomAddress();
    const recipient = randomAddress();
    const ata = randomAddress();
    const mint = randomAddress();
    const createAta = {
      programAddress: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address,
      accounts: [
        { address: wallet, role: 3 as const },
        { address: ata, role: 1 as const },
        { address: recipient, role: 0 as const },
        { address: mint, role: 0 as const },
        { address: "11111111111111111111111111111111" as Address, role: 0 as const },
        { address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address, role: 0 as const },
      ],
      data: Uint8Array.of(1),
    };
    const transfer = {
      programAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address,
      accounts: [
        { address: randomAddress(), role: 1 as const },
        { address: mint, role: 0 as const },
        { address: ata, role: 1 as const },
        { address: wallet, role: 2 as const },
      ],
      data: Uint8Array.from([12, 1, 0, 0, 0, 0, 0, 0, 0, 0]),
    };
    const wire = encodeWire({ feePayer: wallet, instructions: [createAta, transfer] });
    const result = evaluatePolicy(decodeTransaction(wire), pubkey(wallet));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.instructions.map((i) => i.kind)).toEqual(["transfer", "transfer"]);
    expect(result.summary.instructions[1]!.inner?.[0]!.details).toContainEqual({
      label: "To",
      value: recipient,
    });
  });

  it("allows a secp256r1 verify only beside a link", () => {
    const owner = randomAddress();
    const verify = {
      programAddress: "Secp256r1SigVerify1111111111111111111111111" as Address,
      data: new Uint8Array(16),
    };
    const [unlink] = decodeTransaction(removeOwnerWire({ owner, feePayer: owner })).message
      .instructions;
    const wire = encodeWire({ feePayer: owner, instructions: [verify, unlink] });
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
        unlink,
      ],
    });
    const result = previewPolicy(decodeTransaction(wire));
    expect(result.ok && result.summary.config).toEqual({
      computeUnitLimit: 200_000,
      priorityFeeLamports: 10_000n,
    });
  });
});
