import { json, type Cookies } from '@sveltejs/kit';
import { isAddress, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { beginTransfer } from 'phygital-token-sdk';

import { bytesToBase64, bytesToBase64Url } from '$lib/shared/encoding';
import type { LinkErrorCode, TransferChallenge, TransferPayload } from '$lib/shared/types';
import { fetchAccessory } from '../accessory/resolve';
import { toAccessoryView } from '../accessory/view';
import { getRpc, type ServerEnv } from '../env';
import {
	readAccessorySession,
	readFinisherSession,
	readPairSession,
	setFinisherSession,
	setPairSession,
	type AccessorySession
} from '../session/cookies';
import { checkTransferAssertion, parseAssertion } from './assertion';
import { hashCapability, isWellFormedCapability, mintCapability, pairingCode } from './capability';
import { checkSubmittedLink } from './confirm';
import {
	claimCapability,
	createIntent,
	getIntent,
	isTerminal,
	pruneIntents,
	supersedeOthers,
	toStatusView,
	transition,
	type IntentRow
} from './intents';
import { simulateLink } from './simulate';
import { tapWindow as slotHashWindow } from './slot-window';

/** Desktop pair QR lifetime. */
export const PAIR_CAPABILITY_TTL_MS = 5 * 60 * 1000;

export class LinkApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: LinkErrorCode | 'forbidden' | 'not_found' | 'conflict' | 'bad_request' | 'expired',
		message: string
	) {
		super(message);
	}
}

export function errorResponse(err: unknown) {
	if (err instanceof LinkApiError) return json({ error: err.message, code: err.code }, { status: err.status });
	console.error('link api error', err);
	return json({ error: 'Something went wrong. Try again.', code: 'network' }, { status: 502 });
}

const forbidden = () => new LinkApiError(403, 'forbidden', 'This linking session belongs to another device.');
const notFound = () => new LinkApiError(404, 'not_found', 'This linking session no longer exists.');
const conflict = (msg = 'This step already happened. Refresh to continue.') => new LinkApiError(409, 'conflict', msg);

// ---------------------------------------------------------------------------
// Who is calling?

export type Caller = {
	acc: AccessorySession | null;
	finisher: { t: 'hof' | 'dsk'; sid: string; linkId: string }[];
	pair: { sid: string; linkId: string } | null;
};

export async function readCaller(cookies: Cookies, env: ServerEnv): Promise<Caller> {
	const [acc, hof, dsk, pair] = await Promise.all([
		readAccessorySession(cookies, env.sessionSecret),
		readFinisherSession(cookies, env.sessionSecret, 'hof'),
		readFinisherSession(cookies, env.sessionSecret, 'dsk'),
		readPairSession(cookies, env.sessionSecret)
	]);
	return {
		acc,
		finisher: [hof, dsk].filter((s) => s !== null).map((s) => ({ t: s!.t, sid: s!.sid, linkId: s!.linkId })),
		pair: pair ? { sid: pair.sid, linkId: pair.linkId } : null
	};
}

/** The browser that tapped the accessory (and owns WebAuthn for this ceremony). */
function isOrigin(caller: Caller, row: IntentRow): boolean {
	return !!caller.acc && !!row.acc_sid && caller.acc.sid === row.acc_sid;
}

/** The single context allowed to receive the tap and sign. */
function isFinisher(caller: Caller, row: IntentRow): boolean {
	if (!row.finisher || !row.finisher_sid) return false;
	if (row.finisher === 'acc') return !!caller.acc && caller.acc.sid === row.finisher_sid;
	return caller.finisher.some((f) => f.t === row.finisher && f.sid === row.finisher_sid && f.linkId === row.id);
}

function isPairedPhone(caller: Caller, row: IntentRow): boolean {
	return !!caller.pair && caller.pair.linkId === row.id && row.kind === 'desktop';
}

async function loadIntent(env: ServerEnv, id: string): Promise<IntentRow> {
	if (!/^[A-Za-z0-9_-]{16,32}$/.test(id)) throw notFound();
	const row = await getIntent(env.db, id);
	if (!row) throw notFound();
	return row;
}

