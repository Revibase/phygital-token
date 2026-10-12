import type { Wallet } from "@wallet-standard/base";

import type { PhygitalWalletSession } from "./session.js";

export const RevibaseAccessory = "revibase:accessory";

export type RevibaseAccessoryGetSessionOptions = { refresh?: boolean };

export type RevibaseAccessoryFeature = {
  [RevibaseAccessory]: {
    version: "1.0.0";
    /**
     * Owner, phygital token PDA and wallet PDA of the connected accessory;
     * null when not connected. `refresh` re-reads the chain.
     */
    getSession(
      options?: RevibaseAccessoryGetSessionOptions
    ): Promise<PhygitalWalletSession | null>;
  };
};

/** The connected accessory's session, or null for any other wallet. */
export async function getRevibaseAccessorySession(
  wallet: Wallet,
  options?: RevibaseAccessoryGetSessionOptions
): Promise<PhygitalWalletSession | null> {
  const feature = (wallet.features as Partial<RevibaseAccessoryFeature>)[
    RevibaseAccessory
  ];
  return feature ? feature.getSession(options) : null;
}
