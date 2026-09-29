export type CounterVerdict = 'new' | 'replay';

/**
 * Atomically consume a tap counter against the shared D1 `tap_counters` table
 * (owned by phygital-wallet; same statement as its `consumeCounterSession`).
 *
 * The conditional upsert only writes when the incoming counter is strictly
 * greater than the stored high-water mark, so two concurrent requests for the
 * same or lower counter can never both succeed.
 */
export async function consumeTapCounter(
	db: D1Database,
	identifier: string,
	counter: number,
	now = Date.now()
): Promise<CounterVerdict> {
	const result = await db
		.prepare(
			`INSERT INTO tap_counters (identifier, c, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(identifier) DO UPDATE SET
         c = excluded.c,
         updated_at = excluded.updated_at
       WHERE tap_counters.c < excluded.c`
		)
		.bind(identifier, counter, now)
		.run();

	return (result.meta?.changes ?? 0) > 0 ? 'new' : 'replay';
}
