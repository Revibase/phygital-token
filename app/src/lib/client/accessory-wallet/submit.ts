/**
 * Every owner transaction (link, unlink, send, sweep, tap payments) goes
 * through `submitAsOwner`, which picks who pays the network fee
 * (`$lib/shared/fee-payer`): the owner's wallet when it can, otherwise a
 * Revibase fee payer drawing on the accessory's prepaid fees, refilled from
 * the accessory wallet in the same transaction when they run low.
 */
import {
	address,
	appendTransactionMessageInstructions,
	compileTransaction,
	createNoopSigner,
	createTransactionMessage,
	getBase58Decoder,
	getBase64EncodedWireTransaction,
	getTransactionDecoder,
	getTransactionEncoder,
	pipe,
	setTransactionMessageConfig,
	setTransactionMessageFeePayer,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
	type Address,
	type Blockhash,
	type Instruction,
	type TransactionSigner
} from '@solana/kit';
import {
	createSponsorFeePayer,
	fetchSponsor,
	findPolicyPda,
	findWalletPda,
	networkFeeLamports,
	pickFeePayer,
	type SponsorInfo
} from 'phygital-token-sdk';

import {
	choosePayer,
	previewFeeSource,
	type FeeSource,
	type PayerInput
} from '$lib/shared/fee-payer';
import {
	LINK_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
	priorityFeeLamports,
	v1MessageConfig
} from '$lib/shared/link-transaction';
import { assertTransactionIntact } from '$lib/shared/wallet-transaction';
import { buildRefillInstruction } from '$lib/shared/wallet-instructions';
import { TransactionComputeLimitError, v1TransactionFits } from '$lib/shared/transaction-v1-size';
import { browserRpc } from '../rpc';
import { waitForConfirmation } from '../tx';
import { queryClient, queryKeys, refreshAccessory } from '../cache';
import {
	canSignOnly,
	signWithWallet,
	walletSigner,
	type SigningContext
} from '../wallet/wallet.svelte';

export const SPONSOR_ENDPOINT = '/api/sponsor';
const COMPUTE_UNIT_PRICE = LINK_COMPUTE_UNIT_PRICE_MICROLAMPORTS;
/** What the refill's own execute adds when it rides along. */
const REFILL_COMPUTE_UNITS = 40_000;
const MAX_COMPUTE_UNITS = 1_400_000;
/** A typical owner transaction, for the fee line shown before the exact one is built. */
const TYPICAL_COMPUTE_UNITS = 200_000;

export type OwnerAction = {
	pda: string;
	/**
	 * The action's instructions. `payer` funds any tap-payments rent (it is
	 * whoever pays this fee); `refill` is what this transaction moves out of the
	 * accessory wallet besides, so a sweep can leave it behind.
	 */
	build: (
		owner: TransactionSigner,
		payer: TransactionSigner,
		refill: bigint
	) => Promise<Instruction[]>;
	/** Unlink refills first, while the owner is still set. */
	refillFirst?: boolean;
	/** A fixed compute budget (the link) instead of simulating. */
	computeUnits?: number;
	/** secp256r1 signatures the transaction verifies (the link's tap). */
	precompileSignatures?: number;
	/** The action may grow the tap-payments account: its rent is part of the cost. */
	growsPolicy?: boolean;
	/** Checks what the wallet returns before anyone else signs; defaults to `assertTransactionIntact`. */
	verify?: (
		signedBytes: Uint8Array,
		built: { expected: Instruction[]; feePayer: Address; refill: Instruction | null }
	) => void;
	/** Where this fee is coming from, once decided. */
	onFeeSource?: (source: FeeSource) => void;
	/** Refill the prepaid fees back to full through a Revibase fee payer (taps can't, under their limits). */
	refillNow?: boolean;
	/** NFT proofs and rules can change between builds; re-simulate the final instructions before signing. */
	simulateFinal?: boolean;
	/** Sends the remaining accessory SOL after reserving the refill. */
	drainsWallet?: boolean;
};

const lamportsOf = async (account: Address) =>
	BigInt((await browserRpc().getBalance(account, { commitment: 'confirmed' }).send()).value);

function computeLimit(units: number, withRefill: boolean): number {
	return Math.min(
		MAX_COMPUTE_UNITS,
		Math.ceil(((units + (withRefill ? REFILL_COMPUTE_UNITS : 0)) * 12) / 10)
	);
}

function feeFor(signatures: number, limit: number, precompileSignatures = 0): bigint {
	return networkFeeLamports({
		signatures,
		precompileSignatures,
		priorityFeeLamports: priorityFeeLamports(COMPUTE_UNIT_PRICE, limit)
	});
}

