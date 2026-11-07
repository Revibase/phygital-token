import { type Address } from '@solana/kit';
import {
	findAdminConfigPda,
	findPhygitalTokenPda,
	isPhygitalTokenLocked,
	PhygitalTokenType
} from 'phygital-token-sdk';

import { DEFAULT_PUBKEY } from '#lib/shared/accessory-view.ts';
import { bytesToBase64Url } from '#lib/shared/encoding.ts';
import { decodeProgramEvents, TruncatedLogsError, type LoggedEvent } from './decode';

/** The fields of a Helius raw webhook transaction this reads. */
export type RawTransaction = {
	slot: number;
	blockTime?: number | null;
	indexWithinBlock?: number | null;
	meta?: { err?: unknown; logMessages?: string[] | null } | null;
	transaction: { signatures: string[] };
};

type Subject = { kind: 'token' | 'config'; address: Address };

/** One row of the `program_events` audit log, as read back. */
type EventRow = {
	signature: string;
	event_name: string;
	data: string;
	slot: number;
	block_time: number | null;
	received_at: number;
};

export type IngestResult = { transactions: number; events: number; rebuilt: number };

/**
 * Record this program's events from confirmed transactions in the append-only
 * `program_events` log, then rebuild the `phygital_tokens` / `admin_config`
 * rows they touch from that log.
 *
 * The snapshot is always a replay of the log in chain order, never a patch, so
 * duplicate and out-of-order deliveries give the same rows. Failed
 * transactions are skipped: their state changes were rolled back.
 */
export async function ingestTransactions(
	db: D1Database,
	transactions: readonly RawTransaction[],
	now = Date.now()
): Promise<IngestResult> {
	const insert = db.prepare(
		`INSERT INTO program_events (
           signature, event_index, slot, index_within_block, block_time,
           event_name, subject, data, raw, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(signature, event_index) DO NOTHING`
	);
	const inserts: D1PreparedStatement[] = [];
	const subjects = new Map<string, Subject>();
	let count = 0;
	for (const tx of transactions) {
		if (tx.meta?.err != null) continue;
		const signature = tx.transaction.signatures[0];
		if (!signature) continue;
		let events: LoggedEvent[];
		try {
			events = decodeProgramEvents(tx.meta?.logMessages ?? []);
		} catch (err) {
			if (!(err instanceof TruncatedLogsError)) throw err;
			// Retrying gets the same logs; record nothing rather than a partial view.
			console.error(
				'Skipped a transaction with truncated logs; its events are missing from the log',
				{ signature }
			);
			continue;
		}
		for (const event of events) {
			const subject = await subjectOf(event);
			if (subject) subjects.set(subject.address, subject);
			inserts.push(
				insert.bind(
					signature,
					event.index,
					tx.slot,
					tx.indexWithinBlock ?? null,
					tx.blockTime == null ? null : tx.blockTime * 1000,
					event.name,
					subject?.address ?? null,
					JSON.stringify(eventJson(event)),
					event.raw,
					now
				)
			);
			count++;
		}
	}
	if (inserts.length) await db.batch(inserts);
	await rebuild(db, [...subjects.values()], now);
	return { transactions: transactions.length, events: count, rebuilt: subjects.size };
}

async function subjectOf(event: LoggedEvent): Promise<Subject | null> {
	switch (event.name) {
		case 'InitializeEvent':
		case 'SetOwnerEvent':
		case 'RemoveOwnerEvent':
		case 'ClosePhygitalTokenEvent':
			// Every token account is created by `initialize` at this PDA, so the event's key names it.
			return { kind: 'token', address: await findPhygitalTokenPda(event.data.publicKey) };
		case 'CreateConfigEvent':
		case 'SetAdminEvent':
		case 'SetIssuerEvent':
			return { kind: 'config', address: (await findAdminConfigPda())[0] };
		case 'Unknown':
			return null;
	}
}

/** Event fields as JSON: addresses as base58, passkey keys as base64url, enums by name. */
function eventJson(event: LoggedEvent): Record<string, unknown> | null {
	if (!event.data) return null;
	return Object.fromEntries(
		Object.entries(event.data).map(([key, value]: [string, unknown]): [string, unknown] => {
			if (Array.isArray(value) && value[0] instanceof Uint8Array)
				return [key, bytesToBase64Url(value[0])];
			if (key === 'tokenType') return [key, PhygitalTokenType[value as PhygitalTokenType]];
			return [key, value];
		})
	);
}

const orNull = (key: unknown) => (key === DEFAULT_PUBKEY ? null : (key as string));

/** Replay every touched subject: one batch reads their logs, one batch writes the rows. */
async function rebuild(db: D1Database, subjects: readonly Subject[], now: number) {
	if (!subjects.length) return;
	const select = db.prepare(
		`SELECT signature, event_name, data, slot, block_time, received_at FROM program_events
       WHERE subject = ?
       ORDER BY slot, COALESCE(index_within_block, 0), signature, event_index`
	);
	const reads = await db.batch<EventRow>(subjects.map((s) => select.bind(s.address)));
	const writes = subjects.flatMap((subject, i) => {
		const rows = reads[i].results;
		const write =
			subject.kind === 'token'
				? writeToken(db, subject.address, rows, now)
				: writeConfig(db, subject.address, rows, now);
		return write ? [write] : [];
	});
	if (writes.length) await db.batch(writes);
}

