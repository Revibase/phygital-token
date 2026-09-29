import { bytesToBase64Url } from '$lib/shared/encoding';
import {
	TERMINAL_LINK_STATES,
	type LinkErrorCode,
	type LinkKind,
	type LinkState,
	type LinkStatusView,
	type TokenKind
} from '$lib/shared/types';
import { accessoryTag } from '$lib/shared/encoding';

/** Overall lifetime of a ceremony (the tap itself is further bounded by the slot window). */
export const INTENT_TTL_MS = 10 * 60 * 1000;

export type Finisher = 'acc' | 'hof' | 'dsk';

export type IntentRow = {
	id: string;
	kind: LinkKind;
	state: LinkState;
	acc_sid: string | null;
	finisher: Finisher | null;
	finisher_sid: string | null;
	pda: string | null;
	identifier: string | null;
	public_key: string | null;
	token_kind: TokenKind | null;
	capability_hash: string | null;
	capability_expires_at: number | null;
	capability_claimed_at: number | null;
	capability_conflicts: number;
	slot_number: string | null;
	slot_expires_at: number | null;
	slot_hash: string | null;
	challenge: string | null;
	assertion: string | null;
	recipient: string | null;
	tx_signature: string | null;
	error_code: LinkErrorCode | null;
	created_at: number;
	updated_at: number;
	expires_at: number;
};

type Patch = Partial<Omit<IntentRow, 'id' | 'kind' | 'created_at' | 'updated_at'>>;

const PATCHABLE = new Set<keyof Patch>([
	'state',
	'acc_sid',
	'finisher',
	'finisher_sid',
	'pda',
	'identifier',
	'public_key',
	'token_kind',
	'capability_hash',
	'capability_expires_at',
	'capability_claimed_at',
	'capability_conflicts',
	'slot_number',
	'slot_expires_at',
	'slot_hash',
	'challenge',
	'assertion',
	'recipient',
	'tx_signature',
	'error_code',
	'expires_at'
]);

export function isTerminal(state: LinkState): boolean {
	return TERMINAL_LINK_STATES.includes(state);
}

