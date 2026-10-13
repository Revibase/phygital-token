import {
	createNoopSigner,
	type Address,
	type Instruction,
	type TransactionSigner,
	type Rpc,
	type SolanaRpcApi
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
	findAssociatedTokenPda,
	getCloseAccountInstruction,
	getCreateAssociatedTokenIdempotentInstruction,
	getTransferCheckedInstruction
} from '@solana-program/token';
import {
	canSpendLamports,
	buildExecuteWithOwnerInstruction,
	findPolicyPda,
	findWalletPda,
	getClosePolicyInstruction,
	getRefillInstruction,
	getUpdatePolicyInstructionAsync,
	type PolicyActionArgs
} from 'phygital-token-sdk';

import {
	isCollectible,
	isProgrammableNft,
	transferRestriction,
	type TokenHolding,
	type WalletHoldings
} from './wallet-holdings';

import type { NftHolding } from './nft-assets';
import {
	buildProgrammableTransfer,
	buildCoreTransfer,
	buildCompressedTransfer
} from './nft-transfers';

export type SendAsset =
	{ kind: 'sol' } | { kind: 'token'; token: TokenHolding } | { kind: 'nft'; nft: NftHolding };

export function sendAssetRestriction(asset: SendAsset): string | null {
	return asset.kind === 'token'
		? transferRestriction(asset.token)
		: asset.kind === 'nft' && asset.nft.frozen
			? 'This NFT is frozen or non-transferable.'
			: null;
}
export function collectibleAssets(holdings: WalletHoldings): SendAsset[] {
	return [
		...holdings.tokens.filter(isCollectible).map((token) => ({ kind: 'token' as const, token })),
		...(holdings.nfts ?? []).map((nft) => ({ kind: 'nft' as const, nft }))
	];
}

/** A token account's rent, which the sending wallet pays when it opens one (165-byte SPL account). */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;

export const recipientTokenAccount = async (recipient: Address, token: TokenHolding) =>
	(
		await findAssociatedTokenPda({
			owner: recipient,
			mint: token.mint,
			tokenProgram: token.tokenProgram
		})
	)[0];

/**
 * A token transfer out of `wallet`, opening the recipient's account first
 * when it doesn't exist yet: the wallet pays that rent.
 */
async function tokenTransfer(
	wallet: Address,
	token: TokenHolding,
	recipient: Address,
	amount: bigint,
	openAccount: boolean
) {
	if (isProgrammableNft(token))
		throw new Error('Programmable NFTs require a Token Metadata transfer.');
	const restriction = transferRestriction(token);
	if (restriction) throw new Error(restriction);
	if (isCollectible(token) && amount !== 1n) throw new Error('Send exactly one NFT.');
	const destination = await recipientTokenAccount(recipient, token);
	const open = getCreateAssociatedTokenIdempotentInstruction({
		payer: createNoopSigner(wallet),
		ata: destination,
		owner: recipient,
		mint: token.mint,
		tokenProgram: token.tokenProgram
	});
	const transfer = getTransferCheckedInstruction(
		{
			source: token.tokenAccount,
			mint: token.mint,
			destination,
			authority: wallet,
			amount,
			decimals: token.decimals
		},
		{ programAddress: token.tokenProgram }
	);
	return openAccount ? [open, transfer] : [transfer];
}

/** Exact sends keep their amount; sending the full balance reserves the same transaction's fee refill. */
export function solSendAmount(
	balance: bigint,
	requested: bigint,
	refill: bigint,
	sendAll = false
): bigint {
	if (requested <= 0n || refill < 0n) throw new Error('Enter an amount greater than zero.');
	const amount = sendAll ? balance - refill : requested;
	if (amount <= 0n || !canSpendLamports(balance, amount + refill)) {
		throw new Error(
			'Not enough SOL for this amount and the required network-fee top-up. Reduce the amount or send all.'
		);
	}
	return amount;
}

type TransferInput = {
	asset: SendAsset;
	recipient: Address;
	amount: bigint;
	/** The recipient has no account for this token yet. */
	openAccount?: boolean;
	rpc?: Rpc<SolanaRpcApi>;
	dasUrl?: string;
};

/** Network fees are paid by whoever `choosePayer` picks; a new recipient token account by the accessory wallet. */
export async function buildSendInnerInstructions(
	input: TransferInput & { owner: TransactionSigner; pda: Address }
): Promise<Instruction[]> {
	const [wallet] = await findWalletPda({ phygitalToken: input.pda });
	if (input.recipient === wallet) throw new Error('That’s the accessory wallet itself.');
	return buildTransferInstructions({ ...input, wallet });
}

/**
 * `asset` out of `wallet`, which signs as its authority: the accessory wallet
 * inside an execute, or the passkey wallet sending its own. `wallet` pays any
 * new recipient token account.
 */
