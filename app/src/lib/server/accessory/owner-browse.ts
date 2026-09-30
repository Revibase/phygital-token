import { ed25519 } from '@noble/curves/ed25519.js';
import { getBase58Encoder, type Rpc, type SolanaRpcApi } from '@solana/kit';

import { base64UrlToBytes, bytesToBase64Url } from '$lib/shared/encoding';
import { fetchAccessory } from '../accessory/resolve';
import { DEFAULT_PUBKEY } from '$lib/shared/accessory-view';
import { CHALLENGE_TTL_MS, consumeChallenge, isChallengeId, issueChallenge } from '../challenges';

export const OWNER_LOGIN_NAMESPACE = 'revibase-owner-login';

const SIWS_CHAINS = new Set(['mainnet', 'devnet', 'testnet', 'localnet']);

export const isWalletAddress = (v: unknown): v is string => {
	if (typeof v !== 'string') return false;
	try {
		return getBase58Encoder().encode(v).length === 32;
	} catch {
		return false;
	}
};

/**
 * A Sign-In With Solana message, so wallets can show it as a sign-in (and warn
 * when `domain` doesn't match the page) instead of an opaque string. The
 * statement says plainly what signing in is for.
 */
export function ownerLoginMessage(input: { domain: string; uri: string; address: string; cluster: string; nonce: string; now: number }): string {
	const lines = [
		`${input.domain} wants you to sign in with your Solana account:`,
		input.address,
		'',
		"Sign in to Revibase to manage the accessories linked to this wallet.",
		'',
		`URI: ${input.uri}`,
		'Version: 1',
		...(SIWS_CHAINS.has(input.cluster) ? [`Chain ID: ${input.cluster}`] : []),
		`Nonce: ${input.nonce}`,
		`Issued At: ${new Date(input.now).toISOString()}`,
		`Expiration Time: ${new Date(input.now + CHALLENGE_TTL_MS).toISOString()}`
	];
	return lines.join('\n');
}

export const issueOwnerLoginChallenge = (
	db: D1Database,
	site: { domain: string; uri: string; address: string; cluster: string },
	now = Date.now()
) => issueChallenge(db, OWNER_LOGIN_NAMESPACE, now, (nonce) => ownerLoginMessage({ ...site, nonce, now }));

type Failure<C extends string> = { ok: false; status: number; code: C; error: string };

/**
 * Wallet login (phygital-wallet's owner-session): the wallet signs a single-use
 * challenge with `solana:signMessage` once. The caller then sets the `os` cookie.
 */
export async function verifyOwnerLogin(
	db: D1Database,
	input: { challengeId?: unknown; address?: unknown; signature?: unknown },
	now = Date.now()
): Promise<{ ok: true; wallet: string } | Failure<'bad_request' | 'too_slow' | 'bad_signature'>> {
	const { challengeId, address, signature } = input;
	if (!isChallengeId(challengeId) || typeof address !== 'string' || typeof signature !== 'string') {
		return { ok: false, status: 400, code: 'bad_request', error: 'Missing challenge, wallet or signature.' };
	}
	const message = await consumeChallenge(db, OWNER_LOGIN_NAMESPACE, challengeId, now);
	if (!message) return { ok: false, status: 409, code: 'too_slow', error: 'That took too long. Try again.' };
	// The message names the wallet it was issued for; only that wallet's signature counts.
	if (message.split('\n')[1] !== address) {
		return { ok: false, status: 401, code: 'bad_signature', error: 'We couldn’t verify that signature.' };
	}

	try {
		const pubkey = new Uint8Array(getBase58Encoder().encode(address));
		const sig = base64UrlToBytes(signature);
		if (pubkey.length === 32 && sig.length === 64 && ed25519.verify(sig, new TextEncoder().encode(message), pubkey)) {
			return { ok: true, wallet: address };
		}
	} catch {
		// fall through: malformed key or signature
	}
	return { ok: false, status: 401, code: 'bad_signature', error: 'We couldn’t verify that signature.' };
}

/**
 * Quiet per-item admit (phygital-wallet's authority-browse): the logged-in wallet
 * may open an accessory the chain says is linked to it. No signature, no tap.
 */
export async function verifyOwnerBrowse(
	rpc: Rpc<SolanaRpcApi>,
	wallet: string,
	pda: unknown
): Promise<
	{ ok: true; pda: string; identifier: string } | Failure<'bad_request' | 'not_owner' | 'unknown_accessory'>
> {
	if (typeof pda !== 'string' || !pda) return { ok: false, status: 400, code: 'bad_request', error: 'Missing accessory.' };

	let resolved;
	try {
		resolved = await fetchAccessory(rpc, pda);
	} catch {
		return { ok: false, status: 502, code: 'unknown_accessory', error: 'Couldn’t reach the network. Try again.' };
	}
	if (!resolved) return { ok: false, status: 404, code: 'unknown_accessory', error: 'This accessory isn’t registered.' };

	const linked = String(resolved.account.linkedWallet);
	if (linked === DEFAULT_PUBKEY || linked !== wallet) {
		return { ok: false, status: 403, code: 'not_owner', error: 'This wallet isn’t linked to that accessory.' };
	}
	return { ok: true, pda: resolved.pda, identifier: bytesToBase64Url(new Uint8Array(resolved.account.identifier[0])) };
}