function message(
	feePayer: TransactionSigner | Address,
	blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint },
	limit: number,
	instructions: Instruction[]
) {
	return pipe(
		createTransactionMessage({ version: 1 }),
		(m) =>
			typeof feePayer === 'string'
				? setTransactionMessageFeePayer(feePayer, m)
				: setTransactionMessageFeePayerSigner(feePayer, m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
		(m) => setTransactionMessageConfig(v1MessageConfig(limit), m),
		(m) => appendTransactionMessageInstructions(instructions, m)
	);
}

/** Compute used, and how much the tap-payments account grows (its rent), by simulating as `feePayer`. */
async function measure(
	feePayer: Address,
	instructions: Instruction[],
	blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint },
	policy: Address | null,
	limit = MAX_COMPUTE_UNITS,
	balanceAccount?: Address
): Promise<{ units: number; rent: bigint; balance?: bigint }> {
	if (!v1TransactionFits(feePayer, instructions))
		throw new Error('This transaction exceeds the v1 size or account limits.');
	const rpc = browserRpc();
	const wire = getBase64EncodedWireTransaction(
		compileTransaction(message(feePayer, blockhash, limit, instructions))
	);
	const [before, { value }] = await Promise.all([
		policy ? lamportsOf(policy) : Promise.resolve(0n),
		rpc
			.simulateTransaction(wire, {
				encoding: 'base64',
				sigVerify: false,
				replaceRecentBlockhash: true,
				commitment: 'confirmed',
				...(policy || balanceAccount
					? {
							accounts: {
								encoding: 'base64' as const,
								addresses: [policy, balanceAccount].filter((a): a is Address => !!a)
							}
						}
					: {})
			})
			.send()
	]);
	if (value.err) {
		const detail = JSON.stringify(value.err);
		if (detail.includes('ComputationalBudgetExceeded'))
			throw new TransactionComputeLimitError('This batch exceeds the transaction compute limit.');
		throw new Error(`This would fail on the network: ${value.logs?.at(-1) ?? detail}`);
	}
	const accounts = (
		value as { accounts?: readonly ({ lamports: bigint | number } | null)[] | null }
	).accounts;
	const after = policy ? BigInt(accounts?.[0]?.lamports ?? 0) : 0n;
	const balance = balanceAccount ? accounts?.[policy ? 1 : 0]?.lamports : undefined;
	if (balanceAccount && balance == null)
		throw new Error('Couldn’t determine the SOL balance after transfers.');
	return {
		units: Number(value.unitsConsumed ?? TYPICAL_COMPUTE_UNITS),
		rent: after > before ? after - before : 0n,
		...(balance != null ? { balance: BigInt(balance) } : {})
	};
}

/** Simulations replace the blockhash, so any well-formed one will do. */
const SIMULATION_BLOCKHASH = {
	blockhash: '11111111111111111111111111111111' as Blockhash,
	lastValidBlockHeight: 0n
};

/** Simulate asset transfers first so the final SOL amount includes exact rent refunds and account costs. */
export async function walletBalanceAfterInstructions(
	feePayer: Address,
	wallet: Address,
	instructions: Instruction[]
): Promise<bigint> {
	if (!instructions.length) return lamportsOf(wallet);
	return (
		await measure(feePayer, instructions, SIMULATION_BLOCKHASH, null, MAX_COMPUTE_UNITS, wallet)
	).balance!;
}

async function payerInput(
	ctx: SigningContext,
	pda: Address,
	sponsor: SponsorInfo | null,
	costs: { owner: bigint; sponsored: bigint },
	knownOwnerLamports?: bigint
): Promise<PayerInput> {
	const [wallet] = await findWalletPda({ phygitalToken: pda });
	const [ownerLamports, walletLamports] = await Promise.all([
		knownOwnerLamports ?? lamportsOf(address(ctx.address)),
		lamportsOf(wallet)
	]);
	return {
		ownerLamports,
		ownerCost: costs.owner,
		sponsoredCost: costs.sponsored,
		signOnly: canSignOnly(ctx),
		prepaid: sponsor?.prepaid ?? null,
		wallet,
		walletLamports
	};
}

/** The fee service's view of this accessory (pool keys, prepaid fees), shared by every fee preview and submission. */
export const sponsorQuery = (pda: string) => ({
	queryKey: queryKeys.sponsor(pda),
	queryFn: () => fetchSponsor({ endpoint: SPONSOR_ENDPOINT, phygitalToken: address(pda) }),
	staleTime: 15_000
});
const sponsorFor = (pda: Address) => queryClient.fetchQuery(sponsorQuery(pda)).catch(() => null);

/** The fee line before approving: a typical transaction's cost against current balances. */
export async function previewFee(
	ctx: SigningContext,
	pda: string,
	rent = 0n,
	drainsWallet = false
): Promise<FeeSource> {
	const sponsor = await sponsorFor(address(pda));
	const limit = computeLimit(TYPICAL_COMPUTE_UNITS, false);
	const input = await payerInput(ctx, address(pda), sponsor, {
		owner: feeFor(1, limit) + rent,
		sponsored: feeFor(2, limit) + rent
	});
	return previewFeeSource({ ...input, owner: address(ctx.address), drainsWallet });
}

