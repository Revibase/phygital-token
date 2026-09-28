import { describe, expect, it } from 'vitest';
import { address, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { getPhygitalTokenEncoder } from 'phygital-token-sdk';

import { bytesToBase64 } from '$lib/shared/encoding';
import { MIGRATIONS, createTestD1 } from '../testing/d1-sqlite';
import { fakeAccessory, ORIGIN, RP_ID } from '../testing/fixtures';
import { issueSignInChallenge, verifySignIn } from './signin';

const W = '7Yu3oPKm7hSbcX3u7ke1HMuiKeuuSJo4iQ8PYP6VGkCN';

function rpcWith(account: Uint8Array | null) {
	return {
		getAccountInfo: () => ({
			send: async () => ({
				value: account
					? { data: [bytesToBase64(account), 'base64'], executable: false, lamports: 1n, owner: 'DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ', space: BigInt(account.length) }
					: null
			})
		})
	} as unknown as Rpc<SolanaRpcApi>;
}

/** A Controlled accessory by default: only personal keys sign in. */
async function setup(linked: string | null = W, tokenType = 2) {
	const acc = fakeAccessory();
	const data = new Uint8Array(
		getPhygitalTokenEncoder().encode(acc.account({ tokenType, isLocked: linked ? 1 : 0, ...(linked ? { linkedWallet: address(linked) } : {}) }))
	);
	const db = createTestD1([MIGRATIONS]);
	const deps = { db, rpc: rpcWith(data), rpId: RP_ID, origin: ORIGIN };
	const { challengeId, message } = await issueSignInChallenge(db);
	const response = acc.assert(new TextEncoder().encode(message));
	return { acc, deps, challengeId, message, response };
}

describe('sign in with accessory', () => {
	it('resolves the linked wallet from a fresh tap', async () => {
		const { deps, challengeId, response } = await setup();
		expect(await verifySignIn(deps, { challengeId, response })).toMatchObject({ ok: true, wallet: W });
	});

	it('reports an authentic but unlinked accessory', async () => {
		const { deps, challengeId, response } = await setup(null);
		expect(await verifySignIn(deps, { challengeId, response })).toMatchObject({ ok: true, wallet: null });
	});

	it('signs in with Permanent accessories too', async () => {
		const { deps, challengeId, response } = await setup(W, 0);
		expect(await verifySignIn(deps, { challengeId, response })).toMatchObject({ ok: true, wallet: W });
	});

	it('refuses Bearer accessories: a tradable collectible never stands in for a wallet', async () => {
		const { deps, challengeId, response } = await setup(W, 1);
		expect(await verifySignIn(deps, { challengeId, response })).toMatchObject({ ok: false, status: 403, code: 'not_a_key' });
	});

	it('challenges are single-use, even after a failed attempt', async () => {
		const { acc, deps, challengeId, response } = await setup();
		expect((await verifySignIn(deps, { challengeId, response })).ok).toBe(true);
		expect(await verifySignIn(deps, { challengeId, response })).toMatchObject({ ok: false, status: 409 });

		const next = await issueSignInChallenge(deps.db);
		const wrong = acc.assert(new TextEncoder().encode('revibase-signin:not-the-challenge'));
		expect(await verifySignIn(deps, { challengeId: next.challengeId, response: wrong })).toMatchObject({ ok: false, status: 401 });
		const right = acc.assert(new TextEncoder().encode(next.message));
		// Challenge already consumed by the failed attempt.
		expect(await verifySignIn(deps, { challengeId: next.challengeId, response: right })).toMatchObject({ ok: false, status: 409 });
	});

	it('only redeems its own namespace in the shared table', async () => {
		const { deps, challengeId, response } = await setup();
		await deps.db.prepare('UPDATE auth_challenges SET namespace = ? WHERE id = ?').bind('phygital-wallet-unlock', challengeId).run();
		expect(await verifySignIn(deps, { challengeId, response })).toMatchObject({ ok: false, status: 409 });
		const other = await deps.db.prepare('SELECT namespace FROM auth_challenges WHERE id = ?').bind(challengeId).first<{ namespace: string }>();
		expect(other?.namespace).toBe('phygital-wallet-unlock'); // untouched
	});

	it('expires challenges', async () => {
		const { deps, challengeId, response } = await setup();
		expect(await verifySignIn(deps, { challengeId, response }, Date.now() + 3 * 60 * 1000)).toMatchObject({ ok: false, status: 409 });
	});
});
