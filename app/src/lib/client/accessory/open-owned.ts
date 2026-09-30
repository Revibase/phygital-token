import { goto } from '$app/navigation';

import { ApiClientError, postJson } from '../api';
import { signMessageWithWallet, walletStore, type SigningContext } from '../wallet/wallet.svelte';

/** Log in with the wallet: one Sign-In With Solana message (not a transaction), then the server remembers this browser. */
export async function loginOwner(ctx: SigningContext): Promise<void> {
	const { challengeId, message } = await postJson<{ challengeId: string; message: string }>('/api/owner/challenge', { address: ctx.address });
	const signature = await signMessageWithWallet(ctx, message);
	await postJson('/api/owner/session', { challengeId, address: ctx.address, signature });
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
	await goto('/accessory', { invalidateAll: true });
}
