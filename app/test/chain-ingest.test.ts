import { describe, expect, it } from 'vitest';
import { address, type Address } from '@solana/kit';
import {
	findAdminConfigPda,
	findPhygitalTokenPda,
	getAssignMintEventEventEncoder,
	getClosePhygitalTokenEventEventEncoder,
	getCreateConfigEventEventEncoder,
	getInitializeEventEventEncoder,
	getRemoveOwnerEventEventEncoder,
	getSetAdminEventEventEncoder,
	getSetIssuerEventEventEncoder,
	getSetMinterEventEventEncoder,
	getSetOwnerEventEventEncoder,
	PHYGITAL_TOKEN_PROGRAM_ADDRESS,
	PhygitalTokenType
} from 'phygital-token-sdk';

import { decodeProgramEvents } from '#lib/server/chain/decode.ts';
import { ingestTransactions, type RawTransaction } from '#lib/server/chain/ingest.ts';
import { authHeaderMatches } from '#lib/server/http/webhook-auth.ts';
import { DEFAULT_PUBKEY } from '#lib/shared/accessory-view.ts';
import { bytesToBase64, bytesToBase64Url } from '#lib/shared/encoding.ts';
import { createTestD1 } from './support/d1-sqlite';

const PROGRAM = PHYGITAL_TOKEN_PROGRAM_ADDRESS;
const OTHER = address('Stake11111111111111111111111111111111111111');
const ALICE = address('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
const BOB = address('So11111111111111111111111111111111111111112');
const MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const NONE = address(DEFAULT_PUBKEY);

function key(seed: number): Uint8Array {
	const bytes = new Uint8Array(33).fill(seed);
	bytes[0] = 2;
	return bytes;
}
const PUBKEY = key(7);
const IDENTIFIER = key(9);
const token = { publicKey: [PUBKEY] as [Uint8Array], identifier: [IDENTIFIER] as [Uint8Array] };

const data = (bytes: Uint8Array) => `Program data: ${bytesToBase64(bytes)}`;
const initializeWith = (mint: Address) =>
	data(
		new Uint8Array(
			getInitializeEventEventEncoder().encode({
				authority: ALICE,
				owner: NONE,
				tokenType: PhygitalTokenType.Controlled,
				mint,
				...token
			})
		)
	);
const initialize = initializeWith(NONE);
const setOwner = (recipient: Address, owner: Address = NONE) =>
	data(new Uint8Array(getSetOwnerEventEventEncoder().encode({ recipient, owner, ...token })));

/** A successful transaction where the program's handler logs `lines`. */
function tx(signature: string, slot: number, lines: string[], extra: Partial<RawTransaction> = {}) {
	return {
		slot,
		blockTime: slot,
		indexWithinBlock: 0,
		meta: {
			err: null,
			logMessages: [
				`Program ${PROGRAM} invoke [1]`,
				'Program log: Instruction: Test',
				...lines,
				`Program ${PROGRAM} consumed 5000 of 200000 compute units`,
				`Program ${PROGRAM} success`
			]
		},
		transaction: { signatures: [signature] },
		...extra
	} satisfies RawTransaction;
}

async function tokenRow(db: D1Database) {
	return db
		.prepare('SELECT * FROM phygital_tokens WHERE address = ?')
		.bind(await findPhygitalTokenPda(PUBKEY))
		.first<Record<string, unknown>>();
}

describe('decodeProgramEvents', () => {
	it('only counts data logged while this program is the one running', () => {
		const forged = setOwner(BOB);
		const events = decodeProgramEvents([
			`Program ${OTHER} invoke [1]`,
			forged,
			`Program ${OTHER} success`,
			`Program ${PROGRAM} invoke [1]`,
			`Program ${OTHER} invoke [2]`,
			forged,
			`Program ${OTHER} success`,
			initialize,
			`Program ${PROGRAM} success`
		]);
		expect(events.map((e) => e.name)).toEqual(['InitializeEvent']);
	});

	it('refuses truncated logs', () => {
		expect(() => decodeProgramEvents([`Program ${PROGRAM} invoke [1]`, 'Log truncated'])).toThrow(
			'truncated'
		);
	});
});

describe('ingestTransactions', () => {
	it('mirrors a token from its events and keeps every event in the audit log', async () => {
		const db = createTestD1();
		await ingestTransactions(db, [tx('sig-init', 10, [initialize])]);
		expect(await tokenRow(db)).toMatchObject({
			identifier: bytesToBase64Url(IDENTIFIER),
			secp256r1_public_key: bytesToBase64Url(PUBKEY),
			owner: null,
			mint: null,
			token_type: 'Controlled',
			is_locked: 0,
			status: 'live',
			initialize_signature: 'sig-init',
			created_at: 10_000,
			event_count: 1
		});

		const assignMint = data(
			new Uint8Array(
				getAssignMintEventEventEncoder().encode({ authority: ALICE, mint: MINT, ...token })
			)
		);
		await ingestTransactions(db, [
			tx('sig-own', 20, [setOwner(BOB)]),
			tx('sig-mint', 30, [assignMint])
		]);
		expect(await tokenRow(db)).toMatchObject({
			owner: BOB,
			mint: MINT,
			is_locked: 1,
			last_signature: 'sig-mint',
			updated_at: 30_000,
			event_count: 3
		});

		const removeOwner = data(
			new Uint8Array(getRemoveOwnerEventEventEncoder().encode({ owner: BOB, ...token }))
		);
		await ingestTransactions(db, [tx('sig-remove', 40, [removeOwner])]);
		expect(await tokenRow(db)).toMatchObject({ owner: null, is_locked: 0 });

		const close = data(
			new Uint8Array(
				getClosePhygitalTokenEventEventEncoder().encode({
					admin: ALICE,
					rentRecipient: ALICE,
					owner: NONE,
					mint: MINT,
					...token
				})
			)
		);
		await ingestTransactions(db, [tx('sig-close', 50, [close])]);
		expect(await tokenRow(db)).toMatchObject({ status: 'closed', is_locked: 0 });

		const { results } = await db
			.prepare('SELECT event_name FROM program_events ORDER BY slot')
			.all<{ event_name: string }>();
		expect(results.map((r) => r.event_name)).toEqual([
			'InitializeEvent',
			'SetOwnerEvent',
			'AssignMintEvent',
			'RemoveOwnerEvent',
			'ClosePhygitalTokenEvent'
		]);
	});

	it('mirrors the mint set at initialize', async () => {
		const db = createTestD1();
		await ingestTransactions(db, [tx('sig-init', 10, [initializeWith(MINT)])]);
		expect(await tokenRow(db)).toMatchObject({ mint: MINT, status: 'live' });
	});

	it('gives the same row for duplicate and out-of-order deliveries', async () => {
		const db = createTestD1();
		const transfer = tx('sig-own', 20, [setOwner(BOB)]);
		// The transfer arrives first: nothing to mirror until the initialize does.
		await ingestTransactions(db, [transfer]);
		expect(await tokenRow(db)).toBeNull();
		await ingestTransactions(db, [tx('sig-init', 10, [initialize]), transfer]);
		await ingestTransactions(db, [transfer]);
		expect(await tokenRow(db)).toMatchObject({
			owner: BOB,
			event_count: 2,
			last_signature: 'sig-own'
		});
		const { n } = (await db
			.prepare('SELECT COUNT(*) AS n FROM program_events')
			.first<{ n: number }>())!;
		expect(n).toBe(2);
	});

	it('orders transactions in the same slot by their place in the block', async () => {
		const db = createTestD1();
		await ingestTransactions(db, [
			tx('sig-b', 20, [setOwner(BOB)], { indexWithinBlock: 5 }),
			tx('sig-a', 20, [setOwner(ALICE)], { indexWithinBlock: 2 }),
			tx('sig-init', 10, [initialize])
		]);
		expect(await tokenRow(db)).toMatchObject({ owner: BOB });
	});

	it('skips failed transactions and ones with truncated logs', async () => {
		const db = createTestD1();
		const failed = tx('sig-failed', 10, [initialize]);
		const truncated = tx('sig-truncated', 11, [initialize, 'Log truncated']);
		await ingestTransactions(db, [
			{ ...failed, meta: { ...failed.meta, err: { InstructionError: [0, 'Custom'] } } },
			truncated
		]);
		expect(await db.prepare('SELECT 1 FROM program_events').first()).toBeNull();
	});

	it('mirrors the AdminConfig from its events', async () => {
		const db = createTestD1();
		const encode = <T>(encoder: { encode: (v: T) => ArrayLike<number> }, value: T) =>
			data(new Uint8Array(encoder.encode(value)));
		await ingestTransactions(db, [
			tx('sig-create', 1, [encode(getCreateConfigEventEventEncoder(), { authority: ALICE })]),
			tx('sig-issuer', 2, [encode(getSetIssuerEventEventEncoder(), { admin: ALICE, issuer: BOB })]),
			tx('sig-minter', 3, [
				encode(getSetMinterEventEventEncoder(), { admin: ALICE, minter: MINT })
			]),
			tx('sig-admin', 4, [
				encode(getSetAdminEventEventEncoder(), { previousAdmin: ALICE, newAdmin: OTHER })
			])
		]);
		const [config] = await findAdminConfigPda();
		expect(
			await db.prepare('SELECT * FROM admin_config WHERE address = ?').bind(config).first()
		).toMatchObject({
			admin: OTHER,
			issuer: BOB,
			minter: MINT,
			event_count: 4,
			last_signature: 'sig-admin'
		});
	});

	it('keeps the audit log append-only', async () => {
		const db = createTestD1();
		await ingestTransactions(db, [tx('sig-init', 10, [initialize])]);
		await expect(db.prepare("UPDATE program_events SET event_name = 'x'").run()).rejects.toThrow(
			'append-only'
		);
		await expect(db.prepare('DELETE FROM program_events').run()).rejects.toThrow('append-only');
	});
});

describe('authHeaderMatches', () => {
	it('accepts only the exact secret', async () => {
		expect(await authHeaderMatches('s3cret', 's3cret')).toBe(true);
		expect(await authHeaderMatches('s3cret ', 's3cret')).toBe(false);
		expect(await authHeaderMatches(null, 's3cret')).toBe(false);
	});
});
