import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

import {
	signToken,
	type BrowseUnlockSession,
	type OwnerBrowseSession
} from '#lib/server/session/cookies.ts';
import { middleware } from '../src/middleware';
import { env } from './support/cloudflare-workers';

const APP = 'https://portal.revibase.test';
const SECRET = 'x'.repeat(48);

async function call(
	path: string,
	init: { method?: string; origin?: string; cookie?: string; pda?: string } = {}
) {
	const url = new URL(path, APP);
	const headers = new Headers();
	if (init.origin) headers.set('origin', init.origin);
	if (init.cookie) headers.set('cookie', init.cookie);
	if (init.pda) headers.set('x-admit-pda', init.pda);
	return middleware(new NextRequest(url, { method: init.method ?? 'POST', headers }));
}

const browse: BrowseUnlockSession = {
	v: 1,
	t: 'bu',
	sid: 'sid',
	pda: 'PdaFromTap',
	identifier: 'chip',
	exp: Date.now() + 60_000
};
const ownerBrowse: OwnerBrowseSession = {
	v: 1,
	t: 'ob',
	sid: 'sid2',
	pda: 'PdaFromOwner',
	identifier: 'chip',
	wallet: '7Yu3oPKm7hSbcX3u7ke1HMuiKeuuSJo4iQ8PYP6VGkCN',
	exp: Date.now() + 60_000
};

describe('middleware', () => {
	it('keeps every state-changing API same-origin', async () => {
		expect((await call('/api/tap/resume', { origin: 'https://evil.example' })).status).toBe(403);
		expect((await call('/api/tap/challenge', { origin: 'https://evil.example' })).status).toBe(403);
		expect((await call('/api/tap/resume', { origin: APP })).status).toBe(200);
		expect(
			(await call('/api/tap/challenge', { method: 'GET', origin: 'https://evil.example' })).status
		).toBe(200);
	});

	it('sends no CORS headers and frames nothing', async () => {
		const res = await call('/api/tap/resume', { origin: APP });
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
		expect(res.headers.get('cache-control')).toBe('no-store');
		const page = await call('/', { method: 'GET' });
		expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
		expect(page.headers.get('content-security-policy')).toContain('https://auth.privy.io');
		// Embedded apps (any project's https origin) take taps in the frame, so `get` is delegable.
		expect(page.headers.get('permissions-policy')).toContain('publickey-credentials-get=*');
		expect(page.headers.get('permissions-policy')).toContain('clipboard-write=*');
		expect(page.headers.get('permissions-policy')).not.toContain('publickey-credentials-create');
	});

	describe('accessory admit', () => {
		afterEach(() => {
			delete env.SESSION_SECRET;
			delete env.NEXT_PUBLIC_SOLANA_RPC_URL;
			delete env.NEXT_PUBLIC_SOLANA_CLUSTER;
			delete env.NEXT_PUBLIC_PRIVY_APP_ID;
		});

		it('sends a signed tap to the landing route before any session exists', async () => {
			const res = await call('/accessory?pk=chip&c=1', { method: 'GET' });
			expect(res.status).toBe(307);
			expect(res.headers.get('location')).toBe(`${APP}/api/tap/landing?pk=chip&c=1`);
		});

		it('refuses /accessory and /accessory/link without an admit cookie', async () => {
			env.SESSION_SECRET = SECRET;
			env.NEXT_PUBLIC_SOLANA_RPC_URL = 'https://rpc.example';
			env.NEXT_PUBLIC_SOLANA_CLUSTER = 'devnet';
			env.NEXT_PUBLIC_PRIVY_APP_ID = 'privy-test';
			for (const path of ['/accessory', '/accessory/link']) {
				const res = await call(path, { method: 'GET', pda: 'forged' });
				expect(res.status).toBe(307);
				expect(res.headers.get('location')).toBe(`${APP}/tap/expired`);
			}
		});

		it('admits a tap to both pages and an owner open only to the view', async () => {
			env.SESSION_SECRET = SECRET;
			env.NEXT_PUBLIC_SOLANA_RPC_URL = 'https://rpc.example';
			env.NEXT_PUBLIC_SOLANA_CLUSTER = 'devnet';
			env.NEXT_PUBLIC_PRIVY_APP_ID = 'privy-test';
			const bu = `bu=${await signToken(SECRET, browse)}`;
			const ob = `ob=${await signToken(SECRET, ownerBrowse)}`;

			const tapped = await call('/accessory', { method: 'GET', cookie: bu, pda: 'forged' });
			expect(tapped.status).toBe(200);
			expect(tapped.headers.get('x-middleware-request-x-admit-pda')).toBe('PdaFromTap');

			const claim = await call('/accessory/link', { method: 'GET', cookie: bu });
			expect(claim.status).toBe(200);
			expect(claim.headers.get('x-middleware-request-x-admit-pda')).toBe('PdaFromTap');

			const viewed = await call('/accessory', { method: 'GET', cookie: ob });
			expect(viewed.status).toBe(200);
			expect(viewed.headers.get('x-middleware-request-x-admit-pda')).toBe('PdaFromOwner');

			const viewOnly = await call('/accessory/link', { method: 'GET', cookie: ob });
			expect(viewOnly.status).toBe(307);
			expect(viewOnly.headers.get('location')).toBe(`${APP}/tap/expired`);
		});
	});
});
