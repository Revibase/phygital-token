import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { address, getBase58Decoder, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { getPhygitalTokenEncoder } from 'phygital-token-sdk';

import { bytesToBase64, bytesToBase64Url } from '$lib/shared/encoding';
import { MIGRATIONS, createTestD1 } from './support/d1-sqlite';
import { fakeAccessory } from './support/fixtures';
import { issueOwnerLoginChallenge, verifyOwnerBrowse, verifyOwnerLogin } from '$lib/server/accessory/owner-browse';

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

describe('owner login (owner_session)', () => {
	it('accepts a fresh message signature, once', async () => {
		const w = walletKey();
		const db = createTestD1([MIGRATIONS]);
		const { challengeId, message } = await issueOwnerLoginChallenge(db);
		const signature = bytesToBase64Url(ed25519.sign(new TextEncoder().encode(message), w.secret));

		expect(await verifyOwnerLogin(db, { challengeId, address: w.address, signature })).toEqual({ ok: true, wallet: w.address });
		expect(await verifyOwnerLogin(db, { challengeId, address: w.address, signature })).toMatchObject({ ok: false, code: 'too_slow' });
	});

	it('rejects a signature from another key', async () => {
		const w = walletKey();
		const other = walletKey();
		const db = createTestD1([MIGRATIONS]);
		const { challengeId, message } = await issueOwnerLoginChallenge(db);
		const signature = bytesToBase64Url(ed25519.sign(new TextEncoder().encode(message), other.secret));

		expect(await verifyOwnerLogin(db, { challengeId, address: w.address, signature })).toMatchObject({ ok: false, code: 'bad_signature' });
	});
});

describe('owner_browse', () => {
	async function linkedTo(wallet: string) {
		const acc = fakeAccessory();
		const data = new Uint8Array(
			getPhygitalTokenEncoder().encode(acc.account({ linkedWallet: address(wallet), tokenType: 2, isLocked: 1 }))
		);
		return { pda: await acc.pda(), rpc: rpcWith(data) };
	}

	it('admits the logged-in wallet the accessory is linked to', async () => {
		const owner = walletKey();
		const { pda, rpc } = await linkedTo(owner.address);
		expect(await verifyOwnerBrowse(rpc, owner.address, pda)).toMatchObject({ ok: true, pda });
	});

	it('rejects a wallet that isn’t the linked one', async () => {
		const owner = walletKey();
		const { pda, rpc } = await linkedTo(owner.address);
		expect(await verifyOwnerBrowse(rpc, walletKey().address, pda)).toMatchObject({ ok: false, code: 'not_owner' });
	});
});
