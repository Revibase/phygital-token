import { ed25519 } from '@noble/curves/ed25519.js';
import { address, getBase58Encoder, type Rpc, type SolanaRpcApi } from '@solana/kit';

import { base64UrlToBytes, bytesToBase64Url } from '$lib/shared/encoding';
import { fetchAccessory } from '../accessory/resolve';
import { DEFAULT_PUBKEY } from '../accessory/view';
import { consumeChallenge, isChallengeId, issueChallenge } from '../challenges';

/** Namespace for owner-browse challenges in the shared `auth_challenges` table. */
export const OWNER_BROWSE_NAMESPACE = 'revibase-owner-browse';

export const issueOwnerBrowseChallenge = (db: D1Database, now = Date.now()) =>
	issueChallenge(db, OWNER_BROWSE_NAMESPACE, now);

export type OwnerBrowseResult =
	| { ok: true; pda: string; identifier: string; wallet: string }
	| {
			ok: false;
			status: number;
			code: 'bad_request' | 'too_slow' | 'bad_signature' | 'not_owner' | 'unknown_accessory';
			error: string;
	  };

/**
 * Quiet per-item admit for the linked wallet (phygital-wallet's authority-browse).
 *
 * The wallet signs a single-use challenge with `solana:signMessage`. We check the
 * signature, then that the signer is this accessory's `linked_wallet`. No tap
 * needed — Home can open an accessory the wallet already owns.
 */
export async function verifyOwnerBrowse(
	deps: { db: D1Database; rpc: Rpc<SolanaRpcApi> },
	input: { challengeId: unknown; pda: unknown; address: unknown; signature: unknown },
	now = Date.now()
): Promise<OwnerBrowseResult> {
	if (!isChallengeId(input.challengeId)) {
		return { ok: false, status: 400, code: 'bad_request', error: 'Missing challenge.' };
	}
	if (typeof input.pda !== 'string' || !input.pda) {
		return { ok: false, status: 400, code: 'bad_request', error: 'Missing accessory.' };
	}
	if (typeof input.address !== 'string' || !input.address) {
		return { ok: false, status: 400, code: 'bad_request', error: 'Missing wallet.' };
	}
	if (typeof input.signature !== 'string' || !input.signature) {
		return { ok: false, status: 400, code: 'bad_request', error: 'Missing signature.' };
	}

	const message = await consumeChallenge(deps.db, OWNER_BROWSE_NAMESPACE, input.challengeId, now);
	if (!message) return { ok: false, status: 409, code: 'too_slow', error: 'That took too long. Try again.' };

	let pubkey: Uint8Array;
	let signature: Uint8Array;
	try {
		pubkey = new Uint8Array(getBase58Encoder().encode(input.address));
		if (pubkey.length !== 32) throw new Error('bad key');
		signature = base64UrlToBytes(input.signature);
		if (signature.length !== 64) throw new Error('bad sig');
	} catch {
		return { ok: false, status: 400, code: 'bad_request', error: 'Bad wallet or signature.' };
	}

	const msg = new TextEncoder().encode(message);
	if (!ed25519.verify(signature, msg, pubkey)) {
		return { ok: false, status: 401, code: 'bad_signature', error: 'We couldn’t verify that signature.' };
	}

	let resolved;
	try {
		resolved = await fetchAccessory(deps.rpc, input.pda);
	} catch {
		return { ok: false, status: 502, code: 'unknown_accessory', error: 'Couldn’t reach the network. Try again.' };
	}
	if (!resolved) return { ok: false, status: 404, code: 'unknown_accessory', error: 'This accessory isn’t registered.' };

	const linked = String(resolved.account.linkedWallet);
	if (linked === DEFAULT_PUBKEY || linked !== input.address) {
		return { ok: false, status: 403, code: 'not_owner', error: 'This wallet isn’t linked to that accessory.' };
	}

	// Canonical address form (Kit `address` normalizes).
	const wallet = String(address(input.address));
	return {
		ok: true,
		pda: resolved.pda,
		identifier: bytesToBase64Url(new Uint8Array(resolved.account.identifier[0])),
		wallet
	};
}
