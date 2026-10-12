import { describe, expect, it } from 'vitest';

import { handle } from '../src/hooks.server';

const SIGNER = 'https://signer.revibase.test';
const APP = 'https://portal.revibase.test';

async function call(path: string, init: { method?: string; origin?: string } = {}) {
	const url = new URL(path, APP);
	const request = new Request(url, { method: init.method ?? 'POST', headers: init.origin ? { origin: init.origin } : {} });
	const event = { request, url, locals: {}, platform: { env: { SECURE_SIGNER_ORIGIN: SIGNER } } };
	const resolve = async () => new Response('{}', { headers: { 'content-security-policy': "default-src 'self'" } });
	return handle({ event, resolve } as never);
}

describe('hooks: signer API and framing', () => {
	it('lets only the signer origin call /api/signer/*, with CORS', async () => {
		const ok = await call('/api/signer/restore', { origin: SIGNER });
		expect(ok.status).toBe(200);
		expect(ok.headers.get('access-control-allow-origin')).toBe(SIGNER);
		expect((await call('/api/signer/restore', { origin: 'https://evil.example' })).status).toBe(403);
		expect((await call('/api/signer/restore', { method: 'OPTIONS', origin: SIGNER })).status).toBe(204);
		expect((await call('/api/signer/restore', { method: 'OPTIONS', origin: 'https://evil.example' })).status).toBe(403);
	});

	it('opens /api/sponsor to any site, without credentials', async () => {
		const sign = await call('/api/sponsor/sign', { origin: 'https://integrator.example' });
		expect(sign.status).toBe(200);
		expect(sign.headers.get('access-control-allow-origin')).toBe('*');
		expect(sign.headers.get('access-control-allow-credentials')).toBeNull();
		expect((await call('/api/sponsor', { method: 'OPTIONS', origin: 'https://integrator.example' })).status).toBe(204);
		expect((await call('/api/sponsorship', { origin: 'https://integrator.example' })).status).toBe(403);
	});

	it('keeps every other API same-origin, even for the signer', async () => {
		expect((await call('/api/tap/resume', { origin: SIGNER })).status).toBe(403);
		expect((await call('/api/tap/resume', { origin: APP })).status).toBe(200);
	});

	it('frames only the trusted signer', async () => {
		expect((await call('/', { method: 'GET' })).headers.get('content-security-policy')).toBe(`default-src 'self'; frame-src ${SIGNER}`);
		expect((await call('/', { method: 'GET' })).headers.get('permissions-policy')).toContain(`publickey-credentials-get=(self "${SIGNER}")`);
	});
});
