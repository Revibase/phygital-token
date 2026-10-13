import type { Wallet } from "@wallet-standard/base";

import type { PhygitalWalletSession } from "./session.js";

/** Wallet Standard feature name for reading the connected accessory's session. */
export const RevibaseAccessory = "revibase:accessory";

/** `refresh: true` re-reads the session from the chain instead of the cache. */
export type RevibaseAccessoryGetSessionOptions = { refresh?: boolean };

/** The `revibase:accessory` Wallet Standard feature. */
export type RevibaseAccessoryFeature = {
  [RevibaseAccessory]: {
    version: "1.0.0";
    /**
     * Owner, phygital token PDA and wallet PDA of the connected accessory;
     * null when not connected. `refresh` re-reads the chain.
     */
    getSession(options?: RevibaseAccessoryGetSessionOptions): Promise<PhygitalWalletSession | null>;
  };
};

/** The connected accessory's session, or null for any other wallet. */
export async function getRevibaseAccessorySession(
  wallet: Wallet,
  options?: RevibaseAccessoryGetSessionOptions,
): Promise<PhygitalWalletSession | null> {
  const feature = (wallet.features as Partial<RevibaseAccessoryFeature>)[RevibaseAccessory];
  return feature ? feature.getSession(options) : null;
}
