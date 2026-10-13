/**
 * What the fee service will pay for, decided from the transaction bytes alone
 * (no RPC): it must act on exactly one accessory, pool keys may appear only
 * where they pay (fee payer, tap-payments rent) or get refilled, and its
 * fees must stay within the caps.
 */
import {
	decompileTransactionMessage,
	getAddressEncoder,
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
	getTransactionMessageComputeUnitLimit,
	getTransactionMessageComputeUnitPrice,
	getTransactionMessagePriorityFeeLamports,
	type Address,
	type Instruction,
	type SignaturesMap
} from '@solana/kit';
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from '@solana-program/compute-budget';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
	EXECUTE_WITH_ACCESSORY_NAMED_ACCOUNT_COUNT,
	EXECUTE_WITH_OWNER_NAMED_ACCOUNT_COUNT,
	identifyPhygitalTokenInstruction,
	networkFeeLamports,
	parseClosePolicyInstruction,
	parseExecuteWithAccessoryInstruction,
	parseExecuteWithOwnerInstruction,
	parseRemoveOwnerInstruction,
	parseSetOwnerInstruction,
	parseSolTransfer,
	parseUpdatePolicyInstruction,
	PHYGITAL_TOKEN_PROGRAM_ADDRESS,
	PhygitalTokenInstruction,
	type CompactInstruction
} from 'phygital-token-sdk';

import { LIGHTHOUSE_PROGRAM_ADDRESS, SECP256R1_PROGRAM_ADDRESS } from '$lib/shared/addresses';
import { priorityFeeLamports as priorityFeeLamportsFor } from '$lib/shared/fee-policy';

const MEMO_PROGRAM_ADDRESS = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as Address;

export class SponsorError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details?: Record<string, unknown>
	) {
		super(message);
	}
}

/** Refuses the transaction. A function declaration, so TypeScript narrows after calls. */
function reject(message: string, code = 'not_sponsorable'): never {
	throw new SponsorError(400, code, message);
}

export type SponsorCaps = { maxComputeUnitLimit: number; maxComputeUnitPrice: bigint };

export type Inspected = {
	messageBytes: Uint8Array;
	signatures: SignaturesMap;
	feePayer: Address;
	blockhash: string;
	accessory: Address;
	/** The tap-payments account, when the main instruction is `update_policy`. */
	policy: Address | null;
	/** The pool key is `update_policy`'s payer: it funds the account's rent. */
	fundsPolicy: boolean;
	fee: bigint;
	refill: bigint;
};

type Main = {
	kind: PhygitalTokenInstruction;
	index: number;
	accessory: Address;
	wallet: Address | null;
	/** Who must have signed: the owner for owner actions, null when a tap authorises it. */
	owner: Address | null;
};

function remainingOf(ix: Instruction, named: number) {
	return (ix.accounts ?? []).slice(named);
}

/** Refill transfers inside an execute: wallet -> fee payer. Returns their total; rejects any other use of a pool key. */
function refillsIn(
	ix: Instruction,
	compact: readonly CompactInstruction[],
	named: number,
	wallet: Address,
	feePayer: Address,
	pool: ReadonlySet<Address>
): { total: bigint; only: boolean } {
	const remaining = remainingOf(ix, named);
	let total = 0n;
	let refills = 0;
	for (const inner of compact) {
		const program = remaining[inner.programIdIndex]?.address;
		const accounts = Array.from(inner.accountIndexes, (i) => remaining[i]);
		if (!program || !accounts.every((a): a is NonNullable<typeof a> => !!a))
			reject('Execute references a missing account');
		const touchesPool = accounts.some((a) => pool.has(a.address)) || pool.has(program);
		if (!touchesPool) continue;
		const transfer = parseSolTransfer({
			programAddress: program,
			accounts: accounts.map((a) => ({ address: a.address, role: a.role })),
			data: new Uint8Array(inner.data)
		});
		if (!transfer || transfer.from !== wallet || transfer.to !== feePayer)
			reject('A fee payer may only receive the refill');
		total += transfer.lamports;
		refills++;
	}
	return { total, only: refills === 1 && compact.length === 1 };
}