// ---------------------------------------------------------------------------
// Slot window

async function tapWindow(rpc: Rpc<SolanaRpcApi>, row: IntentRow) {
	if (!row.slot_number || !row.assertion) return { over: false, expiresAt: null as number | null, totalMs: null as number | null };
	const w = await slotHashWindow(rpc, BigInt(row.slot_number));
	return { over: !w.alive, expiresAt: w.expiresAt, totalMs: w.totalMs };
}

/**
 * A tap whose slot has aged out can never land. Drop it and go back to
 * "needs a tap", keeping the finisher so the wallet side can simply wait.
 */
async function recycleStaleTap(env: ServerEnv, row: IntentRow): Promise<IntentRow> {
	const back = row.kind === 'desktop' ? 'accessory_confirmed' : 'created';
	const unclaimed = row.capability_claimed_at === null;
	await transition(env.db, row.id, ['tapped', 'claimed', 'finishing'], back, {
		assertion: null,
		slot_number: null,
		slot_hash: null,
		challenge: null,
		recipient: null,
		error_code: 'too_slow',
		...(row.kind === 'phone' && unclaimed ? { capability_hash: null, capability_expires_at: null, finisher: null } : {})
	});
	return (await getIntent(env.db, row.id))!;
}

async function statusFor(env: ServerEnv, row: IntentRow, rpc: Rpc<SolanaRpcApi>) {
	let current = row;
	let tapExpiresAt: number | null = null;
	let tapWindowMs: number | null = null;

	if (current.state === 'submitted' && current.tx_signature && current.pda && current.recipient) {
		const window = await tapWindow(rpc, current);
		const outcome = await checkSubmittedLink(rpc, {
			txSignature: current.tx_signature,
			pda: current.pda,
			recipient: current.recipient,
			tapWindowOver: window.over
		});
		if (outcome.status === 'linked') {
			await transition(env.db, current.id, ['submitted'], 'linked', { error_code: null });
			current = (await getIntent(env.db, current.id))!;
		} else if (outcome.status === 'failed') {
			if (outcome.code === 'too_slow') {
				// Did not land in time: let the user tap again rather than dead-ending.
				await transition(env.db, current.id, ['submitted'], 'finishing', { tx_signature: null });
				current = await recycleStaleTap(env, (await getIntent(env.db, current.id))!);
			} else {
				await transition(env.db, current.id, ['submitted'], 'failed', { error_code: outcome.code });
				current = (await getIntent(env.db, current.id))!;
			}
		}
	} else if (['tapped', 'claimed', 'finishing'].includes(current.state)) {
		const window = await tapWindow(rpc, current);
		if (window.over) current = await recycleStaleTap(env, current);
		else {
			tapExpiresAt = window.expiresAt;
			tapWindowMs = window.totalMs;
		}
	}

	const code =
		current.kind === 'desktop' && current.pda ? await pairingCode(env.sessionSecret, current.id, current.pda) : null;
	return toStatusView(current, { pairingCode: code, tapExpiresAt, tapWindowMs });
}

// ---------------------------------------------------------------------------
// Phone ceremony

export async function startPhoneLink(env: ServerEnv, caller: Caller) {
	if (!caller.acc) throw new LinkApiError(401, 'expired', 'Tap your accessory again to continue.');
	const rpc = getRpc(env);
	const accessory = await fetchAccessory(rpc, caller.acc.pda);
	if (!accessory) throw notFound();
	const view = toAccessoryView(accessory.pda, accessory.account);
	if (!view.canLink) {
		throw new LinkApiError(409, view.kind === 'permanent' ? 'accessory_permanent' : 'accessory_locked', 'This accessory can’t be linked right now.');
	}
	await pruneIntents(env.db);
	const row = await createIntent(env.db, {
		kind: 'phone',
		state: 'created',
		acc_sid: caller.acc.sid,
		pda: accessory.pda,
		identifier: view.identifier,
		public_key: view.publicKey
	});
	return toStatusView(row);
}

