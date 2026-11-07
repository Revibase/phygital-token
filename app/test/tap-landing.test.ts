import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyToken, type EnrollSession } from '#lib/server/session/cookies.ts';
import { bytesToBase64Url } from '#lib/shared/encoding.ts';
import { GET } from '../src/app/api/tap/landing/route';
import { env } from './support/cloudflare-workers';
import { createTestD1 } from './support/d1-sqlite';
import { chip, packCard } from './support/fixtures';

// No card carries any identifier yet.
vi.mock('#lib/server/accessory/resolve.ts', () => ({
	fetchAccessoryByIdentifier: async () => null
}));

const APP = 'https://portal.revibase.test';
const SECRET = 'x'.repeat(48);

describe('tap landing', () => {
	afterEach(() => {
		for (const k of Object.keys(env)) delete env[k];
	});

	function setEnv(db: D1Database) {
		Object.assign(env, {
			SESSION_SECRET: SECRET,
			NEXT_PUBLIC_SOLANA_RPC_URL: 'https://rpc.invalid',
			NEXT_PUBLIC_SOLANA_CLUSTER: 'devnet',
			NEXT_PUBLIC_PRIVY_APP_ID: 'app',
			DB: db as unknown as string
		});
	}

	it('sends a verified tap of a packed card with no token to /enroll with its identifier', async () => {
		const db = createTestD1();
		setEnv(db);
		const card = chip();
		await packCard(db, bytesToBase64Url(card.pk), 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
		const res = await GET(new NextRequest(`${APP}/api/tap/landing?${card.tap(1)}`));
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe(`${APP}/enroll`);
		const cookie = /(?:^|,\s*)en=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
		const session = await verifyToken<EnrollSession>(SECRET, cookie, 'en');
		expect(session?.identifier).toBe(bytesToBase64Url(card.pk));
	});

	it('does not let a card that was never packed enroll', async () => {
		setEnv(createTestD1());
		const res = await GET(new NextRequest(`${APP}/api/tap/landing?${chip().tap(1)}`));
		expect(res.headers.get('location')).toBe(`${APP}/tap/unknown`);
		expect(res.headers.get('set-cookie') ?? '').not.toMatch(/(?:^|,\s*)en=/);
	});
});
