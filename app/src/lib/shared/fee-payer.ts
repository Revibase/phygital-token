/**
 * Who pays a transaction's network fee, in order:
 * 1. the owner's wallet, when it can afford it (one signer fewer, so cheaper);
 * 2. otherwise the accessory's prepaid fees, through a Revibase fee payer;
 * 3. when those run low, the same transaction refills them from the accessory wallet;
 * 4. if the accessory wallet can't, the user is asked to add SOL to it.
 */
import { AccessoryWalletTopUpRequired, canSpendLamports, planFee, topUpNeeded } from 'phygital-token-sdk';
import type { Address } from '@solana/kit';

/** The owner's wallet can't pay, and the prepaid route needs a wallet that signs without sending. */
export class OwnerWalletNeedsSol extends Error {
	constructor(readonly neededLamports: bigint) {
		super('Add SOL to your wallet to pay the network fee.');
		this.name = 'OwnerWalletNeedsSol';
	}
}

export type PayerChoice = { kind: 'owner' } | { kind: 'free'; refill: bigint };

export type PayerInput = {
	ownerLamports: bigint;
	/** Fee (plus any tap-payments rent) when the owner pays. */
	ownerCost: bigint;
	/** Fee (plus any rent) when a Revibase fee payer pays: one more signature. */
	sponsoredCost: bigint;
	/** Whether the wallet can sign without sending (the fee payer signs after it). */
	signOnly: boolean;
	/** The accessory's prepaid fees; null when the fee service is unreachable. */
	prepaid: { balanceLamports: bigint; prepaidLamports: bigint } | null;
	wallet: Address;
	walletLamports: bigint;
	/** Refill the prepaid fees now, through a Revibase fee payer, even if the owner could pay. */
	refillNow?: boolean;
	/** The same transaction sends the remainder, leaving the accessory wallet at exactly zero. */
	drainsWallet?: boolean;
};

export function choosePayer(input: PayerInput): PayerChoice {
	if (!input.refillNow && canSpendLamports(input.ownerLamports, input.ownerCost)) return { kind: 'owner' };
	if (!input.signOnly || !input.prepaid) throw new OwnerWalletNeedsSol(topUpNeeded(input.ownerLamports, input.ownerCost));
	const { balanceLamports: balance, prepaidLamports: prepaid } = input.prepaid;
	const refill = input.refillNow
		? (prepaid > balance ? prepaid - balance : 0n) + input.sponsoredCost
		: planFee({ balance, prepaid, cost: input.sponsoredCost }).refill;
	if (refill > 0n && !canSpendLamports(input.walletLamports, refill) && !(input.drainsWallet && input.walletLamports > refill)) {
		throw new AccessoryWalletTopUpRequired(input.wallet, topUpNeeded(input.walletLamports, refill));
	}
	return { kind: 'free', refill };
}

export type FeeSource = { kind: 'owner' } | { kind: 'free' } | { kind: 'refill'; lamports: bigint } | { kind: 'blocked'; reason: 'owner' | 'accessory'; neededLamports: bigint; address: Address };

/** The line shown before approving; the real choice is made with the exact cost when the user approves. */
export function previewFeeSource(input: PayerInput & { owner: Address }): FeeSource {
	try {
		const choice = choosePayer(input);
		if (choice.kind === 'owner') return { kind: 'owner' };
		return choice.refill > 0n ? { kind: 'refill', lamports: choice.refill } : { kind: 'free' };
	} catch (err) {
		if (err instanceof AccessoryWalletTopUpRequired) return { kind: 'blocked', reason: 'accessory', neededLamports: err.neededLamports, address: err.wallet };
		if (err instanceof OwnerWalletNeedsSol) return { kind: 'blocked', reason: 'owner', neededLamports: err.neededLamports, address: input.owner };
		throw err;
	}
}
