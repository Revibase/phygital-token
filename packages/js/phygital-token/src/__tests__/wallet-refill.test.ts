import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64Decoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAccessoryPolicyEncoder,
  PHYGITAL_TOKEN_ERROR__PREVIEW_PASSED,
  PHYGITAL_TOKEN_ERROR__SPEND_LIMIT_EXCEEDED,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
} from "../generated/index.js";
import { getPhygitalWalletSigner } from "../wallet/signer.js";
import {
  AccessoryWalletTopUpRequired,
  getRefillInstruction,
  RefillBlockedByTapLimit,
} from "../wallet/fees.js";

const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const WALLET = address("So11111111111111111111111111111111111111112");
const POOL = address("11111111111111111111111111111112");
const RECIPIENT = address("SysvarC1ock11111111111111111111111111111111");
const { STOP, authenticate } = vi.hoisted(() => {
  const STOP = { reason: "tap reached" };
  return { STOP, authenticate: vi.fn(() => Promise.reject(STOP)) };
});
vi.mock("../instructions/verify.js", async (original) => ({
  ...(await original<typeof import("../instructions/verify.js")>()),
  authenticatePasskeyForSecp256r1Verify: () => authenticate(),
}));

type Scenario = { walletLamports: bigint; balanceLamports: bigint; previews: number[] };

function mockRpc(s: Scenario) {
  const policyData = getAccessoryPolicyEncoder().encode({
    phygitalToken: TOKEN,
    wallet: WALLET,
    solCap: null,
    mintCaps: [],
    allowedOrigins: [],
    programPermissions: [],
  });
  const previews = [...s.previews];
  const simulated: string[] = [];
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    getAccountInfo: (target: unknown) =>
      String(target).startsWith("SysvarS1otHashes")
        ? { value: { data: [getBase64Decoder().decode(new Uint8Array(40).fill(7)), "base64"] } }
        : {
            value: {
              data: [getBase64Decoder().decode(new Uint8Array(policyData)), "base64"],
              executable: false,
              lamports: 2_000_000n,
              owner: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
              space: BigInt(policyData.length),
            },
          },
    getRecentPrioritizationFees: () => [{ prioritizationFee: 10_000n, slot: 1n }],
    getLatestBlockhash: () => ({
      value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 10_000n },
    }),
    getBalance: () => ({ value: s.walletLamports }),
    simulateTransaction: (wire: unknown) => {
      simulated.push(String(wire));
      const code = previews.shift() ?? PHYGITAL_TOKEN_ERROR__PREVIEW_PASSED;
      return {
        value: {
          err: { InstructionError: [0, { Custom: code }] },
          logs: [`Program ${PHYGITAL_TOKEN_PROGRAM_ADDRESS} failed: custom program error`],
        },
      };
    },
  };
  const rpc = new Proxy(
    {},
    {
      get:
        (_, method: string) =>
        (...args: unknown[]) => ({ send: async () => methods[method](...args) }),
    },
  ) as Rpc<SolanaRpcApi>;
  return { rpc, simulated };
}

function sponsorFetch(balanceLamports: bigint) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          feePayers: [POOL],
          maxComputeUnitLimit: 400_000,
          maxComputeUnitPrice: "100000",
          balanceLamports: String(balanceLamports),
          prepaidLamports: "5000000",
        }),
      ),
  );
}

function transferFromWallet() {
  const transfer = getRefillInstruction(WALLET, RECIPIENT, 1_000_000n);
  return compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(WALLET, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: "11111111111111111111111111111111" as Blockhash,
            lastValidBlockHeight: 10_000n,
          },
          m,
        ),
      (m) =>
        appendTransactionMessageInstructions(
          [
            {
              ...transfer,
              accounts: [
                { ...transfer.accounts![0], signer: createNoopSigner(WALLET) },
                transfer.accounts![1],
              ],
            },
          ],
          m,
        ),
    ),
  );
}

async function sign(s: Scenario) {
  const { rpc, simulated } = mockRpc(s);
  const onFeePlan = vi.fn();
  const signer = await getPhygitalWalletSigner(rpc, TOKEN, {
    fetch: sponsorFetch(s.balanceLamports),
    feeEndpoint: "https://fees.test/api/sponsor",
    onFeePlan,
  });
  const error = await signer.modifyAndSignTransactions([transferFromWallet() as never]).then(
    () => null,
    (e: unknown) => e,
  );
  return { error, onFeePlan, simulated };
}

describe("getPhygitalWalletSigner prepaid network fees", () => {
  beforeEach(() => {
    authenticate.mockClear();
  });

  it("uses the prepaid balance without a refill while it lasts", async () => {
    const { error, onFeePlan } = await sign({
      walletLamports: 0n,
      balanceLamports: 4_000_000n,
      previews: [],
    });
    expect(error).toBe(STOP);
    expect(onFeePlan).toHaveBeenCalledWith({ source: "free", refillLamports: 0n });
  });

  it("refills back to the prepaid amount before the tap when the balance runs low", async () => {
    const { error, onFeePlan } = await sign({
      walletLamports: 1_000_000_000n,
      balanceLamports: 1_000n,
      previews: [],
    });
    expect(error).toBe(STOP);
    const [[plan]] = onFeePlan.mock.calls as [[{ source: string; refillLamports: bigint }]];
    expect(plan.source).toBe("refill");
    expect(plan.refillLamports).toBeGreaterThan(5_000_000n - 1_000n);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it("asks for a top-up before the tap when the accessory wallet can't refill", async () => {
    const { error } = await sign({ walletLamports: 1_000n, balanceLamports: 0n, previews: [] });
    expect(error).toBeInstanceOf(AccessoryWalletTopUpRequired);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("reports a refill the tap-payment limits block, before the tap", async () => {
    const { error, simulated } = await sign({
      walletLamports: 1_000_000_000n,
      balanceLamports: 0n,
      previews: [PHYGITAL_TOKEN_ERROR__SPEND_LIMIT_EXCEEDED, PHYGITAL_TOKEN_ERROR__PREVIEW_PASSED],
    });
    expect(error).toBeInstanceOf(RefillBlockedByTapLimit);
    expect((error as RefillBlockedByTapLimit).manageUrl).toBe(
      `https://portal.revibase.com/wallet/${TOKEN}`,
    );
    expect(simulated).toHaveLength(2);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("keeps a limit the transaction itself breaks as a policy denial", async () => {
    const { error } = await sign({
      walletLamports: 1_000_000_000n,
      balanceLamports: 0n,
      previews: [
        PHYGITAL_TOKEN_ERROR__SPEND_LIMIT_EXCEEDED,
        PHYGITAL_TOKEN_ERROR__SPEND_LIMIT_EXCEEDED,
      ],
    });
    expect(error).toMatchObject({ name: "PolicyDeniedError", code: "spend_limit" });
  });
});
