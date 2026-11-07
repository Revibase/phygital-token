import { address, type Address } from '@solana/kit';

/**
 * The mint a packed card carries, or `null` when the card was never packed.
 *
 * `cards` is written only by the developer service when a card is tapped at the
 * pack station; a row is what makes a card eligible to enroll. Keyed by the
 * canonical base64url identifier that `verifyDynamicUrlWithoutCounterCheck` returns.
 */
export async function packedCardMint(db: D1Database, identifier: string): Promise<Address | null> {
	const row = await db
		.prepare('SELECT mint FROM cards WHERE identifier = ?')
		.bind(identifier)
		.first<{ mint: string }>();
	return row ? address(row.mint) : null;
}