export async function issueChallenge(env: ServerEnv, caller: Caller, id: string): Promise<TransferChallenge> {
	const row = await loadIntent(env, id);
	if (!isOrigin(caller, row)) throw forbidden();
	// A phone tap whose handoff link was never opened can be redone (e.g. after a reload lost the link).
	const redoUnclaimedTap = row.state === 'tapped' && row.kind === 'phone' && row.capability_claimed_at === null;
	if (!['created', 'accessory_confirmed', 'awaiting_passkey'].includes(row.state) && !redoUnclaimedTap) throw conflict();
	if (!row.pda || !row.public_key) throw conflict();

	const rpc = getRpc(env);
	const session = await beginTransfer({ rpc, secp256r1Pubkey: row.public_key, rpId: env.rpId });
	const fields = {
		slot_number: session.slotNumber.toString(),
		slot_hash: bytesToBase64(new Uint8Array(session.slotHash)),
		challenge: bytesToBase64Url(new Uint8Array(session.challenge))
	};
	const ok = await transition(env.db, row.id, [row.state], 'awaiting_passkey', {
		...fields,
		error_code: null,
		...(redoUnclaimedTap ? { assertion: null, capability_hash: null, capability_expires_at: null, finisher: null } : {})
	});
	if (!ok) throw conflict();
	return {
		linkId: row.id,
		phygitalToken: row.pda,
		secp256r1Pubkey: row.public_key,
		slotNumber: fields.slot_number,
		slotHash: fields.slot_hash,
		challenge: fields.challenge,
		rpId: env.rpId
	};
}

export async function acceptAssertion(
	env: ServerEnv,
	caller: Caller,
	id: string,
	body: { response?: unknown; finishHere?: unknown }
) {
	const row = await loadIntent(env, id);
	if (!isOrigin(caller, row)) throw forbidden();
	if (row.state !== 'awaiting_passkey' || !row.challenge || !row.public_key || !row.pda || !row.slot_number) {
		throw conflict();
	}
	const rpc = getRpc(env);
	const window = await slotHashWindow(rpc, BigInt(row.slot_number));
	if (!window.alive) {
		throw new LinkApiError(409, 'too_slow', 'That took a little too long. Tap again.');
	}
	const accessory = await fetchAccessory(rpc, row.pda);
	if (!accessory) throw notFound();

	const check = checkTransferAssertion({
		response: body.response,
		expectedChallenge: row.challenge,
		expectedPublicKey: row.public_key,
		account: accessory.account,
		rpId: env.rpId,
		origin: env.origin
	});
	if (!check.ok) {
		const status = check.code === 'different_accessory' ? 409 : 400;
		throw new LinkApiError(status, check.code, check.detail);
	}

	const finishHere = body.finishHere === true && row.kind === 'phone';
	const alreadyClaimed = row.kind === 'phone' && row.capability_claimed_at !== null && !!row.finisher_sid;
	let handoffToken: string | null = null;
	const patch: Parameters<typeof transition>[4] = { assertion: JSON.stringify(check.assertion), error_code: null };

	if (row.kind === 'phone' && finishHere) {
		patch.finisher = 'acc';
		patch.finisher_sid = caller.acc!.sid;
	} else if (row.kind === 'phone' && !alreadyClaimed) {
		const cap = mintCapability();
		handoffToken = cap.token;
		patch.finisher = 'hof';
		patch.finisher_sid = null;
		patch.capability_hash = cap.hash;
		patch.capability_claimed_at = null;
		// `h` must not outlive the tap it unlocks.
		patch.capability_expires_at = window.expiresAt;
	}
	const next = alreadyClaimed ? 'claimed' : 'tapped';
	if (!(await transition(env.db, row.id, ['awaiting_passkey'], next, patch))) throw conflict();

	return {
		status: await statusFor(env, (await getIntent(env.db, row.id))!, rpc),
		// Fragment only: never reaches our logs or a Referer header.
		handoffUrl: handoffToken ? `${env.origin}/continue#h=${handoffToken}` : null
	};
}

