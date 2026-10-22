import { NextResponse, type NextRequest } from 'next/server';

import { isWalletAddress, issueOwnerLoginChallenge } from '#lib/server/accessory/owner-browse.ts';
import { getEnv, solanaCluster } from '#lib/server/env.ts';
import { readJsonObject } from '#lib/server/http/read-json.ts';

/** A Sign-In With Solana message for this wallet, bound to the origin the page is served from. */
export async function POST(request: NextRequest) {
	const env = await getEnv();
	const read = await readJsonObject(request);
	if (!read.ok) return read.response;
	const body = read.body as { address?: unknown };
	if (!isWalletAddress(body.address)) {
		return NextResponse.json({ error: 'Missing wallet.', code: 'bad_request' }, { status: 400 });
	}
	return NextResponse.json(
		await issueOwnerLoginChallenge(env.DB, {
			domain: request.nextUrl.host,
			uri: request.nextUrl.origin,
			address: body.address,
			cluster: solanaCluster(env)
		})
	);
}
