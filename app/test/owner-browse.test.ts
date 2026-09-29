import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { address, getBase58Decoder, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { getPhygitalTokenEncoder } from 'phygital-token-sdk';

import { bytesToBase64, bytesToBase64Url } from '$lib/shared/encoding';
import { MIGRATIONS, createTestD1 } from './support/d1-sqlite';
import { fakeAccessory } from './support/fixtures';
import { issueOwnerBrowseChallenge, verifyOwnerBrowse } from '$lib/server/accessory/owner-browse';

function rpcWith(account: Uint8Array | null) {
	return {
		getAccountInfo: () => ({
			send: async () => ({
				value: account
					? {
							data: [bytesToBase64(account), 'base64'],
							executable: false,
							lamports: 1n,
							owner: 'DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ',
							space: BigInt(account.length)
						}
					: null
			})
		})
	} as unknown as Rpc<SolanaRpcApi>;
}

function walletKey() {
	const secret = ed25519.utils.randomSecretKey();
	const publicKey = ed25519.getPublicKey(secret);
	const addr = String(address(getBase58Decoder().decode(publicKey)));
	return { secret, address: addr };
}

describe('owner_browse', () => {
	it('admits the linked wallet after a fresh message signature', async () => {
		const w = walletKey();
		const acc = fakeAccessory();
		const pda = await acc.pda();
		const data = new Uint8Array(
			getPhygitalTokenEncoder().encode(acc.account({ linkedWallet: address(w.address), tokenType: 2, isLocked: 1 }))
		);
		const db = createTestD1([MIGRATIONS]);
		const deps = { db, rpc: rpcWith(data) };
		const { challengeId, message } = await issueOwnerBrowseChallenge(db);
		const signature = bytesToBase64Url(ed25519.sign(new TextEncoder().encode(message), w.secret));

		expect(await verifyOwnerBrowse(deps, { challengeId, pda, address: w.address, signature })).toMatchObject({
			ok: true,
			pda,
			wallet: w.address
		});
	});

	it('rejects a wallet that isn’t the linked one', async () => {
		const owner = walletKey();
		const stranger = walletKey();
		const acc = fakeAccessory();
		const pda = await acc.pda();
		const data = new Uint8Array(
			getPhygitalTokenEncoder().encode(acc.account({ linkedWallet: address(owner.address), tokenType: 2, isLocked: 1 }))
		);
		const db = createTestD1([MIGRATIONS]);
		const deps = { db, rpc: rpcWith(data) };
		const { challengeId, message } = await issueOwnerBrowseChallenge(db);
		const signature = bytesToBase64Url(ed25519.sign(new TextEncoder().encode(message), stranger.secret));

		expect(
			await verifyOwnerBrowse(deps, { challengeId, pda, address: stranger.address, signature })
		).toMatchObject({ ok: false, code: 'not_owner' });
	});

	it('rejects a bad signature', async () => {
		const w = walletKey();
		const acc = fakeAccessory();
		const pda = await acc.pda();
		const data = new Uint8Array(
			getPhygitalTokenEncoder().encode(acc.account({ linkedWallet: address(w.address), tokenType: 2, isLocked: 1 }))
		);
		const db = createTestD1([MIGRATIONS]);
		const { challengeId } = await issueOwnerBrowseChallenge(db);
		const signature = bytesToBase64Url(new Uint8Array(64));

		expect(
			await verifyOwnerBrowse({ db, rpc: rpcWith(data) }, { challengeId, pda, address: w.address, signature })
		).toMatchObject({ ok: false, code: 'bad_signature' });
	});
});
