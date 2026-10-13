import { address } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import {
  canSpendLamports,
  DEFAULT_PREPAID_FEE_LAMPORTS,
  getRefillInstruction,
  networkFeeLamports,
  parseSolTransfer,
  planFee,
  topUpNeeded,
  WALLET_RENT_EXEMPT_LAMPORTS,
} from "../wallet/fees.js";
import { createSponsorFeePayers, fetchSponsor, pickFeePayer } from "../wallet/fee-payer.js";
import { PolicyDeniedError } from "../wallet/preview.js";

const WALLET = address("So11111111111111111111111111111111111111112");
const POOL_A = address("11111111111111111111111111111112");
const POOL_B = address("SysvarC1ock11111111111111111111111111111111");

describe("network fees", () => {
  it("charges every signature, precompile ones included, plus the priority fee", () => {
    expect(
      networkFeeLamports({ signatures: 2, precompileSignatures: 1, priorityFeeLamports: 3_000n }),
    ).toBe(18_000n);
  });

  it("uses the prepaid balance until it can't cover twice the cost", () => {
    const prepaid = DEFAULT_PREPAID_FEE_LAMPORTS;
    expect(planFee({ balance: 100_000n, prepaid, cost: 20_000n })).toEqual({ refill: 0n });
    expect(planFee({ balance: 30_000n, prepaid, cost: 20_000n })).toEqual({
      refill: prepaid - 30_000n + 20_000n,
    });
  });

  it("always refills at least the shortfall, and never a negative amount", () => {
    expect(planFee({ balance: 0n, prepaid: 0n, cost: 20_000n })).toEqual({ refill: 20_000n });
    expect(planFee({ balance: 30_000n, prepaid: 0n, cost: 20_000n })).toEqual({ refill: 0n });
  });

  it("keeps the wallet at zero or rent-exempt", () => {
    expect(canSpendLamports(5_000_000n, 5_000_000n)).toBe(true);
    expect(canSpendLamports(5_000_000n, 5_000_000n - WALLET_RENT_EXEMPT_LAMPORTS)).toBe(true);
    expect(canSpendLamports(5_000_000n, 4_500_000n)).toBe(false);
    expect(topUpNeeded(4_000_000n, 5_000_000n)).toBe(
      5_000_000n + WALLET_RENT_EXEMPT_LAMPORTS - 4_000_000n,
    );
    expect(topUpNeeded(9_000_000n, 5_000_000n)).toBe(0n);
  });

  it("builds a refill the server can read back", () => {
    const ix = getRefillInstruction(WALLET, POOL_A, 4_980_000n);
    expect(parseSolTransfer(ix)).toEqual({ from: WALLET, to: POOL_A, lamports: 4_980_000n });
    expect(parseSolTransfer({ ...ix, data: new Uint8Array(12) })).toBeNull();
  });
});

describe("fee service client", () => {
  const respond = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("reads the pool, its limits and the accessory's prepaid fees", async () => {
    const fetchMock = respond({
      feePayers: [POOL_A, POOL_B],
      maxComputeUnitLimit: 400_000,
      maxComputeUnitPrice: "100000",
      balanceLamports: "4200000",
      prepaidLamports: "5000000",
    });
    const info = await fetchSponsor({
      endpoint: "https://fees.test/api/sponsor/",
      fetch: fetchMock,
      phygitalToken: WALLET,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://fees.test/api/sponsor?accessory=${WALLET}`,
      expect.anything(),
    );
    expect(info).toEqual({
      feePayers: [POOL_A, POOL_B],
      limits: { maxComputeUnitLimit: 400_000, maxComputeUnitPriceMicroLamports: 100_000n },
      prepaid: { balanceLamports: 4_200_000n, prepaidLamports: 5_000_000n },
    });
  });

  it("makes one partial signer per pool key and picks among them", async () => {
    const signers = await createSponsorFeePayers({
      fetch: respond({ feePayers: [POOL_A, POOL_B] }),
    });
    expect(signers.map((s) => s.address)).toEqual([POOL_A, POOL_B]);
    expect(signers).toContain(pickFeePayer(signers));
  });

  it("surfaces fee-service denials as PolicyDeniedError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ feePayers: [POOL_A] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "refill_required",
            error: "Refill needed",
            details: { neededLamports: "10" },
          }),
          { status: 402 },
        ),
      );
    const [signer] = await createSponsorFeePayers({ fetch: fetchMock });
    await expect(
      signer.signTransactions([
        { messageBytes: new Uint8Array(1), signatures: { [POOL_A]: null } } as never,
      ]),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("rejects an empty pool", async () => {
    await expect(fetchSponsor({ fetch: respond({ feePayers: [] }) })).rejects.toThrow(
      /no fee payers/,
    );
  });
});