function parseMain(ix: Instruction, kind: PhygitalTokenInstruction): Main | null {
	const typed = ix as Parameters<typeof parseSetOwnerInstruction>[0];
	switch (kind) {
		case PhygitalTokenInstruction.SetOwner: {
			const { accounts } = parseSetOwnerInstruction(typed);
			return {
				kind,
				index: -1,
				accessory: accounts.phygitalToken.address,
				wallet: accounts.wallet.address,
				owner: null
			};
		}
		case PhygitalTokenInstruction.RemoveOwner: {
			const { accounts } = parseRemoveOwnerInstruction(typed);
			return {
				kind,
				index: -1,
				accessory: accounts.phygitalToken.address,
				wallet: accounts.wallet.address,
				owner: accounts.owner.address
			};
		}
		case PhygitalTokenInstruction.UpdatePolicy: {
			const { accounts } = parseUpdatePolicyInstruction(typed);
			return {
				kind,
				index: -1,
				accessory: accounts.phygitalToken.address,
				wallet: null,
				owner: accounts.owner.address
			};
		}
		case PhygitalTokenInstruction.ClosePolicy: {
			const { accounts } = parseClosePolicyInstruction(typed);
			return {
				kind,
				index: -1,
				accessory: accounts.phygitalToken.address,
				wallet: accounts.wallet.address,
				owner: accounts.owner.address
			};
		}
		case PhygitalTokenInstruction.ExecuteWithOwner: {
			const { accounts } = parseExecuteWithOwnerInstruction(typed);
			return {
				kind,
				index: -1,
				accessory: accounts.phygitalToken.address,
				wallet: accounts.wallet.address,
				owner: accounts.owner.address
			};
		}
		case PhygitalTokenInstruction.ExecuteWithAccessory: {
			const { accounts } = parseExecuteWithAccessoryInstruction(typed);
			return {
				kind,
				index: -1,
				accessory: accounts.phygitalToken.address,
				wallet: accounts.wallet.address,
				owner: null
			};
		}
		default:
			return null;
	}
}

function verifySignatures(messageBytes: Uint8Array, signatures: SignaturesMap) {
	const encoder = getAddressEncoder();
	for (const [signer, signature] of Object.entries(signatures)) {
		if (!signature) continue;
		if (
			!ed25519.verify(
				new Uint8Array(signature),
				messageBytes,
				new Uint8Array(encoder.encode(signer as Address))
			)
		) {
			reject('A signature on this transaction is invalid', 'invalid_signature');
		}
	}
}

