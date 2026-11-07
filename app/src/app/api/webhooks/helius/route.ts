import type { NextRequest } from 'next/server';

import { ingestTransactions, type RawTransaction } from '#lib/server/chain/ingest.ts';
import { getEnv } from '#lib/server/env.ts';
import { json } from '#lib/server/http/cookies.ts';
import { authHeaderMatches } from '#lib/server/http/webhook-auth.ts';

function isRawTransaction(value: unknown): value is RawTransaction {
	const tx = value as RawTransaction | undefined;
	return (
		!!tx &&
		typeof tx === 'object' &&
		typeof tx.slot === 'number' &&
		Array.isArray(tx.transaction?.signatures)
	);
}

/**
 * Helius raw transaction webhook for the phygital-token program. The only
 * writer of `program_events`, `phygital_tokens` and `admin_config`.
 *
 * Helius sends the configured `authHeader` as `Authorization`. A 5xx makes it
 * retry (3 times, 1 s apart); a 403 makes it stop, so a bad secret isn't retried.
 */
export async function POST(request: NextRequest) {
	const env = await getEnv();
	if (!env.HELIUS_WEBHOOK_AUTH) {
		console.error('HELIUS_WEBHOOK_AUTH is not set; refusing webhook deliveries');
		return json({ error: 'Webhook is not configured.' }, 503);
	}
	if (!(await authHeaderMatches(request.headers.get('authorization'), env.HELIUS_WEBHOOK_AUTH))) {
		return json({ error: 'Forbidden.' }, 403);
	}

	const body: unknown = await request.json().catch(() => null);
	if (!Array.isArray(body) || !body.every(isRawTransaction)) {
		return json({ error: 'Expected a JSON array of transactions.' }, 400);
	}

	try {
		return json(await ingestTransactions(env.DB, body));
	} catch (err) {
		console.error('Webhook ingest failed', {
			signatures: body.map((tx) => tx.transaction.signatures[0]),
			error: err instanceof Error ? err.message : err
		});
		return json({ error: 'Ingest failed.' }, 500);
	}
}
