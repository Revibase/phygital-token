import { describe, expect, it } from 'vitest';
import {
	appendTransactionMessageInstruction,
	blockhash,
	compileTransaction,
	createNoopSigner,
	decompileTransactionMessage,
	generateKeyPairSigner,
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
	getTransactionEncoder,
	type Rpc,
	type SolanaRpcApi
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

import { base64UrlToBytes } from '$lib/shared/encoding';
import {
	buildLinkTransaction,
	expectationFromPayload,
	LinkTransactionRejected,
	validateLinkTransaction
} from '$lib/shared/link-transaction';
import { createTestD1, MIGRATIONS } from '../testing/d1-sqlite';
import { fakeAccessory, fakePayload, ORIGIN, RP_ID } from '../testing/fixtures';
import { checkTransferAssertion } from './assertion';
import { hashCapability, mintCapability } from './capability';
import { claimCapability, createIntent, getIntent, toStatusView, transition } from './intents';

const rpc = {} as Rpc<SolanaRpcApi>; // completeTransfer never calls it
const BLOCKHASH = { blockhash: blockhash('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'), lastValidBlockHeight: 100n };

describe('checkTransferAssertion', () => {
	async function setup() {
		const acc = fakeAccessory();
		const challenge = crypto.getRandomValues(new Uint8Array(32));
		const base = {
			expectedChallenge: Buffer.from(challenge).toString('base64url'),
			expectedPublicKey: acc.publicKeyB64,
			account: acc.account(),
			rpId: RP_ID,
			origin: ORIGIN
		};
		return { acc, challenge, base };
	}

	it('accepts a fresh assertion from the session accessory', async () => {
		const { acc, challenge, base } = await setup();
		const result = await checkTransferAssertion({ ...base, response: acc.assert(challenge, { signCount: 4 }) });
		expect(result).toMatchObject({ ok: true, signCount: 4 });
	});

	it.each([
		['origin', { origin: 'https://evil.example' }, 'tap_rejected'],
		['rpId', { rpId: 'evil.example' }, 'tap_rejected'],
		['user presence', { flags: 0 }, 'tap_rejected'],
		['ceremony type', { type: 'webauthn.create' }, 'tap_rejected'],
		['stale signCount', { signCount: 3 }, 'already_used']
	])('rejects wrong %s', async (_label, opts, code) => {
		const { acc, challenge, base } = await setup();
		expect(await checkTransferAssertion({ ...base, response: acc.assert(challenge, opts) })).toMatchObject({ ok: false, code });
	});

	it('rejects a different challenge', async () => {
		const { acc, base } = await setup();
		const other = crypto.getRandomValues(new Uint8Array(32));
		expect(await checkTransferAssertion({ ...base, response: acc.assert(other) })).toMatchObject({ ok: false, code: 'tap_rejected' });
	});

	it('rejects a tap from a different accessory', async () => {
		const { challenge, base } = await setup();
		const other = fakeAccessory();
		expect(await checkTransferAssertion({ ...base, response: other.assert(challenge) })).toMatchObject({
			ok: false,
			code: 'different_accessory'
		});
	});

	it('rejects a forged signature claiming the right credential id', async () => {
		const { acc, challenge, base } = await setup();
		const forged = fakeAccessory().assert(challenge);
		forged.id = acc.publicKeyB64;
		forged.rawId = acc.publicKeyB64;
		expect(await checkTransferAssertion({ ...base, response: forged })).toMatchObject({ ok: false, code: 'tap_rejected' });
	});

	it('rejects locked and permanent accessories', async () => {
		const { acc, challenge, base } = await setup();
		const response = acc.assert(challenge);
		expect(await checkTransferAssertion({ ...base, response, account: acc.account({ isLocked: 1 }) })).toMatchObject({ code: 'accessory_locked' });
		expect(await checkTransferAssertion({ ...base, response, account: acc.account({ tokenType: 0, isLocked: 1 }) })).toMatchObject({ code: 'accessory_permanent' });
	});
});

describe('link transaction (SDK completeTransfer) + validator', () => {
	it('builds [budget, budget, secp256r1_verify, set_linked_wallet] that validates', async () => {
		const { payload, recipient } = await fakePayload();
		const { wireBytes } = await buildLinkTransaction({ payload, rpc, recipient, blockhash: BLOCKHASH });
		expect(() => validateLinkTransaction(wireBytes, expectationFromPayload(payload, recipient.address))).not.toThrow();
	});

	it('rejects a different wallet than the one approving', async () => {
		const { payload, recipient } = await fakePayload();
		const { wireBytes } = await buildLinkTransaction({ payload, rpc, recipient, blockhash: BLOCKHASH });
		const someoneElse = (await generateKeyPairSigner()).address;
		expect(() => validateLinkTransaction(wireBytes, expectationFromPayload(payload, someoneElse))).toThrow(LinkTransactionRejected);
	});

	it('rejects a different accessory, slot, or tap data', async () => {
		const { payload, recipient } = await fakePayload();
		const { wireBytes } = await buildLinkTransaction({ payload, rpc, recipient, blockhash: BLOCKHASH });
		const exp = expectationFromPayload(payload, recipient.address);
		const other = fakeAccessory();
		expect(() => validateLinkTransaction(wireBytes, { ...exp, secp256r1Pubkey: other.publicKey })).toThrow(/different accessory/);
		expect(() => validateLinkTransaction(wireBytes, { ...exp, phygitalToken: String(recipient.address) })).toThrow(/phygital token/);
		expect(() => validateLinkTransaction(wireBytes, { ...exp, slotNumber: 1n })).toThrow(/slot/);
		expect(() => validateLinkTransaction(wireBytes, { ...exp, clientDataJson: new Uint8Array([1]) })).toThrow(/tap data/);
	});

	it('rejects smuggled instructions and extra signers', async () => {
		const { payload, recipient } = await fakePayload();
		const { transaction } = await buildLinkTransaction({ payload, rpc, recipient, blockhash: BLOCKHASH });
		const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(transaction.messageBytes));
		const attacker = await generateKeyPairSigner();

		const drain = appendTransactionMessageInstruction(
			getTransferSolInstruction({ source: createNoopSigner(recipient.address), destination: attacker.address, amount: 1n }),
			message
		);
		const drainBytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(drain)));
		expect(() => validateLinkTransaction(drainBytes, expectationFromPayload(payload, recipient.address))).toThrow(/unexpected program/);
	});

	it('rejects garbage bytes', async () => {
		const { payload, recipient } = await fakePayload();
		expect(() => validateLinkTransaction(new Uint8Array([1, 2, 3]), expectationFromPayload(payload, recipient.address))).toThrow(LinkTransactionRejected);
	});

	it('round-trips through the wire decoder', async () => {
		const { payload, recipient } = await fakePayload();
		const { wireBytes } = await buildLinkTransaction({ payload, rpc, recipient, blockhash: BLOCKHASH });
		const decoded = getTransactionDecoder().decode(wireBytes);
		expect(Object.keys(decoded.signatures)).toEqual([recipient.address]);
		expect(base64UrlToBytes(payload.response.response.clientDataJSON).length).toBeGreaterThan(0);
	});
});

