import { getAddressEncoder, type Address } from "@solana/kit";
import type { IdentifierArray, WalletAccount } from "@wallet-standard/base";
import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
} from "@solana/wallet-standard-features";

import { PHYGITAL_WALLET_CHAINS } from "./session.js";
import { REVIBASE_WALLET_ICON } from "./icon.js";

const addressEncoder = getAddressEncoder();

const ACCOUNT_FEATURES = [SolanaSignAndSendTransaction, SolanaSignTransaction] as const;

export function createPhygitalWalletAccount(
  walletPda: Address,
  chains: IdentifierArray = PHYGITAL_WALLET_CHAINS,
): WalletAccount {
  const publicKey = new Uint8Array(addressEncoder.encode(walletPda));
  return Object.freeze({
    address: String(walletPda),
    publicKey,
    chains: Object.freeze<IdentifierArray>([...chains]),
    features: Object.freeze([...ACCOUNT_FEATURES]),
    label: "Revibase Accessory",
    icon: REVIBASE_WALLET_ICON,
  });
}