type TokenState = {
	identifier: string;
	publicKey: string;
	owner: string | null;
	tokenType: string;
	status: 'live' | 'closed';
	initializeSignature: string;
	createdAt: number;
};

/** Replay a token's events. `null` when its `initialize` isn't in the log yet (out of order) or was never delivered. */
function foldToken(rows: readonly EventRow[]): TokenState | null {
	let state: TokenState | null = null;
	for (const row of rows) {
		const data = JSON.parse(row.data) as Record<string, string>;
		if (row.event_name === 'InitializeEvent') {
			state = {
				identifier: data.identifier,
				publicKey: data.publicKey,
				owner: orNull(data.owner),
				tokenType: data.tokenType,
				status: 'live',
				initializeSignature: row.signature,
				createdAt: row.block_time ?? row.received_at
			};
			continue;
		}
		if (!state || state.status === 'closed') continue;
		if (row.event_name === 'SetOwnerEvent') state.owner = orNull(data.recipient);
		else if (row.event_name === 'RemoveOwnerEvent') state.owner = null;
		else if (row.event_name === 'ClosePhygitalTokenEvent') state.status = 'closed';
	}
	return state;
}

/**
 * Write the replayed row unless a replay of more events got there first. The log
 * only grows, so a later read holds every event an earlier one did: the larger
 * `event_count` is the newer view, and concurrent deliveries can't go backwards.
 */
function writeToken(
	db: D1Database,
	address: string,
	rows: EventRow[],
	now: number
): D1PreparedStatement | null {
	const state = foldToken(rows);
	if (!state) {
		console.warn('Token events without its initialize; waiting for it, or it was never delivered', {
			address
		});
		return null;
	}
	const last = rows.at(-1)!;
	const locked =
		state.status === 'live' &&
		isPhygitalTokenLocked({
			tokenType: PhygitalTokenType[state.tokenType as keyof typeof PhygitalTokenType],
			owner: (state.owner ?? DEFAULT_PUBKEY) as Address
		});
	return db
		.prepare(
			`INSERT INTO phygital_tokens (
         address, identifier, secp256r1_public_key, owner, token_type, is_locked, status,
         initialize_signature, created_at, updated_at, last_signature, last_slot, event_count, synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         identifier = excluded.identifier, secp256r1_public_key = excluded.secp256r1_public_key,
         owner = excluded.owner, token_type = excluded.token_type,
         is_locked = excluded.is_locked, status = excluded.status,
         initialize_signature = excluded.initialize_signature, created_at = excluded.created_at,
         updated_at = excluded.updated_at, last_signature = excluded.last_signature,
         last_slot = excluded.last_slot, event_count = excluded.event_count, synced_at = excluded.synced_at
       WHERE excluded.event_count > phygital_tokens.event_count`
		)
		.bind(
			address,
			state.identifier,
			state.publicKey,
			state.owner,
			state.tokenType,
			locked ? 1 : 0,
			state.status,
			state.initializeSignature,
			state.createdAt,
			last.block_time ?? last.received_at,
			last.signature,
			last.slot,
			rows.length,
			now
		);
}

type ConfigState = { admin: string | null; issuer: string | null };

/** Replay the AdminConfig's events. `null` when its `create_config` isn't in the log. */
function foldConfig(rows: readonly EventRow[]): ConfigState | null {
	let state: ConfigState | null = null;
	for (const row of rows) {
		const data = JSON.parse(row.data) as Record<string, string>;
		if (row.event_name === 'CreateConfigEvent') {
			state = { admin: orNull(data.authority), issuer: null };
			continue;
		}
		if (!state) continue;
		if (row.event_name === 'SetAdminEvent') state.admin = orNull(data.newAdmin);
		else if (row.event_name === 'SetIssuerEvent') state.issuer = orNull(data.issuer);
	}
	return state;
}

function writeConfig(
	db: D1Database,
	address: string,
	rows: EventRow[],
	now: number
): D1PreparedStatement | null {
	const state = foldConfig(rows);
	if (!state) {
		console.warn(
			'AdminConfig events without its create_config; waiting for it, or it was never delivered',
			{ address }
		);
		return null;
	}
	const last = rows.at(-1)!;
	return db
		.prepare(
			`INSERT INTO admin_config (
         address, admin, issuer, updated_at, last_signature, last_slot, event_count, synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         admin = excluded.admin, issuer = excluded.issuer,
         updated_at = excluded.updated_at, last_signature = excluded.last_signature,
         last_slot = excluded.last_slot, event_count = excluded.event_count, synced_at = excluded.synced_at
       WHERE excluded.event_count > admin_config.event_count`
		)
		.bind(
			address,
			state.admin,
			state.issuer,
			last.block_time ?? last.received_at,
			last.signature,
			last.slot,
			rows.length,
			now
		);
}
