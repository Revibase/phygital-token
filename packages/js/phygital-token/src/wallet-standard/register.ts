import { registerWallet } from "@wallet-standard/wallet";

import { PhygitalWallet, type PhygitalWalletOptions } from "./wallet.js";

const registered = new WeakSet<object>();

/**
 * Register Revibase as a Wallet Standard wallet. Call once at app startup;
 * idempotent per `rpc`. Connecting taps the accessory and exposes its token's
 * wallet PDA (needs an owner and an accessory policy); the session persists.
 */
export function registerPhygitalWallet(options: PhygitalWalletOptions): void {
  if (registered.has(options.rpc)) return;
  registerWallet(new PhygitalWallet(options));
  registered.add(options.rpc);
}

export type { PhygitalWalletOptions };