export function inspectSponsored(
	wire: Uint8Array,
	pool: ReadonlySet<Address>,
	caps: SponsorCaps
): Inspected {
	let tx;
	let message;
	try {
		tx = getTransactionDecoder().decode(wire);
		const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
		if ('addressTableLookups' in compiled && (compiled.addressTableLookups?.length ?? 0) > 0) {
			return reject('Address lookup tables are not supported');
		}
		message = decompileTransactionMessage(compiled);
	} catch (err) {
		if (err instanceof SponsorError) throw err;
		return reject('Undecodable transaction', 'bad_request');
	}
	const messageBytes = new Uint8Array(tx.messageBytes);
	const feePayer = message.feePayer.address;
	if (!pool.has(feePayer)) reject('The fee payer is not one of ours', 'fee_payer_unknown');
	if (tx.signatures[feePayer]) reject('The fee payer has already signed', 'bad_request');
	if (!('blockhash' in message.lifetimeConstraint))
		reject('Only recent-blockhash transactions are sponsored');
	const blockhash = (message.lifetimeConstraint as { blockhash: string }).blockhash;

	// 1. Programs, and which phygital-token instruction is the action.
	let precompileSignatures = 0;
	const phygital: { ix: Instruction; kind: PhygitalTokenInstruction; index: number }[] = [];
	message.instructions.forEach((ix, index) => {
		const program = ix.programAddress;
		if (program === PHYGITAL_TOKEN_PROGRAM_ADDRESS) {
			let kind: PhygitalTokenInstruction;
			try {
				kind = identifyPhygitalTokenInstruction(new Uint8Array(ix.data ?? []));
			} catch {
				return reject('Unknown phygital-token instruction');
			}
			phygital.push({ ix, kind, index });
		} else if (program === SECP256R1_PROGRAM_ADDRESS) {
			precompileSignatures += ix.data?.[0] ?? 0;
		} else if (
			program !== COMPUTE_BUDGET_PROGRAM_ADDRESS &&
			program !== LIGHTHOUSE_PROGRAM_ADDRESS &&
			program !== MEMO_PROGRAM_ADDRESS
		) {
			reject(`Program ${program} is not sponsored`);
		}
	});

	// 2. Exactly one action, plus at most one refill-only execute_with_owner.
	const parsed = phygital.map((p) => {
		let main: Main | null;
		try {
			main = parseMain(p.ix, p.kind);
		} catch {
			return reject('Malformed phygital-token instruction');
		}
		if (!main) return reject('This phygital-token instruction is not sponsored');
		return { ...p, main: { ...main, index: p.index } };
	});
	let action = parsed[0];
	let refillIx: (typeof parsed)[number] | undefined;
	let refill = 0n;
	if (parsed.length === 2) {
		const isRefillOnly = (p: (typeof parsed)[number]) => {
			if (p.kind !== PhygitalTokenInstruction.ExecuteWithOwner || !p.main.wallet) return false;
			const { data } = parseExecuteWithOwnerInstruction(
				p.ix as Parameters<typeof parseExecuteWithOwnerInstruction>[0]
			);
			return refillsIn(
				p.ix,
				data.compactInstructions,
				EXECUTE_WITH_OWNER_NAMED_ACCOUNT_COUNT,
				p.main.wallet,
				feePayer,
				pool
			).only;
		};
		const [a, b] = parsed;
		[action, refillIx] = isRefillOnly(b)
			? [a, b]
			: isRefillOnly(a)
				? [b, a]
				: reject('Only one action per transaction is sponsored');
		if (action.main.accessory !== refillIx.main.accessory)
			reject('The refill is for a different accessory');
		const signer =
			action.main.owner ??
			(action.kind === PhygitalTokenInstruction.SetOwner
				? parseSetOwnerInstruction(action.ix as Parameters<typeof parseSetOwnerInstruction>[0])
						.accounts.recipient.address
				: null);
		if (refillIx.main.owner !== signer) reject('The refill must be signed by the owner');
		if (action.kind === PhygitalTokenInstruction.SetOwner && refillIx.index < action.index)
			reject('Refill after linking, once the owner is set');
		if (action.kind === PhygitalTokenInstruction.RemoveOwner && refillIx.index > action.index)
			reject('Refill before unlinking, while the owner is set');
		if (action.kind === PhygitalTokenInstruction.ExecuteWithAccessory)
			reject('Taps refill inside their own execute');
	} else if (parsed.length !== 1) {
		reject('Exactly one phygital-token action is sponsored');
	}
	const main = action.main;

	// 3. Pool keys: only the fee payer, only as policy payer or refill destination.
	let fundsPolicy = false;
	let policy: Address | null = null;
	message.instructions.forEach((ix, index) => {
		const isExecute =
			ix.programAddress === PHYGITAL_TOKEN_PROGRAM_ADDRESS &&
			(index === main.index || index === refillIx?.index);
		const kind =
			index === main.index ? action.kind : index === refillIx?.index ? refillIx.kind : null;
		(ix.accounts ?? []).forEach((meta, position) => {
			if (!pool.has(meta.address)) return;
			if (meta.address !== feePayer) reject('Only the fee payer may appear from our pool');
			if (kind === PhygitalTokenInstruction.UpdatePolicy && position === 1) {
				fundsPolicy = true;
				return;
			}
			const named =
				kind === PhygitalTokenInstruction.ExecuteWithOwner
					? EXECUTE_WITH_OWNER_NAMED_ACCOUNT_COUNT
					: kind === PhygitalTokenInstruction.ExecuteWithAccessory
						? EXECUTE_WITH_ACCESSORY_NAMED_ACCOUNT_COUNT
						: null;
			if (isExecute && named !== null && position >= named) return; // checked per inner instruction below
			reject('The fee payer may only pay fees, fund tap payments, or receive the refill');
		});
	});
	if (action.kind === PhygitalTokenInstruction.UpdatePolicy) {
		const { accounts } = parseUpdatePolicyInstruction(
			action.ix as Parameters<typeof parseUpdatePolicyInstruction>[0]
		);
		policy = accounts.policy.address;
		if (accounts.payer.address !== feePayer && fundsPolicy)
			reject('Only the fee payer may fund tap payments');
	}
	for (const p of [action, refillIx].filter((p): p is NonNullable<typeof p> => !!p)) {
		if (p.kind === PhygitalTokenInstruction.ExecuteWithOwner) {
			const { data } = parseExecuteWithOwnerInstruction(
				p.ix as Parameters<typeof parseExecuteWithOwnerInstruction>[0]
			);
			refill += refillsIn(
				p.ix,
				data.compactInstructions,
				EXECUTE_WITH_OWNER_NAMED_ACCOUNT_COUNT,
				p.main.wallet ?? reject('Execute is missing its wallet account'),
				feePayer,
				pool
			).total;
		} else if (p.kind === PhygitalTokenInstruction.ExecuteWithAccessory) {
			const { data } = parseExecuteWithAccessoryInstruction(
				p.ix as Parameters<typeof parseExecuteWithAccessoryInstruction>[0]
			);
			refill += refillsIn(
				p.ix,
				data.compactInstructions,
				EXECUTE_WITH_ACCESSORY_NAMED_ACCOUNT_COUNT,
				p.main.wallet ?? reject('Execute is missing its wallet account'),
				feePayer,
				pool
			).total;
		}
	}

	// 4. Fees within the caps.
	const limit = getTransactionMessageComputeUnitLimit(message);
	if (limit === undefined) reject('Set a compute unit limit', 'fee_caps');
	if (limit > caps.maxComputeUnitLimit)
		reject('Compute unit limit is above what we sponsor', 'fee_caps');
	let priorityFeeLamports: bigint;
	if (message.version === 1) {
		priorityFeeLamports = getTransactionMessagePriorityFeeLamports(message as never) ?? 0n;
		if (
			priorityFeeLamports >
			(caps.maxComputeUnitPrice * BigInt(caps.maxComputeUnitLimit)) / 1_000_000n
		) {
			reject('Priority fee is above what we sponsor', 'fee_caps');
		}
	} else {
		const price = getTransactionMessageComputeUnitPrice(message as never) ?? 0n;
		if (price > caps.maxComputeUnitPrice)
			reject('Priority fee is above what we sponsor', 'fee_caps');
		priorityFeeLamports = priorityFeeLamportsFor(price, limit);
	}
	const fee = networkFeeLamports({
		signatures: Object.keys(tx.signatures).length,
		precompileSignatures,
		priorityFeeLamports
	});

	// 5. Every signature present must be valid. Missing ones (the owner's) are fine:
	// the transaction can't land without them, and its reserved fee is released when the blockhash expires.
	verifySignatures(messageBytes, tx.signatures);

	return {
		messageBytes,
		signatures: tx.signatures,
		feePayer,
		blockhash,
		accessory: main.accessory,
		policy,
		fundsPolicy,
		fee,
		refill
	};
}
