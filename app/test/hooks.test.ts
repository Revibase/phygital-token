import { describe, expect, it } from 'vitest';

import { handle } from '../src/hooks.server';
import { env } from './support/cloudflare-workers';

const APP = 'https://portal.revibase.test';

async function call(
	path: string,
	init: { method?: string; origin?: string; env?: Record<string, string> } = {}
) {
	const url = new URL(path, APP);
	const request = new Request(url, {
		method: init.method ?? 'POST',
		headers: init.origin ? { origin: init.origin } : {}
	});
	for (const key of Object.keys(env)) delete env[key];
	Object.assign(env, init.env);
	const event = { request, url, locals: {} };
	const resolve = async () =>
		new Response('{}', { headers: { 'content-security-policy': "default-src 'self'" } });
	return handle({ event, resolve } as never);
}

describe('hooks', () => {
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
		expect(page.headers.get('content-security-policy')).toBe("default-src 'self'");
		expect(page.headers.get('permissions-policy')).toContain('publickey-credentials-get=(self)');
		expect(page.headers.get('permissions-policy')).not.toContain('publickey-credentials-create');
	});

	it('lets the Revibase Passkey signer frame use passkeys only when it is configured', async () => {
		const signer = 'https://signer.revibase.test';
		const on = await call('/', {
			method: 'GET',
			env: { SECURE_SIGNER_ORIGIN: signer, FEE_PAYER_KEY: 'key' }
		});
		expect(on.headers.get('permissions-policy')).toContain(
			`publickey-credentials-get=(self "${signer}")`
		);
		const off = await call('/', { method: 'GET', env: { SECURE_SIGNER_ORIGIN: signer } });
		expect(off.headers.get('permissions-policy')).toContain('publickey-credentials-get=(self)');
	});
});
