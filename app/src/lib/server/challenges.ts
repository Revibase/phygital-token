import { bytesToBase64Url } from '$lib/shared/encoding';

/**
 * Single-use tap challenges in phygital-wallet's shared `auth_challenges` table.
 * Each purpose gets its own namespace, so a challenge issued for one (say,
 * sign-in) can never be redeemed for another (say, resuming a session).
 */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

const random = (n: number) => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(n)));

/**
 * Issue a challenge. The `message` is what the client passes to the SDK's
 * `startAuthentication(message, rpc)`, which signs its UTF-8 bytes.
 */
export async function issueChallenge(db: D1Database, namespace: string, now = Date.now()) {
	const id = random(16);
	const message = `${namespace}:${random(32)}`;
	await db.prepare('DELETE FROM auth_challenges WHERE namespace = ? AND expires_at < ?').bind(namespace, now).run();
	await db
		.prepare('INSERT INTO auth_challenges (id, namespace, value, expires_at) VALUES (?, ?, ?, ?)')
		.bind(id, namespace, message, now + CHALLENGE_TTL_MS)
		.run();
	return { challengeId: id, message };
}

export const isChallengeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{22}$/.test(v);

/**
 * Atomic consume (DELETE … RETURNING): a challenge can be redeemed once,
 * whether or not the response then verifies. Returns its message, or null if
 * it's unknown, used, expired, or from another namespace.
 */
export async function consumeChallenge(db: D1Database, namespace: string, id: string, now = Date.now()): Promise<string | null> {
	const row = await db
		.prepare('DELETE FROM auth_challenges WHERE id = ? AND namespace = ? AND expires_at > ? RETURNING value')
		.bind(id, namespace, now)
		.first<{ value: string }>();
	return row?.value ?? null;
}
