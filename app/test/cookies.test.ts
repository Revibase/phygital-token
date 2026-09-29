import { describe, expect, it } from 'vitest';

import {
	signToken,
	verifyToken,
	type BrowseUnlockSession,
	type OwnerBrowseSession,
	type OwnerSession
} from '$lib/server/session/cookies';

const SECRET = 'x'.repeat(48);
const browse: BrowseUnlockSession = {
	v: 1,
	t: 'bu',
	sid: 'sid',
	pda: 'pda',
	identifier: 'id',
	exp: Date.now() + 60_000
};
const owner: OwnerBrowseSession = {
	v: 1,
	t: 'ob',
	sid: 'sid2',
	pda: 'pda',
	identifier: 'id',
	wallet: '7Yu3oPKm7hSbcX3u7ke1HMuiKeuuSJo4iQ8PYP6VGkCN',
	exp: Date.now() + 60_000
};

describe('session tokens', () => {
	it('round-trips a browse_unlock session', async () => {
		const token = await signToken(SECRET, browse);
		expect(await verifyToken<BrowseUnlockSession>(SECRET, token, 'bu')).toEqual(browse);
	});

	it('round-trips an owner_browse session', async () => {
		const token = await signToken(SECRET, owner);
		expect(await verifyToken<OwnerBrowseSession>(SECRET, token, 'ob')).toEqual(owner);
	});

	it('round-trips an owner_session and never verifies it as owner_browse', async () => {
		const login: OwnerSession = { v: 1, t: 'os', sid: 'sid3', wallet: owner.wallet, exp: Date.now() + 60_000 };
		const token = await signToken(SECRET, login);
		expect(await verifyToken<OwnerSession>(SECRET, token, 'os')).toEqual(login);
		expect(await verifyToken<OwnerBrowseSession>(SECRET, token, 'ob')).toBeNull();
	});

	it('never verifies a browse_unlock token as owner_browse (or the reverse)', async () => {
		const bu = await signToken(SECRET, browse);
		const ob = await signToken(SECRET, owner);
		expect(await verifyToken(SECRET, bu, 'ob')).toBeNull();
		expect(await verifyToken(SECRET, ob, 'bu')).toBeNull();
	});

	it('rejects tampering, the wrong secret, the wrong type, and expiry', async () => {
		const token = await signToken(SECRET, browse);
		const [body, mac] = token.split('.');
		const forged = Buffer.from(JSON.stringify({ ...browse, pda: 'someone-else' })).toString('base64url');
		expect(await verifyToken(SECRET, `${forged}.${mac}`, 'bu')).toBeNull();
		expect(await verifyToken('y'.repeat(48), token, 'bu')).toBeNull();
		expect(await verifyToken(SECRET, token, 'hof')).toBeNull();
		expect(await verifyToken(SECRET, token, 'bu', browse.exp + 1)).toBeNull();
		expect(await verifyToken(SECRET, `${body}.${mac}.x`, 'bu')).toBeNull();
		expect(await verifyToken(SECRET, undefined, 'bu')).toBeNull();
	});
});
