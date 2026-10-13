import { describe, expect, it } from 'vitest';
import { address } from '@solana/kit';
import { AccessoryWalletTopUpRequired } from 'phygital-token-sdk';

import {
	choosePayer,
	OwnerWalletNeedsSol,
	previewFeeSource,
	type PayerInput
} from '$lib/shared/fee-payer';

const WALLET = address('So11111111111111111111111111111111111111112');
const OWNER = address('SysvarC1ock11111111111111111111111111111111');

const input = (over: Partial<PayerInput> = {}): PayerInput => ({
	ownerLamports: 0n,
	ownerCost: 20_000n,
	sponsoredCost: 25_000n,
	signOnly: true,
	prepaid: { balanceLamports: 5_000_000n, prepaidLamports: 5_000_000n },
	wallet: WALLET,
	walletLamports: 0n,
	...over
});

describe('who pays the network fee', () => {
	it('the owner, whenever its wallet can afford it and stay rent-exempt', () => {
		expect(choosePayer(input({ ownerLamports: 1_000_000_000n }))).toEqual({ kind: 'owner' });
		expect(choosePayer(input({ ownerLamports: 20_000n }))).toEqual({ kind: 'owner' });
		expect(choosePayer(input({ ownerLamports: 100_000n }))).toEqual({ kind: 'free', refill: 0n });
	});

	it('otherwise the prepaid fees, refilled back to full from the accessory wallet when low', () => {
		expect(choosePayer(input())).toEqual({ kind: 'free', refill: 0n });
		const low = input({
			prepaid: { balanceLamports: 30_000n, prepaidLamports: 5_000_000n },
			walletLamports: 1_000_000_000n
		});
		expect(choosePayer(low)).toEqual({ kind: 'free', refill: 5_000_000n - 30_000n + 25_000n });
	});

	it('allows a full SOL send to drain the remainder after a refill without leaving rent dust', () => {
		const low = input({
			prepaid: { balanceLamports: 0n, prepaidLamports: 5_000_000n },
			walletLamports: 5_025_001n
		});
		expect(() => choosePayer(low)).toThrow(AccessoryWalletTopUpRequired);
		expect(choosePayer({ ...low, drainsWallet: true })).toEqual({
			kind: 'free',
			refill: 5_025_000n
		});
		expect(() => choosePayer({ ...low, walletLamports: 5_024_999n, drainsWallet: true })).toThrow(
			AccessoryWalletTopUpRequired
		);
	});

	it('asks for SOL in the accessory wallet when it can’t refill', () => {
		const low = input({
			prepaid: { balanceLamports: 0n, prepaidLamports: 5_000_000n },
			walletLamports: 1_000n
		});
		expect(() => choosePayer(low)).toThrow(AccessoryWalletTopUpRequired);
		expect(previewFeeSource({ ...low, owner: OWNER })).toMatchObject({
			kind: 'blocked',
			reason: 'accessory',
			address: WALLET
		});
	});

	it('asks for SOL in the owner wallet when the wallet can’t sign without sending, or the fee service is down', () => {
		expect(() => choosePayer(input({ signOnly: false }))).toThrow(OwnerWalletNeedsSol);
		expect(previewFeeSource({ ...input({ prepaid: null }), owner: OWNER })).toMatchObject({
			kind: 'blocked',
			reason: 'owner',
			address: OWNER
		});
	});

	it('refills on request through the fee payer, even when the owner could pay', () => {
		const now = input({
			ownerLamports: 1_000_000_000n,
			refillNow: true,
			prepaid: { balanceLamports: 1_000n, prepaidLamports: 5_000_000n },
			walletLamports: 1_000_000_000n
		});
		expect(choosePayer(now)).toEqual({ kind: 'free', refill: 5_000_000n - 1_000n + 25_000n });
	});

	it('previews the line shown before approving', () => {
		expect(previewFeeSource({ ...input({ ownerLamports: 1_000_000_000n }), owner: OWNER })).toEqual(
			{ kind: 'owner' }
		);
		expect(previewFeeSource({ ...input(), owner: OWNER })).toEqual({ kind: 'free' });
		const low = input({
			prepaid: { balanceLamports: 0n, prepaidLamports: 5_000_000n },
			walletLamports: 1_000_000_000n
		});
		expect(previewFeeSource({ ...low, owner: OWNER })).toEqual({
			kind: 'refill',
			lamports: 5_025_000n
		});
	});
});