export async function claimHandoff(env: ServerEnv, cookies: Cookies, body: { h?: unknown }) {
	if (!isWellFormedCapability(body.h)) throw new LinkApiError(400, 'bad_request', 'This link is incomplete.');
	const claim = await claimCapability(env.db, hashCapability(body.h));
	if (claim.status === 'already_claimed') {
		throw new LinkApiError(409, 'already_used', 'This link was already opened on another device.');
	}
	if (claim.status !== 'ok' || claim.row.kind !== 'phone') {
		throw new LinkApiError(410, 'expired', 'This link has expired. Tap your accessory again.');
	}
	const session = await setFinisherSession(cookies, env.sessionSecret, 'hof', claim.row.id);
	const ok = await transition(env.db, claim.row.id, ['tapped'], 'claimed', { finisher: 'hof', finisher_sid: session.sid });
	if (!ok) throw new LinkApiError(410, 'expired', 'This link has expired. Tap your accessory again.');
	return statusFor(env, (await getIntent(env.db, claim.row.id))!, getRpc(env));
}

// ---------------------------------------------------------------------------
// Finishing (any finisher: same browser, wallet app, desktop)

export async function setRecipient(env: ServerEnv, caller: Caller, id: string, body: { address?: unknown }) {
	const row = await loadIntent(env, id);
	if (!isFinisher(caller, row)) throw forbidden();
	if (!['tapped', 'claimed', 'finishing'].includes(row.state)) throw conflict();
	if (typeof body.address !== 'string' || !isAddress(body.address)) {
		throw new LinkApiError(400, 'bad_request', 'That doesn’t look like a wallet address.');
	}
	const rpc = getRpc(env);
	const window = await tapWindow(rpc, row);
	if (window.over) {
		await recycleStaleTap(env, row);
		throw new LinkApiError(409, 'too_slow', 'That took a little too long. Tap your accessory again.');
	}
	const payload = payloadFor(env, row);
	const simulation = await simulateLink(rpc, payload, body.address);
	if (!simulation.ok) {
		if (['accessory_locked', 'accessory_permanent', 'already_used', 'different_accessory'].includes(simulation.code)) {
			await transition(env.db, row.id, [row.state], 'failed', { error_code: simulation.code });
		}
		throw new LinkApiError(409, simulation.code, 'The network rejected this link.');
	}
	if (!(await transition(env.db, row.id, [row.state], 'finishing', { recipient: body.address, error_code: null }))) {
		throw conflict();
	}
	return { payload, tapExpiresAt: window.expiresAt, tapWindowMs: window.totalMs };
}

function payloadFor(env: ServerEnv, row: IntentRow): TransferPayload {
	const response = row.assertion ? parseAssertion(JSON.parse(row.assertion)) : null;
	if (!response || !row.pda || !row.public_key || !row.slot_number || !row.slot_hash || !row.challenge) throw conflict();
	return {
		linkId: row.id,
		phygitalToken: row.pda,
		secp256r1Pubkey: row.public_key,
		slotNumber: row.slot_number,
		slotHash: row.slot_hash,
		challenge: row.challenge,
		rpId: env.rpId,
		response
	};
}

export async function markSubmitted(env: ServerEnv, caller: Caller, id: string, body: { signature?: unknown }) {
	const row = await loadIntent(env, id);
	if (!isFinisher(caller, row)) throw forbidden();
	if (row.state !== 'finishing') throw conflict();
	if (typeof body.signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(body.signature)) {
		throw new LinkApiError(400, 'bad_request', 'Invalid transaction signature.');
	}
	if (!(await transition(env.db, row.id, ['finishing'], 'submitted', { tx_signature: body.signature }))) throw conflict();
	return statusFor(env, (await getIntent(env.db, row.id))!, getRpc(env));
}

export async function linkStatus(env: ServerEnv, caller: Caller, id: string) {
	const row = await loadIntent(env, id);
	if (!isOrigin(caller, row) && !isFinisher(caller, row) && !isPairedPhone(caller, row)) throw forbidden();
	return statusFor(env, row, getRpc(env));
}

