/**
 * Revibase Passkey (revibase-wallet): a Wallet Standard wallet whose keys live
 * in the secure-signer iframe, registered so `@solana/connector` lists it next
 * to installed wallets.
 *
 * Its address is a vault PDA, so it can't pay fees: the Revibase fee payer
 * signs last and submits through `/api/fee-payer`, and every transaction pays
 * it back in full, plus the wallet's rent on its first one (nothing is
 * sponsored; see `server/fee-payer/policy.ts`).
 */
import { address, type Address } from '@solana/kit';
import {
	loadPasskeyWalletSession,
	registerPasskeyWallet,
	type FeePayerService,
	type PasskeyWalletHandle
} from 'revibase-wallet-sdk';

import { bytesToBase64 } from '#lib/shared/encoding.ts';
import { PASSKEY_WALLET_NAME } from '#lib/shared/passkey-transaction.ts';
import { ApiClientError, postJson } from '../api';

export { PASSKEY_WALLET_NAME };
export const PASSKEY_WALLET_HINT = 'Face ID or fingerprint · no app needed';

export type PasskeyConfig = { origin: string; feePayer: string };

/** Whether the signer frame is showing a prompt, and how tall it wants to be. */
export const passkeyFrame = $state({ open: false, height: 0 });

let config: PasskeyConfig | null = null;
let handle: PasskeyWalletHandle | null = null;

/**
 * The Revibase fee payer, as a service: `/api/fee-payer` checks the transaction
 * pays it back exactly, signs last and submits, then returns the signature.
 */
function feePayerService(feePayer: Address): FeePayerService {
	return {
		address: feePayer,
		signAndSend: async (wire) => {
			try {
				const { signature } = await postJson<{ signature: string }>('/api/fee-payer', {
					transaction: bytesToBase64(wire)
				});
				return signature;
			} catch (err) {
				// Lost before an answer: it may have been submitted. Never retry blindly,
				// since a retry is a second approval and could send twice.
				if (err instanceof ApiClientError && err.code === 'network')
					throw new ApiClientError(0, 'submit_unknown', err.message);
				throw err;
			}
		}
	};
}

export function registerPasskey(
	iframe: HTMLIFrameElement,
	next: PasskeyConfig,
	rpcUrl: string
): () => void {
	if (handle) return () => {};
	config = next;
	handle = registerPasskeyWallet({
		origin: next.origin,
		iframe,
		rpcUrl,
		feePayer: feePayerService(address(next.feePayer)),
		onHeight: (height) => (passkeyFrame.height = height),
		onActivity: (active) => (passkeyFrame.open = active)
	});
	return () => {
		handle?.destroy();
		handle = null;
		config = null;
		passkeyFrame.open = false;
	};
}

/** The fee payer when `walletName` is Revibase Passkey, else null (the wallet pays). */
export function passkeyFeePayer(walletName: string | null | undefined): string | null {
	return walletName === PASSKEY_WALLET_NAME ? (config?.feePayer ?? null) : null;
}

/** The passkey behind a vault: the server derives the vault from it to check a sign-in. */
export function passkeyPublicKeyFor(vault: string): string | null {
	const session = loadPasskeyWalletSession();
	return session?.vault === vault ? session.publicKey : null;
}

/** The connected passkey session (wallet config address and credential), if any. */
export function passkeySession() {
	return handle?.getSession() ?? loadPasskeyWalletSession();
}
