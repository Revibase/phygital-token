import { describe, expect, it } from 'vitest';

import { handle } from '../src/hooks.server';

const APP = 'https://portal.revibase.test';

async function call(path: string, init: { method?: string; origin?: string } = {}) {
	const url = new URL(path, APP);
	const request = new Request(url, {
		method: init.method ?? 'POST',
		headers: init.origin ? { origin: init.origin } : {}
	});
	const event = { request, url, locals: {}, platform: { env: {} } };
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
});
