/**
 * What the Revibase fee payer will sign for the Revibase Passkey wallet.
 *
 * The vault is a PDA, so someone else must pay its fees. Nothing is
 * sponsored: the fee payer signs only a passkey `execute` that pays it back in
 * the same transaction, exactly the fee plus, on the wallet's first
 * transaction, the rent it fronts for `create_wallet`. What the vault does
 * otherwise is the user's business (they pay for it); the route's simulation
 * then requires the fee payer to break even exactly.
 *
 * The key is only ever the fee payer, `create_wallet`'s rent payer, and the
 * destination of one System transfer from the vault. It can't be spent inside
 * `execute`: an intent may mark only the vault as a signer.
 */
import { AccountRole, type Address, type Instruction } from '@solana/kit';
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from '@solana-program/compute-budget';
import {
	getTransferSolInstructionDataDecoder,
	SYSTEM_PROGRAM_ADDRESS,
	TRANSFER_SOL_DISCRIMINATOR
} from '@solana-program/system';
import { getCreateWalletInstructionDataDecoder } from 'revibase-wallet-sdk';

import { bytesEqual } from '#lib/shared/encoding.ts';
import {
	decodeMessage,
	PasskeyTransactionRejected,
	unwrapPasskeyTransaction
} from '#lib/shared/passkey-transaction.ts';
import { messageFeeLamports } from '#lib/shared/wallet-fee.ts';

/** Generous: an execute plus a first-time create_wallet stays well under this. */
export const MAX_RELAYED_CU_LIMIT = 400_000;
/** The user pays it, but a dapp shouldn't be able to make a wallet overpay wildly. */
export const MAX_RELAYED_PRIORITY_FEE_LAMPORTS = 10_000n;

export type RelayContext = {
	feePayer: Address;
	/** SHA-256 of the secure signer's RP ID: wallets are only created for it. */
	signerRpIdHash: Uint8Array;
};

export type RelayDecision =
	| {
			ok: true;
			messageBytes: Uint8Array;
			/** The network fee the fee payer is charged. */
			fee: bigint;
			/** What the vault pays the fee payer back. */
			payment: bigint;
			/** The wallet config this transaction creates, if any (its rent is the rest of `payment`). */
			createdWallet: Address | null;
	  }
	| { ok: false; reason: string };

class Refused extends Error {}

const refuse = (reason: string): never => {
	throw new Refused(reason);
};

function isTransferToFeePayer(ix: Instruction, vault: Address, feePayer: Address): bigint | null {
	if (ix.programAddress !== SYSTEM_PROGRAM_ADDRESS) return null;
	const data = new Uint8Array(ix.data ?? []);
	if (data.length !== 12) return null;
	if (new DataView(data.buffer, data.byteOffset).getUint32(0, true) !== TRANSFER_SOL_DISCRIMINATOR)
		return null;
	const [from, to] = ix.accounts ?? [];
	if (from?.address !== vault || to?.address !== feePayer) return null;
	return getTransferSolInstructionDataDecoder().decode(data).amount;
}

export async function inspectRelayedTransaction(
	wireBytes: Uint8Array,
	ctx: RelayContext
): Promise<RelayDecision> {
	try {
		const message = decodeMessage(wireBytes);
		if (message.feePayer !== ctx.feePayer) refuse('not paid by this fee payer');
		if (message.signers.length !== 1) refuse('unexpected additional signer');
		if (message.version !== 1) refuse('only version 1 transactions are relayed');
		if (message.instructions.some((ix) => ix.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS))
			refuse('unexpected compute budget instruction');
		const { computeUnitLimit, priorityFeeLamports } = message.config;
		if ((computeUnitLimit ?? 0) > MAX_RELAYED_CU_LIMIT) refuse('compute limit too high');
		if ((priorityFeeLamports ?? 0n) > MAX_RELAYED_PRIORITY_FEE_LAMPORTS)
			refuse('priority fee too high');

		// [create_wallet?, secp256r1+, execute], with only the vault signing inside execute.
		const unwrapped = await unwrapPasskeyTransaction(message);
		const create = unwrapped.createWallet;
		if (create) {
			const payer = create.accounts?.[0];
			if (payer?.address !== ctx.feePayer || payer.role !== AccountRole.WRITABLE_SIGNER)
				refuse('unexpected rent payer');
			const args = getCreateWalletInstructionDataDecoder().decode(
				new Uint8Array(create.data ?? [])
			);
			if (!bytesEqual(new Uint8Array(args.rpIdHash), ctx.signerRpIdHash))
				refuse('passkey is for a different signer');
		}

		// Exactly one payment from the vault to the fee payer, and no other use of it.
		let payment: bigint | null = null;
		for (const call of unwrapped.instructions) {
			const paid = isTransferToFeePayer(call, unwrapped.vault, ctx.feePayer);
			if (paid !== null) {
				if (payment !== null) refuse('the fee payer must be paid back once');
				payment = paid;
			} else if ((call.accounts ?? []).some((meta) => meta.address === ctx.feePayer)) {
				refuse('fee payer used as an account');
			}
		}
		if (payment === null) refuse('the fee payer must be paid back');

		// Top level: only as fee payer, create_wallet's payer, and inside execute's account list.
		const execute = message.instructions[message.instructions.length - 1];
		message.instructions.forEach((ix) => {
			if (ix === execute || ix === create) return;
			if ((ix.accounts ?? []).some((meta) => meta.address === ctx.feePayer))
				refuse('fee payer used as an account');
		});
		(create?.accounts ?? []).slice(1).forEach((meta) => {
			if (meta.address === ctx.feePayer) refuse('fee payer used as an account');
		});

		return {
			ok: true,
			messageBytes: message.messageBytes,
			fee: messageFeeLamports(message),
			payment: payment!,
			createdWallet: create ? unwrapped.wallet : null
		};
	} catch (err) {
		if (err instanceof Refused) return { ok: false, reason: err.message };
		if (err instanceof PasskeyTransactionRejected) return { ok: false, reason: err.reason };
		throw err;
	}
}

/**
 * Does the simulated transaction leave the fee payer exactly even? The vault
 * must pay back the fee plus the rent `create_wallet` really took (`rent`, read
 * from the new wallet's simulated balance). Simulation charges the fee payer
 * its fee (checked on a 4.3 validator), so its own simulated change must then
 * be exactly 0.
 */
export function breaksEven(input: {
	payment: bigint;
	fee: bigint;
	rent: bigint;
	feePayerChange: bigint;
}): boolean {
	const { payment, fee, rent, feePayerChange } = input;
	return payment === fee + rent && feePayerChange === 0n;
}
