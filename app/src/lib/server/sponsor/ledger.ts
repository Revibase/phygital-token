/**
 * Prepaid network fees per accessory (`revibase_sponsor_txs`). A row is
 * written when a pool key signs, and settled lazily against the chain:
 * pending costs count at once, refills only once they've landed.
 */
import { signature as toSignature, type Rpc, type SolanaRpcApi } from '@solana/kit';

type Row = { signature: string; blockhash: string };

const BALANCE_SQL = `
	SELECT
		COALESCE(SUM(CASE WHEN status IN ('pending', 'confirmed') THEN cost_lamports WHEN status = 'failed' THEN fee_lamports ELSE 0 END), 0) AS spent,
		COALESCE(SUM(CASE WHEN status = 'confirmed' THEN refill_lamports ELSE 0 END), 0) AS refilled
	FROM revibase_sponsor_txs WHERE phygital_token = ?`;

export async function prepaidBalance(db: D1Database, accessory: string, prepaid: bigint): Promise<bigint> {
	const row = await db.prepare(BALANCE_SQL).bind(accessory).first<{ spent: number | bigint; refilled: number | bigint }>();
	return prepaid - BigInt(row?.spent ?? 0) + BigInt(row?.refilled ?? 0);
}

/** Resolve this accessory's pending rows: landed → confirmed (or failed), expired blockhash → dropped. */
export async function settlePending(db: D1Database, rpc: Rpc<SolanaRpcApi>, accessory: string): Promise<void> {
	const { results } = await db
		.prepare(`SELECT signature, blockhash FROM revibase_sponsor_txs WHERE phygital_token = ? AND status = 'pending'`)
		.bind(accessory)
		.all<Row>();
	if (!results?.length) return;
	const { value } = await rpc
		.getSignatureStatuses(results.map((r) => toSignature(r.signature)), { searchTransactionHistory: true })
		.send();
	// Rows that never landed are dropped once their blockhash can no longer be used; check each blockhash once.
	const unseen = [...new Set(results.filter((_, i) => !value[i]).map((r) => r.blockhash))];
	const valid = await Promise.all(unseen.map((blockhash) => rpc.isBlockhashValid(blockhash as never, { commitment: 'processed' }).send()));
	const expired = new Set(unseen.filter((_, i) => !valid[i]!.value));
	const updates = results.flatMap((row, i) => {
		const status = value[i];
		const landed = status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized');
		const next = landed ? (status.err ? 'failed' : 'confirmed') : !status && expired.has(row.blockhash) ? 'dropped' : null;
		return next ? [db.prepare(`UPDATE revibase_sponsor_txs SET status = ? WHERE signature = ? AND status = 'pending'`).bind(next, row.signature)] : [];
	});
	if (updates.length) await db.batch(updates);
}

export type Charge = {
	signature: string;
	accessory: string;
	feePayer: string;
	fee: bigint;
	cost: bigint;
	refill: bigint;
	blockhash: string;
};

/**
 * Records `charge` only if the accessory can afford it: its balance, plus this
 * transaction's own refill (which lands with it), must cover its cost.
 * Atomic, so concurrent requests can't overspend. Returns whether a row for
 * this signature now exists (re-signing the same message is free).
 */
export async function reserve(db: D1Database, prepaid: bigint, charge: Charge, now = Date.now()): Promise<boolean> {
	const insert = db
		.prepare(
			`INSERT INTO revibase_sponsor_txs (signature, phygital_token, fee_payer, fee_lamports, cost_lamports, refill_lamports, blockhash, status, created_at)
			SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8
			WHERE ?9 - (SELECT COALESCE(SUM(CASE WHEN status IN ('pending', 'confirmed') THEN cost_lamports WHEN status = 'failed' THEN fee_lamports ELSE 0 END), 0) FROM revibase_sponsor_txs WHERE phygital_token = ?2)
				+ (SELECT COALESCE(SUM(CASE WHEN status = 'confirmed' THEN refill_lamports ELSE 0 END), 0) FROM revibase_sponsor_txs WHERE phygital_token = ?2)
				+ ?6 >= ?5
			ON CONFLICT (signature) DO NOTHING`
		)
		.bind(
			charge.signature,
			charge.accessory,
			charge.feePayer,
			Number(charge.fee),
			Number(charge.cost),
			Number(charge.refill),
			charge.blockhash,
			now,
			Number(prepaid)
		);
	const read = db.prepare('SELECT phygital_token FROM revibase_sponsor_txs WHERE signature = ?').bind(charge.signature);
	const [, existing] = await db.batch<{ phygital_token: string }>([insert, read]);
	return existing?.results[0]?.phygital_token === charge.accessory;
}
