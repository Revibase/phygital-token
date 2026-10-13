/**
 * `/api/sponsor`: pays network fees from the pool when an owner can't, and for
 * accessory taps. Each accessory has prepaid fees in D1; when they run low the
 * transaction itself refills them from the accessory wallet.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import {
	getBase58Decoder,
	getBase64Encoder,
	isAddress,
	type Address,
	type Base64EncodedWireTransaction,
	type Rpc,
	type SolanaRpcApi
} from '@solana/kit';
import { PHYGITAL_TOKEN_DISCRIMINATOR, PHYGITAL_TOKEN_PROGRAM_ADDRESS } from 'phygital-token-sdk';

import { bytesEqual, bytesToBase64 } from '$lib/shared/encoding';
import { getEnv, getRpc, type ServerEnv } from '../env';
import { inspectSponsored, SponsorError, type Inspected } from './inspect';
import { prepaidBalance, reserve, settlePending } from './ledger';
import { offeredFeePayers, signWithPoolKey, sponsorKeys } from './pool';

const MAX_TRANSACTIONS = 4;
const MAX_WIRE_BYTES = 4096;

export type SponsorInfo = {
	feePayers: string[];
	maxComputeUnitLimit: number;
	maxComputeUnitPrice: string;
	prepaidLamports?: string;
	balanceLamports?: string;
};

export async function sponsorInfo(
	env: ServerEnv,
	rpc: Rpc<SolanaRpcApi>,
	accessory: string | null
): Promise<SponsorInfo> {
	const info: SponsorInfo = {
		feePayers: await offeredFeePayers(env.sponsor, rpc),
		maxComputeUnitLimit: env.sponsor.maxComputeUnitLimit,
		maxComputeUnitPrice: String(env.sponsor.maxComputeUnitPrice)
	};
	if (accessory === null) return info;
	if (!isAddress(accessory))
		throw new SponsorError(400, 'bad_request', 'accessory must be an address');
	await settlePending(env.db, rpc, accessory);
	const balance = await prepaidBalance(env.db, accessory, env.sponsor.prepaidLamports);
	return {
		...info,
		prepaidLamports: String(env.sponsor.prepaidLamports),
		balanceLamports: String(balance)
	};
}

async function assertRealAccessory(rpc: Rpc<SolanaRpcApi>, accessory: Address) {
	const { value } = await rpc
		.getAccountInfo(accessory, { encoding: 'base64', dataSlice: { offset: 0, length: 8 } })
		.send();
	const head = value ? new Uint8Array(getBase64Encoder().encode(value.data[0])) : null;
	if (
		!value ||
		value.owner !== PHYGITAL_TOKEN_PROGRAM_ADDRESS ||
		!head ||
		!bytesEqual(head, new Uint8Array(PHYGITAL_TOKEN_DISCRIMINATOR))
	) {
		throw new SponsorError(400, 'not_sponsorable', 'Not a Revibase accessory');
	}
}

/** Simulate and return how much tap-payments rent the pool key pays (0 unless it funds the policy). */
async function simulate(rpc: Rpc<SolanaRpcApi>, wire: string, tx: Inspected): Promise<bigint> {
	const watched = [tx.feePayer, ...(tx.policy ? [tx.policy] : [])];
	const before = await rpc
		.getMultipleAccounts(watched, { encoding: 'base64', commitment: 'confirmed' })
		.send();
	const { value } = await rpc
		.simulateTransaction(wire as Base64EncodedWireTransaction, {
			encoding: 'base64',
			sigVerify: false,
			replaceRecentBlockhash: false,
			commitment: 'confirmed',
			accounts: { encoding: 'base64', addresses: watched }
		})
		.send();
	if (value.err) {
		throw new SponsorError(400, 'simulation_failed', 'This transaction would fail', {
			logs: value.logs?.slice(-8) ?? []
		});
	}
	const lamports = (
		list: readonly ({ lamports: bigint | number } | null)[] | null | undefined,
		i: number
	) => BigInt(list?.[i]?.lamports ?? 0);
	const rent =
		tx.policy && tx.fundsPolicy ? lamports(value.accounts, 1) - lamports(before.value, 1) : 0n;
	const rentIncrease = rent > 0n ? rent : 0n;
	const drop = lamports(before.value, 0) - lamports(value.accounts, 0);
	if (drop > tx.fee + rentIncrease - tx.refill) {
		throw new SponsorError(
			400,
			'not_sponsorable',
			'This transaction spends more of our SOL than its fee'
		);
	}
	return rentIncrease;
}