export function newIntentId(): string {
	return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function createIntent(
	db: D1Database,
	input: {
		kind: LinkKind;
		state: LinkState;
		acc_sid?: string | null;
		finisher?: Finisher | null;
		finisher_sid?: string | null;
		pda?: string | null;
		identifier?: string | null;
		public_key?: string | null;
		token_kind?: TokenKind | null;
	},
	now = Date.now()
): Promise<IntentRow> {
	const row: IntentRow = {
		id: newIntentId(),
		kind: input.kind,
		state: input.state,
		acc_sid: input.acc_sid ?? null,
		finisher: input.finisher ?? null,
		finisher_sid: input.finisher_sid ?? null,
		pda: input.pda ?? null,
		identifier: input.identifier ?? null,
		public_key: input.public_key ?? null,
		token_kind: input.token_kind ?? null,
		capability_hash: null,
		capability_expires_at: null,
		capability_claimed_at: null,
		capability_conflicts: 0,
		slot_number: null,
		slot_expires_at: null,
		slot_hash: null,
		challenge: null,
		assertion: null,
		recipient: null,
		tx_signature: null,
		error_code: null,
		created_at: now,
		updated_at: now,
		expires_at: now + INTENT_TTL_MS
	};
	await db
		.prepare(
			`INSERT INTO revibase_link_intents (id, kind, state, acc_sid, finisher, finisher_sid, pda, identifier, public_key,
         token_kind, capability_conflicts, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
		)
		.bind(
			row.id,
			row.kind,
			row.state,
			row.acc_sid,
			row.finisher,
			row.finisher_sid,
			row.pda,
			row.identifier,
			row.public_key,
			row.token_kind,
			now,
			now,
			row.expires_at
		)
		.run();
	if (row.pda) await supersedeOthers(db, row.pda, row.id, now);
	return row;
}

/** One live ceremony per accessory: starting a new one cancels the rest (and drops their assertions). */
export async function supersedeOthers(db: D1Database, pda: string, keepId: string, now = Date.now()) {
	await db
		.prepare(
			`UPDATE revibase_link_intents SET state = 'cancelled', assertion = NULL, updated_at = ?
       WHERE pda = ? AND id != ? AND state NOT IN ('linked', 'cancelled', 'expired', 'failed')`
		)
		.bind(now, pda, keepId)
		.run();
}

export async function getIntent(db: D1Database, id: string, now = Date.now()): Promise<IntentRow | null> {
	const row = await db.prepare('SELECT * FROM revibase_link_intents WHERE id = ?').bind(id).first<IntentRow>();
	if (!row) return null;
	if (!isTerminal(row.state) && row.state !== 'submitted' && row.expires_at <= now) {
		await transition(db, row.id, [row.state], 'expired', { assertion: null }, now);
		return { ...row, state: 'expired', assertion: null };
	}
	return row;
}

/**
 * Compare-and-set state transition. Returns false if the row was not in one of
 * `from` (someone else moved it first) — callers must treat that as a conflict.
 * Terminal states always drop the stored assertion.
 */
export async function transition(
	db: D1Database,
	id: string,
	from: readonly LinkState[],
	to: LinkState,
	patch: Patch = {},
	now = Date.now()
): Promise<boolean> {
	const effective: Patch = { ...patch, state: to };
	if (isTerminal(to)) effective.assertion = null;

	const keys = Object.keys(effective) as (keyof Patch)[];
	for (const key of keys) {
		if (!PATCHABLE.has(key)) throw new Error(`not patchable: ${String(key)}`);
	}
	const sets = keys.map((k) => `${k} = ?`).join(', ');
	const placeholders = from.map(() => '?').join(', ');
	const result = await db
		.prepare(`UPDATE revibase_link_intents SET ${sets}, updated_at = ? WHERE id = ? AND state IN (${placeholders})`)
		.bind(...keys.map((k) => effective[k] ?? null), now, id, ...from)
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

export type ClaimResult =
	| { status: 'ok'; row: IntentRow }
	| { status: 'invalid' | 'expired' | 'already_claimed' };

/**
 * Single-use capability claim (`h` or `p`, stored as sha256 hex). The first
 * caller wins atomically; any later attempt bumps `capability_conflicts`,
 * which the owning screen surfaces as "opened on another device".
 */
export async function claimCapability(
	db: D1Database,
	capabilityHash: string,
	now = Date.now()
): Promise<ClaimResult> {
	const row = await db
		.prepare('SELECT * FROM revibase_link_intents WHERE capability_hash = ?')
		.bind(capabilityHash)
		.first<IntentRow>();
	if (!row) return { status: 'invalid' };
	if (isTerminal(row.state) || (row.capability_expires_at ?? 0) <= now || row.expires_at <= now) {
		return { status: 'expired' };
	}
	const result = await db
		.prepare(
			`UPDATE revibase_link_intents SET capability_claimed_at = ?, updated_at = ?
       WHERE id = ? AND capability_claimed_at IS NULL`
		)
		.bind(now, now, row.id)
		.run();
	if ((result.meta?.changes ?? 0) === 0) {
		await db
			.prepare('UPDATE revibase_link_intents SET capability_conflicts = capability_conflicts + 1, updated_at = ? WHERE id = ?')
			.bind(now, row.id)
			.run();
		return { status: 'already_claimed' };
	}
	return { status: 'ok', row: { ...row, capability_claimed_at: now } };
}

export function toStatusView(
	row: IntentRow,
	extra: { pairingCode?: string | null; tapExpiresAt?: number | null; tapWindowMs?: number | null } = {}
): LinkStatusView {
	return {
		id: row.id,
		kind: row.kind,
		state: row.state,
		accessory:
			row.pda && row.identifier ? { pda: row.pda, tag: accessoryTag(row.identifier), kind: row.token_kind ?? 'unknown' } : null,
		recipient: row.recipient,
		pairingCode: extra.pairingCode ?? null,
		claimConflict: row.capability_conflicts > 0,
		tapExpiresAt: extra.tapExpiresAt ?? null,
		tapWindowMs: extra.tapWindowMs ?? null,
		expiresAt: row.expires_at,
		txSignature: row.tx_signature,
		errorCode: row.error_code
	};
}

export async function pruneIntents(db: D1Database, now = Date.now()) {
	await db
		.prepare('DELETE FROM revibase_link_intents WHERE expires_at < ?')
		.bind(now - 24 * 60 * 60 * 1000)
		.run();
}
