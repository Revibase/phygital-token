import { ApiClientError, postJson } from '../api';
import { signMessageWithWallet, type SigningContext } from '../wallet/wallet';

/** Log in with the wallet: one Sign-In With Solana message (not a transaction), then the server remembers this browser. */
async function loginOwner(ctx: SigningContext): Promise<void> {
	const { challengeId, message } = await postJson<{ challengeId: string; message: string }>(
		'/api/owner/challenge',
		{ address: ctx.address }
	);
	const signature = await signMessageWithWallet(ctx, message);
	await postJson('/api/owner/session', {
		challengeId,
		address: ctx.address,
		signature
	});
}

/** Open an accessory the wallet owns. Signs only if this browser isn't logged in as that wallet. */
export async function openOwnedAccessory(ctx: SigningContext, pda: string): Promise<void> {
	const open = () => postJson('/api/accessory/owner-browse', { pda, address: ctx.address });
	try {
		await open();
	} catch (err) {
		if (!(err instanceof ApiClientError) || err.code !== 'unauthenticated') throw err;
		await loginOwner(ctx);
		await open();
	}
}
