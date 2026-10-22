import {
	SolanaSignAndSendTransaction,
	SolanaSignMessage,
	SolanaSignTransaction
} from '@solana/wallet-standard-features';

import { bytesToBase64Url } from '#lib/shared/encoding.ts';

export type Cluster = 'mainnet' | 'devnet' | 'testnet' | 'localnet';

export type SigningContext = {
	address: string;
	chain: `solana:${string}`;
	walletName: string;
	/** True when this is a Privy embedded wallet, which can export its private key. */
	embedded: boolean;
	publicKey: Uint8Array;
	signTransaction?: (wireBytes: Uint8Array) => Promise<Uint8Array>;
	signAndSendTransaction?: (wireBytes: Uint8Array) => Promise<Uint8Array>;
	signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
};

export type SignOutcome =
	{ kind: 'signed'; signedBytes: Uint8Array } | { kind: 'sent'; signature: Uint8Array };

/**
 * Ask the wallet to sign exactly `wireBytes`. Prefer sign-only so the signed
 * copy can be re-validated before it is broadcast.
 */
export async function signWithWallet(
	ctx: SigningContext,
	wireBytes: Uint8Array
): Promise<SignOutcome> {
	if (ctx.signTransaction) {
		const signedBytes = await ctx.signTransaction(wireBytes);
		// A serialized transaction is longer than a raw 64-byte signature.
		if (signedBytes.byteLength <= 64) {
			throw new Error('This wallet didn’t return a signed transaction. Try another wallet.');
		}
		return { kind: 'signed', signedBytes };
	}
	if (ctx.signAndSendTransaction) {
		return { kind: 'sent', signature: await ctx.signAndSendTransaction(wireBytes) };
	}
	throw new Error('This wallet can’t sign Solana transactions.');
}

export async function signMessageWithWallet(ctx: SigningContext, message: string): Promise<string> {
	if (!ctx.signMessage) throw new Error('This wallet can’t sign messages.');
	const signature = await ctx.signMessage(new TextEncoder().encode(message));
	return bytesToBase64Url(signature);
}

export function walletSupports(
	features: Record<string, unknown> | undefined,
	feature: string
): boolean {
	if (!features || Object.keys(features).length === 0) return true;
	return feature in features;
}

export const signFeatures = {
	transaction: SolanaSignTransaction,
	send: SolanaSignAndSendTransaction,
	message: SolanaSignMessage
} as const;
