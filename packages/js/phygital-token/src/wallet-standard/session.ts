import { address, type Address, type Rpc, type SolanaRpcApi } from "@solana/kit";
import { SOLANA_MAINNET_CHAIN } from "@solana/wallet-standard-chains";
import {
  fetchMaybeAccessoryPolicy,
  fetchPhygitalToken,
  findPolicyPda,
} from "../generated/index.js";

const STORAGE_KEY = "revibase:wallet-standard:v4";
const DEFAULT_PUBKEY = "11111111111111111111111111111111";

/** Wallet Standard chains — program is deployed on mainnet only. */
export const PHYGITAL_WALLET_CHAINS = [SOLANA_MAINNET_CHAIN] as const;

/** The connected accessory: its token PDA, wallet PDA and current owner. */
export type PhygitalWalletSession = {
  phygitalTokenPda: Address;
  walletPda: Address;
  owner: Address;
};

type StoredSession = {
  phygitalTokenPda: string;
  walletPda: string;
  owner: string;
};

/** Throws without an owner or an accessory policy (taps are blocked). */
export async function resolveWalletSession(
  rpc: Rpc<SolanaRpcApi>,
  phygitalTokenPda: Address,
): Promise<PhygitalWalletSession> {
  const [policyPda] = await findPolicyPda({ phygitalToken: phygitalTokenPda });
  const [{ data: token }, policy] = await Promise.all([
    fetchPhygitalToken(rpc, phygitalTokenPda),
    fetchMaybeAccessoryPolicy(rpc, policyPda),
  ]);
  if (token.owner === DEFAULT_PUBKEY) {
    throw new Error("Revibase wallet is disabled: this accessory has no owner");
  }
  if (!policy.exists) {
    throw new Error("Revibase wallet is disabled: the owner has not set an accessory policy");
  }
  return { phygitalTokenPda, walletPda: policy.data.wallet, owner: token.owner };
}

function storage(): Storage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadPhygitalWalletSession(): PhygitalWalletSession | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.phygitalTokenPda !== "string" ||
      typeof parsed.walletPda !== "string" ||
      typeof parsed.owner !== "string" ||
      !parsed.phygitalTokenPda ||
      !parsed.walletPda ||
      !parsed.owner
    ) {
      store.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      phygitalTokenPda: address(parsed.phygitalTokenPda),
      walletPda: address(parsed.walletPda),
      owner: address(parsed.owner),
    };
  } catch {
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable: nothing to clear.
    }
    return null;
  }
}

export function savePhygitalWalletSession(session: PhygitalWalletSession): void {
  const store = storage();
  if (!store) return;
  const payload: StoredSession = {
    phygitalTokenPda: String(session.phygitalTokenPda),
    walletPda: String(session.walletPda),
    owner: String(session.owner),
  };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — connection still works in-memory.
  }
}

export function clearPhygitalWalletSession(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

/** @internal test helper */
export const PHYGITAL_WALLET_SESSION_STORAGE_KEY = STORAGE_KEY;