export async function signSponsored(
	env: ServerEnv,
	rpc: Rpc<SolanaRpcApi>,
	transactions: unknown
): Promise<{ signatures: string[] }> {
	if (
		!Array.isArray(transactions) ||
		transactions.length === 0 ||
		transactions.length > MAX_TRANSACTIONS
	) {
		throw new SponsorError(400, 'bad_request', `Send 1 to ${MAX_TRANSACTIONS} transactions`);
	}
	const keys = await sponsorKeys(env.sponsor);
	if (keys.size === 0)
		throw new SponsorError(503, 'unavailable', 'Network fees are not being covered right now');
	const pool = new Set(keys.keys());
	const caps = {
		maxComputeUnitLimit: env.sponsor.maxComputeUnitLimit,
		maxComputeUnitPrice: env.sponsor.maxComputeUnitPrice
	};

	// Pure checks for all of them first, so junk never costs an RPC call.
	const inspected = transactions.map((wire) => {
		if (typeof wire !== 'string' || wire.length > MAX_WIRE_BYTES * 2)
			throw new SponsorError(400, 'bad_request', 'transactions must be base64 strings');
		let bytes: Uint8Array;
		try {
			bytes = new Uint8Array(getBase64Encoder().encode(wire));
		} catch {
			throw new SponsorError(400, 'bad_request', 'transactions must be base64 strings');
		}
		return { wire, tx: inspectSponsored(bytes, pool, caps) };
	});

	// Settle each accessory's earlier transactions once, before charging any of these.
	await Promise.all(
		[...new Set(inspected.map(({ tx }) => tx.accessory))].map((accessory) =>
			settlePending(env.db, rpc, accessory)
		)
	);
	const signatures: string[] = [];
	for (const { wire, tx } of inspected) {
		const [, rent] = await Promise.all([
			assertRealAccessory(rpc, tx.accessory),
			simulate(rpc, wire, tx)
		]);
		const cost = tx.fee + rent;
		const signature = await signWithPoolKey(keys.get(tx.feePayer)!, tx.messageBytes);
		const id = getBase58Decoder().decode(signature);

		const charged = await reserve(env.db, env.sponsor.prepaidLamports, {
			signature: id,
			accessory: tx.accessory,
			feePayer: tx.feePayer,
			fee: tx.fee,
			cost,
			refill: tx.refill,
			blockhash: tx.blockhash
		});
		if (!charged) {
			const balance = await prepaidBalance(env.db, tx.accessory, env.sponsor.prepaidLamports);
			const needed = env.sponsor.prepaidLamports - balance + cost;
			throw new SponsorError(
				402,
				'refill_required',
				"This accessory's prepaid network fees need a refill from its wallet",
				{
					balanceLamports: String(balance),
					neededLamports: String(needed > cost - balance ? needed : cost - balance)
				}
			);
		}
		signatures.push(bytesToBase64(new Uint8Array(signature)));
	}
	return { signatures };
}

function respond(err: unknown) {
	if (err instanceof SponsorError) {
		return json(
			{ error: err.message, code: err.code, soft: err.status === 402, details: err.details },
			{ status: err.status }
		);
	}
	console.error('sponsor error', err);
	return json({ error: 'Something went wrong. Try again.', code: 'unavailable' }, { status: 502 });
}

export const sponsorGet: RequestHandler = async ({ url, platform }) => {
	const env = getEnv(platform);
	try {
		return json(await sponsorInfo(env, getRpc(env), url.searchParams.get('accessory')));
	} catch (err) {
		return respond(err);
	}
};

export const sponsorSign: RequestHandler = async ({ request, platform }) => {
	const env = getEnv(platform);
	let body: { transactions?: unknown };
	try {
		body = await request.json<typeof body>();
	} catch {
		return json({ error: 'Invalid JSON body', code: 'bad_request' }, { status: 400 });
	}
	try {
		return json(await signSponsored(env, getRpc(env), body?.transactions));
	} catch (err) {
		return respond(err);
	}
};
