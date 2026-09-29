import { goto } from '$app/navigation';

import { postJson } from '../api';
import { signMessageWithWallet, walletStore } from '../wallet/wallet.svelte';

export async function openOwnedAccessory(pda: string): Promise<void> {
	const ctx = walletStore.signingContext();
	const { challengeId, message } = await postJson<{ challengeId: string; message: string }>(
		'/api/accessory/owner-browse/challenge'
	);
	const signature = await signMessageWithWallet(ctx, message);
	await postJson('/api/accessory/owner-browse', {
		challengeId,
		pda,
		address: ctx.address,
		signature
	});
	await goto('/accessory', { invalidateAll: true });
}
