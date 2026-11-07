import {
	isSolanaError,
	SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE
} from '@solana/kit';
import type { NextRequest } from 'next/server';

import { attestationOptions, EnrollError, registerCard } from '#lib/server/enroll/initialize.ts';
import { ConfigError, getEnv, getRpc } from '#lib/server/env.ts';
import { json, readOnlyCookies, responseCookies } from '#lib/server/http/cookies.ts';
import { readJsonObject } from '#lib/server/http/read-json.ts';
import {
	clearCookie,
	enrollChallenge,
	readEnrollSession,
	setBrowseUnlock
} from '#lib/server/session/cookies.ts';
import { issuerSigner, signAndSend } from '#lib/server/solana/send.ts';
import type { EnrollmentResponse } from '#lib/shared/attestation.ts';

const ENROLL_STATUS = {
	invalid_attestation: 400,
	not_packed: 403,
	already_enrolled: 409,
	in_progress: 409
} as const;

function isEnrollmentResponse(value: unknown): value is EnrollmentResponse {
	const r = value as EnrollmentResponse | undefined;
	return (
		!!r &&
		typeof r === 'object' &&
		!!r.response &&
		typeof r.response.clientDataJSON === 'string' &&
		typeof r.response.attestationObject === 'string'
	);
}

/**
 * Register the card this browser just enrolled: verify the enrollment and its
 * attestation, `initialize` an unowned Controlled token under the tapped
 * card's identifier, then admit this browser to claim it. Safe to retry with
 * a new enrollment: the card returns the same key every time.
 */
export async function POST(request: NextRequest) {
	const env = await getEnv();
	const read = await readJsonObject(request);
	if (!read.ok) return read.response;
	const registration = read.body.response;
	if (!isEnrollmentResponse(registration)) {
		return json({ error: 'Missing enrollment.', code: 'bad_request' }, 400);
	}

	// The enrollment must be over this session's challenge, so the cookie is the only state.
	const session = await readEnrollSession(readOnlyCookies(request.cookies), env.SESSION_SECRET);
	if (!session) {
		return json({ error: 'Hold your accessory to your phone again.', code: 'expired' }, 403);
	}

	try {
		const rpc = getRpc(env);
		const issuer = await issuerSigner(env);
		const { pda, signature } = await registerCard(
			{
				db: env.DB,
				rpc,
				issuer,
				attestation: attestationOptions(env),
				send: (instructions, budget) => signAndSend(rpc, issuer, instructions, budget)
			},
			{
				identifier: session.identifier,
				challenge: await enrollChallenge(env.SESSION_SECRET, session),
				response: registration,
				origin: request.nextUrl.origin
			}
		);
		const response = json({ pda, signature });
		const cookies = responseCookies(request, response);
		clearCookie(cookies, 'en');
		await setBrowseUnlock(cookies, env.SESSION_SECRET, { pda, identifier: session.identifier });
		return response;
	} catch (err) {
		if (err instanceof EnrollError) {
			return json({ error: err.message, code: err.code }, ENROLL_STATUS[err.code]);
		}
		if (err instanceof ConfigError) {
			console.error('Enrollment is not configured', err.message);
			return json({ error: 'Setup is unavailable right now.', code: 'enroll_unavailable' }, 503);
		}
		console.error('Enrollment failed', {
			identifier: session.identifier,
			error: err instanceof Error ? err.message : err,
			logs: isSolanaError(
				err,
				SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE
			)
				? err.context.logs
				: undefined
		});
		return json(
			{ error: 'Couldn’t finish setting up this accessory.', code: 'enroll_failed' },
			502
		);
	}
}
