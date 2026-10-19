/**
 * Plain SOL and token transfers from the connected wallet, for any wallet.
 *
 * The one difference between wallets is who signs as fee payer. An ordinary
 * wallet pays its own fee. Revibase Passkey's vault is a PDA and can't, so the
 * Revibase fee payer signs last and its wallet adapter adds a transfer paying
 * it back the exact fee (plus the wallet's rent on its first transaction): the
 * wallet still bears every cost. The maths here is the same either way.
 */
import {
	appendTransactionMessageInstructions,
	compileTransaction,
	createNoopSigner,
	createTransactionMessage,
	getTransactionEncoder,
	pipe,
	setTransactionMessageConfig,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	type Address,
	type Blockhash,
	type Instruction
} from '@solana/kit';
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from '@solana-program/compute-budget';
import { getTransferSolInstruction } from '@solana-program/system';
import {
	findAssociatedTokenPda,
	getCreateAssociatedTokenIdempotentInstruction,
	getTransferCheckedInstruction
} from '@solana-program/token';

import { LIGHTHOUSE_PROGRAM_ADDRESS } from './addresses';
import { formatCompactTokenAmount, SOL_DECIMALS } from './amount';
import { bytesEqual } from './encoding';
import { decodeMessage } from './passkey-transaction';
import { networkFeeLamports, TRANSFER_TX_CONFIG, transferSignatureCount } from './wallet-fee';
import type { TokenHolding, WalletHoldings } from './wallet-holdings';

export type SendAsset = { kind: 'sol' } | { kind: 'token'; token: TokenHolding };

/** Rent for a 165-byte token account, which the sender pays when it opens the recipient's. */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;
/** The least an empty system account may hold: a balance between 0 and this can't exist. */
export const SYSTEM_ACCOUNT_RENT_LAMPORTS = 890_880n;

export class TransferRejected extends Error {
	constructor(readonly reason: string) {
		super(reason);
		this.name = 'TransferRejected';
	}
}

export type TransferRequest = {
	owner: Address;
	asset: SendAsset;
	recipient: Address;
	amount: bigint;
	/** The recipient has no account for this token yet, so the sender opens it. */
	openAccount: boolean;
};

export const recipientTokenAccount = async (recipient: Address, token: TokenHolding) =>
	(
		await findAssociatedTokenPda({
			owner: recipient,
			mint: token.mint,
			tokenProgram: token.tokenProgram
		})
	)[0];

export const transferFeeLamports = (passkey: boolean) =>
	networkFeeLamports(transferSignatureCount(passkey), TRANSFER_TX_CONFIG);

/** The transfer itself, opening the recipient's token account first when needed (the sender pays). */
export async function transferInstructions(request: TransferRequest): Promise<Instruction[]> {
	const { owner, asset, recipient, amount } = request;
	if (asset.kind === 'sol')
		return [
			getTransferSolInstruction({ source: createNoopSigner(owner), destination: recipient, amount })
		];
	const { token } = asset;
	const destination = await recipientTokenAccount(recipient, token);
	const transfer = getTransferCheckedInstruction(
		{
			source: token.tokenAccount,
			mint: token.mint,
			destination,
			authority: createNoopSigner(owner),
			amount,
			decimals: token.decimals
		},
		{ programAddress: token.tokenProgram }
	);
	if (!request.openAccount) return [transfer];
	const open = getCreateAssociatedTokenIdempotentInstruction({
		payer: createNoopSigner(owner),
		ata: destination,
		owner: recipient,
		mint: token.mint,
		tokenProgram: token.tokenProgram
	});
	return [open, transfer];
}