/** Moves the accessory's prepaid network fees back to full, from its wallet, and waits for it to land. */
export function refillNetworkFees(ctx: SigningContext, pda: string): Promise<string> {
	return confirmAsOwner(ctx, { pda, refillNow: true, computeUnits: 0, build: async () => [] });
}

/** `submitAsOwner`, then waits for the transaction to land and marks the accessory's cached state stale. */
export async function confirmAsOwner(ctx: SigningContext, action: OwnerAction): Promise<string> {
	const sig = await submitAsOwner(ctx, action);
	await waitForConfirmation(sig);
	refreshAccessory(action.pda);
	return sig;
}

/** Builds, has the wallet (and when needed the fee payer) sign, and sends. Returns the signature. */
export async function submitAsOwner(ctx: SigningContext, action: OwnerAction): Promise<string> {
	const rpc = browserRpc();
	const owner = address(ctx.address);
	const pda = address(action.pda);
	const [sponsor, ownerLamports, { value: blockhash }, [policy]] = await Promise.all([
		sponsorFor(pda),
		lamportsOf(owner),
		rpc.getLatestBlockhash({ commitment: 'confirmed' }).send(),
		findPolicyPda({ phygitalToken: pda })
	]);

	// Simulate as whoever can afford to: the owner, else a pool key (funded).
	const simulateAs = ownerLamports >= 10_000_000n || !sponsor ? owner : sponsor.feePayers[0]!;
	const measured =
		action.computeUnits === undefined
			? await action.build(createNoopSigner(owner), createNoopSigner(simulateAs), 0n)
			: null;
	const { units, rent } = measured
		? await measure(simulateAs, measured, blockhash, action.growsPolicy ? policy : null)
		: { units: action.computeUnits!, rent: 0n };
	const ownerLimit = computeLimit(units, false);
	const sponsoredLimit = computeLimit(units, true);
	const choice = choosePayer({
		...(await payerInput(
			ctx,
			pda,
			sponsor,
			{
				owner: feeFor(1, ownerLimit, action.precompileSignatures) + rent,
				sponsored: feeFor(2, sponsoredLimit, action.precompileSignatures) + rent
			},
			ownerLamports
		)),
		drainsWallet: action.drainsWallet,
		refillNow: action.refillNow
	});
	const verify =
		action.verify ??
		((bytes, built) => assertTransactionIntact(bytes, built.expected, owner, built.feePayer));

	if (choice.kind === 'owner') {
		action.onFeeSource?.({ kind: 'owner' });
		// Already built as the owner for measuring: sign those same instructions rather than building again.
		const noop = createNoopSigner(owner);
		const expected =
			measured && simulateAs === owner ? measured : await action.build(noop, noop, 0n);
		if (action.simulateFinal) await measure(owner, expected, blockhash, null, ownerLimit);
		const wire = new Uint8Array(
			getTransactionEncoder().encode(
				compileTransaction(message(owner, blockhash, ownerLimit, expected))
			)
		);
		const outcome = await signWithWallet(ctx, wire);
		if (outcome.kind === 'sent') return getBase58Decoder().decode(outcome.signature);
		verify(outcome.signedBytes, { expected, feePayer: owner, refill: null });
		return rpc
			.sendTransaction(
				getBase64EncodedWireTransaction(getTransactionDecoder().decode(outcome.signedBytes)),
				{ encoding: 'base64', preflightCommitment: 'confirmed' }
			)
			.send();
	}

	action.onFeeSource?.(
		choice.refill > 0n ? { kind: 'refill', lamports: choice.refill } : { kind: 'free' }
	);
	const feePayer = createSponsorFeePayer(pickFeePayer(sponsor!.feePayers), {
		endpoint: SPONSOR_ENDPOINT
	});
	const built: { expected: Instruction[]; feePayer: Address; refill: Instruction | null } = {
		expected: [],
		feePayer: feePayer.address,
		refill: null
	};
	const signer = walletSigner(ctx, (bytes) => verify(bytes, built));
	const instructions = await action.build(signer, feePayer, choice.refill);
	built.refill =
		choice.refill > 0n
			? await buildRefillInstruction(signer, pda, feePayer.address, choice.refill)
			: null;
	built.expected = built.refill
		? action.refillFirst
			? [built.refill, ...instructions]
			: [...instructions, built.refill]
		: instructions;
	if (action.simulateFinal)
		await measure(feePayer.address, built.expected, blockhash, null, sponsoredLimit);
	const signed = await signTransactionMessageWithSigners(
		message(feePayer, blockhash, sponsoredLimit, built.expected)
	);
	return rpc
		.sendTransaction(getBase64EncodedWireTransaction(signed), {
			encoding: 'base64',
			preflightCommitment: 'confirmed'
		})
		.send();
}
