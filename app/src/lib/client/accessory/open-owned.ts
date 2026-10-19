import { goto } from '$app/navigation';

import { ApiClientError, postJson } from '../api';
import { passkeyPublicKeyFor } from '../wallet/passkey.svelte';
import { signMessageWithWallet, walletStore, type SigningContext } from '../wallet/wallet.svelte';

/** Log in with the wallet: one Sign-In With Solana message (not a transaction), then the server remembers this browser. */
async function loginOwner(ctx: SigningContext): Promise<void> {
	const { challengeId, message } = await postJson<{ challengeId: string; message: string }>(
		'/api/owner/challenge',
		{ address: ctx.address }
	);
	const signature = await signMessageWithWallet(ctx, message);
	// Revibase Passkey signs with a passkey; the server derives the vault from its public key.
	const passkeyPublicKey = ctx.passkey ? passkeyPublicKeyFor(ctx.address) : null;
	await postJson('/api/owner/session', {
		challengeId,
		address: ctx.address,
		signature,
		...(passkeyPublicKey ? { passkeyPublicKey } : {})
	});
}

/** Open an accessory the wallet owns. Signs only if this browser isn't logged in as that wallet. */
export async function openOwnedAccessory(pda: string): Promise<void> {
	const ctx = walletStore.signingContext();
	const open = () => postJson('/api/accessory/owner-browse', { pda, address: ctx.address });
	try {
		await open();
	} catch (err) {
		if (!(err instanceof ApiClientError) || err.code !== 'unauthenticated') throw err;
		await loginOwner(ctx);
		await open();
	}
	await goto('/accessory', { refreshAll: true });
}