describe('link intents', () => {
	it('transitions are compare-and-set', async () => {
		const db = createTestD1([MIGRATIONS]);
		const row = await createIntent(db, { kind: 'phone', state: 'created', pda: 'pda1' });
		expect(await transition(db, row.id, ['created'], 'awaiting_passkey')).toBe(true);
		expect(await transition(db, row.id, ['created'], 'awaiting_passkey')).toBe(false);
		expect((await getIntent(db, row.id))?.state).toBe('awaiting_passkey');
	});

	it('terminal states drop the stored assertion', async () => {
		const db = createTestD1([MIGRATIONS]);
		const row = await createIntent(db, { kind: 'phone', state: 'awaiting_passkey', pda: 'pda1' });
		await transition(db, row.id, ['awaiting_passkey'], 'tapped', { assertion: '{"secret":true}' });
		await transition(db, row.id, ['tapped'], 'cancelled');
		expect((await getIntent(db, row.id))?.assertion).toBeNull();
	});

	it('a new ceremony for the same accessory cancels the old one', async () => {
		const db = createTestD1([MIGRATIONS]);
		const first = await createIntent(db, { kind: 'phone', state: 'created', pda: 'pda1' });
		await transition(db, first.id, ['created'], 'tapped', { assertion: 'x' });
		const second = await createIntent(db, { kind: 'phone', state: 'created', pda: 'pda1' });
		expect((await getIntent(db, first.id))).toMatchObject({ state: 'cancelled', assertion: null });
		expect((await getIntent(db, second.id))?.state).toBe('created');
	});

	it('reports the accessory’s token type so each side can word the link for it', async () => {
		const db = createTestD1([MIGRATIONS]);
		const phone = await createIntent(db, { kind: 'phone', state: 'created', pda: 'pda1', identifier: 'AAAA', token_kind: 'bearer' });
		expect(toStatusView((await getIntent(db, phone.id))!).accessory).toMatchObject({ pda: 'pda1', kind: 'bearer' });

		// Desktop: the type arrives with the accessory, once the phone taps.
		const desktop = await createIntent(db, { kind: 'desktop', state: 'paired' });
		expect(toStatusView(desktop).accessory).toBeNull();
		await transition(db, desktop.id, ['paired'], 'accessory_attached', { pda: 'pda2', identifier: 'BBBB', token_kind: 'controlled' });
		expect(toStatusView((await getIntent(db, desktop.id))!).accessory).toMatchObject({ pda: 'pda2', kind: 'controlled' });

		// Rows from before the type was recorded.
		const old = await createIntent(db, { kind: 'phone', state: 'created', pda: 'pda3', identifier: 'CCCC' });
		expect(toStatusView(old).accessory?.kind).toBe('unknown');
	});

	it('expires ceremonies past their TTL', async () => {
		const db = createTestD1([MIGRATIONS]);
		const row = await createIntent(db, { kind: 'phone', state: 'created' }, 1_000);
		expect((await getIntent(db, row.id, 1_000 + 11 * 60 * 1000))?.state).toBe('expired');
	});

	it('capabilities are single-use and a second claim is recorded as a conflict', async () => {
		const db = createTestD1([MIGRATIONS]);
		const row = await createIntent(db, { kind: 'phone', state: 'tapped' });
		const cap = mintCapability();
		await transition(db, row.id, ['tapped'], 'tapped', { capability_hash: cap.hash, capability_expires_at: Date.now() + 60_000 });

		expect((await claimCapability(db, hashCapability(cap.token))).status).toBe('ok');
		expect((await claimCapability(db, hashCapability(cap.token))).status).toBe('already_claimed');
		expect((await getIntent(db, row.id))?.capability_conflicts).toBe(1);
		expect((await claimCapability(db, hashCapability(mintCapability().token))).status).toBe('invalid');
	});

	it('expired capabilities cannot be claimed', async () => {
		const db = createTestD1([MIGRATIONS]);
		const row = await createIntent(db, { kind: 'phone', state: 'tapped' });
		const cap = mintCapability();
		await transition(db, row.id, ['tapped'], 'tapped', { capability_hash: cap.hash, capability_expires_at: Date.now() - 1 });
		expect((await claimCapability(db, hashCapability(cap.token))).status).toBe('expired');
	});
});

describe('checkTransferAssertion type rules', () => {
	it('refuses a tap for a linked Controlled token, even with the lock flag clear', async () => {
		const acc = fakeAccessory();
		const challenge = crypto.getRandomValues(new Uint8Array(32));
		const result = await checkTransferAssertion({
			response: acc.assert(challenge),
			expectedChallenge: Buffer.from(challenge).toString('base64url'),
			expectedPublicKey: acc.publicKeyB64,
			account: acc.account({ tokenType: 2, isLocked: 0, linkedWallet: (await generateKeyPairSigner()).address }),
			rpId: RP_ID,
			origin: ORIGIN
		});
		expect(result).toMatchObject({ ok: false, code: 'accessory_locked' });
	});
});
