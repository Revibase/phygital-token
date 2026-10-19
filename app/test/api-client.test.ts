import { afterEach, expect, it, vi } from 'vitest';
import { ApiClientError, getJson, postJson } from '#lib/client/api.ts';

afterEach(() => vi.unstubAllGlobals());

it('preserves server error codes so authentication can recover', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ code: 'unauthenticated', error: 'Sign in again' }), {
				status: 401
			})
		)
	);
	await expect(postJson('/api/owner/session')).rejects.toMatchObject({
		status: 401,
		code: 'unauthenticated',
		message: 'Sign in again'
	});
});

it('reports connection failures consistently for reads and writes', async () => {
	vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
	for (const request of [getJson('/api/read'), postJson('/api/write')]) {
		await expect(request).rejects.toBeInstanceOf(ApiClientError);
		await expect(request).rejects.toMatchObject({ status: 0, code: 'network' });
	}
});

it('keeps reads uncached and writes authenticated with JSON', async () => {
	const fetch = vi.fn().mockImplementation(async () => new Response('{}'));
	vi.stubGlobal('fetch', fetch);
	await getJson('/api/read');
	await postJson('/api/write', { value: 1 });
	expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
	expect(fetch.mock.calls[1][1]).toMatchObject({
		credentials: 'same-origin',
		method: 'POST',
		body: '{"value":1}',
		headers: { 'content-type': 'application/json' }
	});
});
