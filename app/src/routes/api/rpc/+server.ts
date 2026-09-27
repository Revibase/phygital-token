import { json } from '@sveltejs/kit';

import { getEnv } from '$lib/server/env';
import type { RequestHandler } from './$types';

/**
 * Narrow JSON-RPC proxy so the browser never sees the RPC URL / API key.
 * Only what the SDK's tap recovery and the wallet flow need is allowed.
 */
const ALLOWED = new Set([
	'getLatestBlockhash',
	'getMultipleAccounts',
	'getAccountInfo',
	'getSignatureStatuses',
	'getSlot',
	'sendTransaction'
]);
const MAX_BODY = 16 * 1024;

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = getEnv(platform);
	const raw = await request.text();
	if (raw.length > MAX_BODY) return json({ error: 'Request too large' }, { status: 413 });

	let body: { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
	try {
		body = JSON.parse(raw);
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	if (Array.isArray(body) || typeof body.method !== 'string' || !ALLOWED.has(body.method)) {
		return json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32601, message: 'Method not allowed' } }, { status: 403 });
	}

	const upstream = await fetch(env.rpcUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, method: body.method, params: body.params ?? [] })
	});
	return new Response(upstream.body, {
		status: upstream.status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	});
};