/** `feePayer`: the wallet itself, or for Revibase Passkey the fee payer that relays it. */
export async function buildTransferTransaction(
	request: TransferRequest,
	feePayer: Address,
	blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint }
) {
	const instructions = await transferInstructions(request);
	const message = pipe(
		createTransactionMessage({ version: 1 }),
		(m) => setTransactionMessageFeePayer(feePayer, m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
		(m) => setTransactionMessageConfig(TRANSFER_TX_CONFIG, m),
		(m) => appendTransactionMessageInstructions(instructions, m)
	);
	const wireBytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
	return { instructions, wireBytes };
}

export type TransferCost = {
	fee: bigint;
	/** Rent for the recipient's new token account, when one is opened. */
	accountRent: bigint;
	/** Revibase Passkey's one-time wallet setup, on its first transaction. */
	setup: bigint;
	/** All the SOL that leaves the wallet. */
	solOut: bigint;
};

export function transferCost(request: TransferRequest, passkey: boolean, setup = 0n): TransferCost {
	const fee = transferFeeLamports(passkey);
	const accountRent = request.openAccount ? TOKEN_ACCOUNT_RENT_LAMPORTS : 0n;
	const sent = request.asset.kind === 'sol' ? request.amount : 0n;
	return { fee, accountRent, setup, solOut: sent + fee + accountRent + setup };
}

/**
 * The SOL that may stay behind. A wallet that pays its own fee must stay open
 * (rent-exempt); a passkey vault may be emptied completely.
 */
const minimumLeft = (passkey: boolean) => (passkey ? 0n : SYSTEM_ACCOUNT_RENT_LAMPORTS);

/** The most of `asset` that can be sent, after the fee and any account it opens. */
export function maxSendable(
	holdings: WalletHoldings,
	asset: SendAsset,
	passkey: boolean,
	openAccount: boolean,
	setup = 0n
): bigint {
	if (asset.kind === 'token') return asset.token.amount;
	const reserved =
		transferFeeLamports(passkey) +
		(openAccount ? TOKEN_ACCOUNT_RENT_LAMPORTS : 0n) +
		setup +
		minimumLeft(passkey);
	return holdings.lamports > reserved ? holdings.lamports - reserved : 0n;
}

/** True when the wallet can't even cover a network fee: the UI asks for a little SOL. */
export const needsSolForFees = (holdings: WalletHoldings, passkey: boolean, setup = 0n) =>
	holdings.lamports < transferFeeLamports(passkey) + setup + minimumLeft(passkey);

const sol = (lamports: bigint) => `${formatCompactTokenAmount(lamports, SOL_DECIMALS)} SOL`;

/**
 * Why this transfer can't go through, in the user's words, or null.
 * `recipientLamports` is the recipient's SOL balance (0 for a new address).
 */
export function transferProblem(
	request: TransferRequest,
	holdings: WalletHoldings,
	passkey: boolean,
	recipientLamports: bigint,
	setup = 0n
): string | null {
	const { asset, amount, recipient, owner } = request;
	if (recipient === owner) return 'That’s this wallet’s own address.';
	if (amount <= 0n) return 'Enter an amount.';
	if (asset.kind === 'token') {
		if (asset.token.frozen) return 'This token is frozen and can’t be sent.';
		if (amount > asset.token.amount) return 'That’s more than this wallet holds.';
	}
	const { solOut } = transferCost(request, passkey, setup);
	const left = holdings.lamports - solOut;
	if (left < 0n) {
		return asset.kind === 'sol'
			? 'Not enough SOL for this amount and the network fee.'
			: `Add a little SOL to cover the network fee${request.openAccount ? ' and the recipient’s token account' : ''}${setup ? ' and the one-time wallet setup' : ''}.`;
	}
	// Only a passkey vault may be emptied; otherwise what stays must keep the account open.
	if (left < SYSTEM_ACCOUNT_RENT_LAMPORTS && !(left === 0n && minimumLeft(passkey) === 0n))
		return `Leave at least ${sol(SYSTEM_ACCOUNT_RENT_LAMPORTS)} in the wallet, or send the max.`;
	if (asset.kind === 'sol' && recipientLamports === 0n && amount < SYSTEM_ACCOUNT_RENT_LAMPORTS)
		return `A new address needs at least ${sol(SYSTEM_ACCOUNT_RENT_LAMPORTS)}.`;
	return null;
}

const sameCall = (a: Instruction, b: Instruction) =>
	a.programAddress === b.programAddress &&
	(a.accounts ?? []).length === (b.accounts ?? []).length &&
	(a.accounts ?? []).every((meta, i) => meta.address === b.accounts?.[i]?.address) &&
	bytesEqual(new Uint8Array(a.data ?? []), new Uint8Array(b.data ?? []));

/**
 * What an ordinary wallet returns must do exactly what was asked: it may add
 * compute-budget and Lighthouse guard instructions, and nothing may add a
 * signer. (Revibase Passkey never returns the transaction: its fee payer checks
 * and submits it.)
 */
export function assertTransferIntact(
	signedBytes: Uint8Array,
	expected: readonly Instruction[],
	owner: Address
): void {
	let calls: readonly Instruction[];
	try {
		const message = decodeMessage(signedBytes);
		if (message.feePayer !== owner) throw new TransferRejected('unexpected fee payer');
		if (message.signers.length !== 1) throw new TransferRejected('unexpected additional signer');
		calls = message.instructions;
	} catch (err) {
		if (err instanceof TransferRejected) throw err;
		throw new TransferRejected('undecodable transaction');
	}
	const added = (ix: Instruction) =>
		ix.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS ||
		ix.programAddress === LIGHTHOUSE_PROGRAM_ADDRESS;
	const ours = calls.filter((ix) => !added(ix));
	if (ours.length !== expected.length || !ours.every((ix, i) => sameCall(ix, expected[i])))
		throw new TransferRejected('the wallet changed the transfer');
}
