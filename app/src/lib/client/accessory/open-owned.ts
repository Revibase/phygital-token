import { goto } from '$app/navigation';

import { postJson } from '../api';
import { bytesToBase64Url } from '$lib/shared/encoding';
import { signMessageWithWallet, walletStore } from '../wallet/wallet.svelte';

/**
 * Open an accessory the connected wallet already owns: challenge → signMessage
 * → owner_browse cookie → `/accessory`. Mirrors phygital-wallet's quiet
 * authority-browse admit from Home.
 */
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

/** For tests / callers that already have a signature. */
export function encodeOwnerBrowseSignature(sig: Uint8Array): string {
	return bytesToBase64Url(sig);
}
