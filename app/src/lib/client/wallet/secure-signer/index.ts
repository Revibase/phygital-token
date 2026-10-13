import { registerWallet } from '@wallet-standard/wallet';

import { SecureSignerClient } from './client';
import { promptLost, promptSetup } from './prompts.svelte';
import { PasskeyWallet } from './wallet';

let client: SecureSignerClient | null = null;
let wallet: PasskeyWallet | null = null;

/** Registers "Revibase Passkey" with Wallet Standard once, for the signer at `origin`. */
export function configureSecureSigner(origin: string) {
	if (client || !origin || typeof window === 'undefined') return;
	client = new SecureSignerClient(origin);
	wallet = new PasskeyWallet(client, { setup: promptSetup, lost: promptLost });
	registerWallet(wallet);
}

export const secureSigner = () => client;
export const passkeyWallet = () => wallet;
export { PASSKEY_WALLET_NAME, PASSKEY_WALLET_HINT, PASSKEY_WALLET_ICON } from './wallet';