export async function cancelLink(env: ServerEnv, caller: Caller, id: string) {
	const row = await loadIntent(env, id);
	if (!isOrigin(caller, row) && !isFinisher(caller, row) && !isPairedPhone(caller, row)) throw forbidden();
	if (isTerminal(row.state) || row.state === 'submitted') throw conflict('This link can no longer be cancelled.');
	await transition(env.db, row.id, [row.state], 'cancelled');
	return toStatusView((await getIntent(env.db, row.id))!);
}

// ---------------------------------------------------------------------------
// Desktop pairing

export async function startDesktopPairing(env: ServerEnv, cookies: Cookies) {
	await pruneIntents(env.db);
	const row = await createIntent(env.db, { kind: 'desktop', state: 'pairing', finisher: 'dsk' });
	const session = await setFinisherSession(cookies, env.sessionSecret, 'dsk', row.id);
	const cap = mintCapability();
	await transition(env.db, row.id, ['pairing'], 'pairing', {
		finisher_sid: session.sid,
		capability_hash: cap.hash,
		capability_expires_at: Date.now() + PAIR_CAPABILITY_TTL_MS
	});
	return {
		status: toStatusView((await getIntent(env.db, row.id))!),
		pairUrl: `${env.origin}/pair#p=${cap.token}`
	};
}

export async function claimPairing(env: ServerEnv, cookies: Cookies, caller: Caller, body: { p?: unknown }) {
	if (!isWellFormedCapability(body.p)) throw new LinkApiError(400, 'bad_request', 'This code is incomplete.');
	const claim = await claimCapability(env.db, hashCapability(body.p));
	if (claim.status === 'already_claimed') {
		throw new LinkApiError(409, 'already_used', 'This code was already scanned by another phone.');
	}
	if (claim.status !== 'ok' || claim.row.kind !== 'desktop') {
		throw new LinkApiError(410, 'expired', 'This code has expired. Start again on your computer.');
	}
	await setPairSession(cookies, env.sessionSecret, claim.row.id);
	if (!(await transition(env.db, claim.row.id, ['pairing'], 'paired'))) {
		throw new LinkApiError(410, 'expired', 'This code has expired. Start again on your computer.');
	}
	// Tapped before scanning? Attach the accessory straight away.
	if (caller.acc) await attachAccessoryToPairing(env, claim.row.id, caller.acc);
	return toStatusView((await getIntent(env.db, claim.row.id))!);
}

/** Called after a verified tap when this phone holds a pair session (either order). */
export async function attachAccessoryToPairing(env: ServerEnv, linkId: string, acc: AccessorySession): Promise<boolean> {
	const rpc = getRpc(env);
	const accessory = await fetchAccessory(rpc, acc.pda);
	if (!accessory) return false;
	const view = toAccessoryView(accessory.pda, accessory.account);
	const ok = await transition(env.db, linkId, ['paired'], 'accessory_attached', {
		acc_sid: acc.sid,
		pda: accessory.pda,
		identifier: view.identifier,
		public_key: view.publicKey,
		error_code: view.canLink ? null : view.kind === 'permanent' ? 'accessory_permanent' : 'accessory_locked'
	});
	if (ok) await supersedeOthers(env.db, accessory.pda, linkId);
	return ok;
}

export async function confirmPairedAccessory(env: ServerEnv, caller: Caller, id: string) {
	const row = await loadIntent(env, id);
	if (!isFinisher(caller, row) || row.kind !== 'desktop') throw forbidden();
	if (row.error_code === 'accessory_locked' || row.error_code === 'accessory_permanent') {
		throw new LinkApiError(409, row.error_code, 'This accessory can’t be linked right now.');
	}
	if (!(await transition(env.db, row.id, ['accessory_attached'], 'accessory_confirmed'))) throw conflict();
	return statusFor(env, (await getIntent(env.db, row.id))!, getRpc(env));
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
	if (!request.headers.get('content-type')?.includes('application/json')) {
		throw new LinkApiError(415, 'bad_request', 'Expected JSON.');
	}
	try {
		const body = await request.json();
		return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	} catch {
		throw new LinkApiError(400, 'bad_request', 'Invalid JSON.');
	}
}
