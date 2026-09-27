import { describe, expect, it } from 'vitest';

import { signToken, verifyToken, type AccessorySession } from './cookies';

const SECRET = 'x'.repeat(48);
const session: AccessorySession = { v: 1, t: 'acc', sid: 'sid', pda: 'pda', identifier: 'id', exp: Date.now() + 60_000 };

describe('session tokens', () => {
	it('round-trips a signed session', async () => {
		const token = await signToken(SECRET, session);
		expect(await verifyToken<AccessorySession>(SECRET, token, 'acc')).toEqual(session);
	});

	it('rejects tampering, the wrong secret, the wrong type, and expiry', async () => {
		const token = await signToken(SECRET, session);
		const [body, mac] = token.split('.');
		const forged = Buffer.from(JSON.stringify({ ...session, pda: 'someone-else' })).toString('base64url');
		expect(await verifyToken(SECRET, `${forged}.${mac}`, 'acc')).toBeNull();
		expect(await verifyToken('y'.repeat(48), token, 'acc')).toBeNull();
		expect(await verifyToken(SECRET, token, 'hof')).toBeNull();
		expect(await verifyToken(SECRET, token, 'acc', session.exp + 1)).toBeNull();
		expect(await verifyToken(SECRET, `${body}.${mac}.x`, 'acc')).toBeNull();
		expect(await verifyToken(SECRET, undefined, 'acc')).toBeNull();
	});
});