export async function buildTransferInstructions(
	input: TransferInput & { wallet: Address }
): Promise<Instruction[]> {
	const { wallet } = input;
	if (input.recipient === wallet) throw new Error('That’s this wallet itself.');
	const restriction = sendAssetRestriction(input.asset);
	if (restriction) throw new Error(restriction);
	let inner: Instruction[];
	if (input.asset.kind === 'sol')
		inner = [
			getTransferSolInstruction({
				source: createNoopSigner(wallet),
				destination: input.recipient,
				amount: input.amount
			})
		];
	else if (input.asset.kind === 'nft' || isProgrammableNft(input.asset.token)) {
		if (input.amount !== 1n) throw new Error('Send exactly one NFT.');
		if (!input.rpc) throw new Error('RPC is required for NFT transfers.');
		if (input.asset.kind === 'token')
			inner = await buildProgrammableTransfer(
				input.rpc,
				wallet,
				input.asset.token,
				input.recipient,
				input.openAccount ?? false
			);
		else if (input.asset.nft.kind === 'core')
			inner = await buildCoreTransfer(input.rpc, wallet, input.asset.nft, input.recipient);
		else {
			if (!input.dasUrl) throw new Error('DAS RPC is required for compressed NFT transfers.');
			inner = await buildCompressedTransfer(
				input.rpc,
				input.dasUrl,
				wallet,
				input.asset.nft,
				input.recipient
			);
		}
	} else
		inner = await tokenTransfer(
			wallet,
			input.asset.token,
			input.recipient,
			input.amount,
			input.openAccount ?? false
		);
	return inner;
}

export async function buildSendInstructions(
	input: Parameters<typeof buildSendInnerInstructions>[0]
): Promise<Instruction[]> {
	return [
		await buildExecuteWithOwnerInstruction({
			owner: input.owner,
			phygitalToken: input.pda,
			instructions: await buildSendInnerInstructions(input)
		})
	];
}

/** Existing owner accounts first: their returned rent helps fund later account openings. */
export function sweepTokenOrder(
	holdings: WalletHoldings,
	missing: ReadonlySet<Address> = new Set()
): TokenHolding[] {
	return holdings.tokens
		.filter((t) => !transferRestriction(t) && !isProgrammableNft(t))
		.sort((a, b) => Number(missing.has(a.mint)) - Number(missing.has(b.mint)));
}

/** One batch: open the owner's account if missing, transfer, close back into the accessory wallet. */
export function buildSweepTokenInner(
	owner: TransactionSigner,
	_pda: Address,
	wallet: Address,
	tokens: readonly TokenHolding[],
	missing: ReadonlySet<Address> = new Set()
): Promise<Instruction[]> {
	return buildTokenSweepInstructions(wallet, owner.address, tokens, missing);
}

/** Every unit of each token from `wallet` to `recipient` (opening their account when `missing`), then closes it back into `wallet`. */
export async function buildTokenSweepInstructions(
	wallet: Address,
	recipient: Address,
	tokens: readonly TokenHolding[],
	missing: ReadonlySet<Address> = new Set()
): Promise<Instruction[]> {
	const inner: Instruction[] = [];
	for (const token of tokens) {
		inner.push(
			...(await tokenTransfer(wallet, token, recipient, token.amount, missing.has(token.mint))),
			getCloseAccountInstruction(
				{ account: token.tokenAccount, destination: wallet, owner: wallet },
				{ programAddress: token.tokenProgram }
			)
		);
	}
	return inner;
}

/** Tap-payments rent is paid by `payer` (whoever pays this transaction's fee); closing returns it to the accessory wallet. */
export async function buildPolicyInstruction(
	owner: TransactionSigner,
	pda: Address,
	change: PolicyActionArgs[] | 'close',
	payer: TransactionSigner = owner
): Promise<Instruction> {
	if (change === 'close') {
		const [[policy], [wallet]] = await Promise.all([
			findPolicyPda({ phygitalToken: pda }),
			findWalletPda({ phygitalToken: pda })
		]);
		return getClosePolicyInstruction({ owner, phygitalToken: pda, policy, wallet });
	}
	return getUpdatePolicyInstructionAsync({ owner, payer, phygitalToken: pda, actions: change });
}

/** Refills the accessory's prepaid network fees: accessory wallet -> the Revibase fee payer. */
export async function buildRefillInstruction(
	owner: TransactionSigner,
	pda: Address,
	feePayer: Address,
	lamports: bigint
): Promise<Instruction> {
	const [wallet] = await findWalletPda({ phygitalToken: pda });
	return buildExecuteWithOwnerInstruction({
		owner,
		phygitalToken: pda,
		instructions: [getRefillInstruction(wallet, feePayer, lamports)]
	});
}
