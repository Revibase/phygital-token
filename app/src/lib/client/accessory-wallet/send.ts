import {
	address,
	createNoopSigner,
	getAddressDecoder,
	type Instruction,
	type Address
} from '@solana/kit';

import { findWalletPda, buildExecuteWithOwnerInstruction } from 'phygital-token-sdk';

import { isProgrammableNft, type WalletHoldings } from '$lib/shared/wallet-holdings';
import {
	solSendAmount,
	buildSendInstructions,
	buildSweepTokenInner,
	buildSendInnerInstructions,
	buildRefillInstruction,
	recipientTokenAccount,
	sweepTokenOrder,
	collectibleAssets,
	sendAssetRestriction,
	TOKEN_ACCOUNT_RENT_LAMPORTS,
	type SendAsset
} from '$lib/shared/wallet-instructions';
import {
	packByV1Size,
	v1TransactionFits,
	TransactionComputeLimitError
} from '$lib/shared/transaction-v1-size';
import { programmableRecordRent } from '$lib/shared/nft-transfers';
import { browserRpc, rpcUrl } from '../rpc';
import type { SigningContext } from '../wallet/wallet.svelte';
import { confirmAsOwner, walletBalanceAfterInstructions, type OwnerAction } from './submit';

/** Accounts among `candidates` that don't exist yet. */
async function missingAccounts(candidates: Address[]): Promise<Set<Address>> {
	if (candidates.length === 0) return new Set();
	const { value } = await browserRpc()
		.getMultipleAccounts(candidates, { encoding: 'base64', commitment: 'confirmed' })
		.send();
	return new Set(candidates.filter((_, i) => !value[i]));
}

/** Whether sending this token to `recipient` opens a new token account (paid by the accessory wallet). */
export async function opensTokenAccount(recipient: string, asset: SendAsset): Promise<boolean> {
	if (asset.kind !== 'token') return false;
	const ata = await recipientTokenAccount(address(recipient), asset.token);
	return (await missingAccounts([ata])).has(ata);
}

export async function recipientAccountFunding(
	recipient: string,
	asset: SendAsset
): Promise<{ openAccount: boolean; rent: bigint }> {
	const openAccount = await opensTokenAccount(recipient, asset);
	const recordRent =
		asset.kind === 'token' && isProgrammableNft(asset.token)
			? await programmableRecordRent(browserRpc(), asset.token, address(recipient))
			: 0n;
	return { openAccount, rent: (openAccount ? TOKEN_ACCOUNT_RENT_LAMPORTS : 0n) + recordRent };
}

export async function sendFromAccessoryWallet(
	ctx: SigningContext,
	input: { pda: string; asset: SendAsset; recipient: string; amount: bigint; sendAll?: boolean },
	onFeeSource?: OwnerAction['onFeeSource']
) {
	const openAccount = await opensTokenAccount(input.recipient, input.asset);
	const balance =
		input.asset.kind === 'sol'
			? BigInt(
					(
						await browserRpc()
							.getBalance((await findWalletPda({ phygitalToken: address(input.pda) }))[0], {
								commitment: 'confirmed'
							})
							.send()
					).value
				)
			: 0n;
	return confirmAsOwner(ctx, {
		pda: input.pda,
		drainsWallet: input.asset.kind === 'sol' && (input.sendAll ?? input.amount === balance),
		onFeeSource,
		simulateFinal: true,
		build: (owner, _payer, refill) =>
			buildSendInstructions({
				owner,
				pda: address(input.pda),
				asset: input.asset,
				recipient: address(input.recipient),
				amount:
					input.asset.kind === 'sol'
						? solSendAmount(
								balance,
								input.amount,
								refill,
								input.sendAll ?? input.amount === balance
							)
						: input.amount,
				openAccount,
				rpc: browserRpc(),
				dasUrl: rpcUrl()
			})
	});
}

type SweepEntry = { asset: SendAsset; inner: Instruction[] };

/** A transfer only this asset makes, so whether it opens the owner's token account can't change during the sweep. */
const collectibleKey = (asset: SendAsset) =>
	asset.kind === 'nft' ? asset.nft.id : asset.kind === 'token' ? asset.token.tokenAccount : 'sol';

/**
 * What a send-all moves to `recipient`, and which of their token accounts it
 * opens: sendable tokens (transferred whole, then closed), then collectibles
 * that need their own transfer (NFTs and programmable NFTs).
 */
export async function sweepTargets(recipient: Address, holdings: WalletHoldings) {
	const tokens = sweepTokenOrder(holdings);
	const collectibles = collectibleAssets(holdings).filter(
		(a) =>
			!sendAssetRestriction(a) &&
			(a.kind === 'nft' || (a.kind === 'token' && isProgrammableNft(a.token)))
	);
	// One lookup for every recipient token account the sweep might open.
	const [tokenAtas, collectibleAtas] = await Promise.all([
		Promise.all(tokens.map((t) => recipientTokenAccount(recipient, t))),
		Promise.all(
			collectibles.map((a) =>
				a.kind === 'token' ? recipientTokenAccount(recipient, a.token) : Promise.resolve(null)
			)
		)
	]);
	const missingAtas = await missingAccounts([
		...tokenAtas,
		...collectibleAtas.filter((a): a is Address => !!a)
	]);
	const missing = new Set(
		tokens.filter((_, i) => missingAtas.has(tokenAtas[i])).map((t) => t.mint)
	);
	const opensAccount = new Set(
		collectibles
			.filter((_, i) => collectibleAtas[i] && missingAtas.has(collectibleAtas[i]))
			.map(collectibleKey)
	);
	return {
		/** Existing recipient accounts first: their returned rent helps fund later account openings. */
		tokens: sweepTokenOrder(holdings, missing),
		collectibles,
		missing,
		opensAccount: (asset: SendAsset) => opensAccount.has(collectibleKey(asset))
	};
}

/**
 * Sends each batch in order. A batch simulation finds over the compute limit
 * (raised before any signature) is split in two and retried.
 */
export async function sendInBatches<T>(
	batches: readonly T[][],
	send: (batch: T[]) => Promise<void>,
	onProgress?: (done: number, total: number) => void
): Promise<void> {
	let total = batches.length;
	let done = 0;
	async function sendBatch(batch: T[]): Promise<void> {
		try {
			await send(batch);
		} catch (error) {
			if (!(error instanceof TransactionComputeLimitError) || batch.length < 2) throw error;
			total++;
			const middle = Math.ceil(batch.length / 2);
			await sendBatch(batch.slice(0, middle));
			await sendBatch(batch.slice(middle));
			return;
		}
		onProgress?.(++done, total);
	}
	for (const batch of batches) await sendBatch(batch);
	onProgress?.(total, total);
}

async function prepareSweep(
	ownerAddress: Address,
	pda: string,
	holdings: WalletHoldings,
	sendSol: boolean
) {
	const owner = createNoopSigner(ownerAddress);
	const { tokens, collectibles, missing, opensAccount } = await sweepTargets(
		ownerAddress,
		holdings
	);

	const entries: SweepEntry[] = await Promise.all([
		...tokens.map(async (token) => ({
			asset: { kind: 'token', token } as SendAsset,
			inner: await buildSweepTokenInner(owner, address(pda), holdings.wallet, [token], missing)
		})),
		...collectibles.map(async (asset) => ({
			asset,
			inner: await buildSendInnerInstructions({
				owner,
				pda: address(pda),
				asset,
				recipient: ownerAddress,
				amount: 1n,
				openAccount: opensAccount(asset),
				rpc: browserRpc(),
				dasUrl: rpcUrl()
			})
		}))
	]);
	const includeSol = sendSol && (holdings.lamports > 0n || tokens.length > 0);
	if (includeSol)
		entries.push({
			asset: { kind: 'sol' },
			inner: await buildSendInnerInstructions({
				owner,
				pda: address(pda),
				asset: { kind: 'sol' },
				recipient: ownerAddress,
				amount: 1n
			})
		});
	// Reserve the larger sponsored envelope: two signatures plus a possible refill.
	let feePayer = getAddressDecoder().decode(new Uint8Array(32).fill(255));
	if (feePayer === ownerAddress)
		feePayer = getAddressDecoder().decode(new Uint8Array(32).fill(254));
	const refill = await buildRefillInstruction(owner, address(pda), feePayer, 1n);
	const batches = await packByV1Size(entries, async (batch) => {
		const execute = await buildExecuteWithOwnerInstruction({
			owner,
			phygitalToken: address(pda),
			instructions: batch.flatMap((entry) => entry.inner)
		});
		return v1TransactionFits(feePayer, [execute, refill]);
	});
	return { batches, missing, opensAccount };
}

/** Uses the same built instructions and v1 wire-size planner as the actual sweep. */
export async function estimateSweepApprovals(
	owner: string,
	pda: string,
	holdings: WalletHoldings,
	sendSol = true
): Promise<number> {
	const plan = await prepareSweep(address(owner), pda, holdings, sendSol);
	return plan.batches.length;
}

export async function sweepToOwner(
	ctx: SigningContext,
	pda: string,
	holdings: WalletHoldings,
	onProgress?: (done: number, total: number) => void,
	{ sendSol = true }: { sendSol?: boolean } = {}
) {
	const plan = await prepareSweep(address(ctx.address), pda, holdings, sendSol);
	await sendInBatches(
		plan.batches,
		(batch) =>
			confirmAsOwner(ctx, {
				pda,
				drainsWallet: batch.some((entry) => entry.asset.kind === 'sol'),
				simulateFinal: true,
				// Rebuilt per batch: NFT proofs and rules can change while earlier batches wait for approval.
				build: async (owner, payer, refill) => {
					const assets = batch
						.filter((entry) => entry.asset.kind !== 'sol')
						.map((entry) => entry.asset);
					const inner = (
						await Promise.all(
							assets.map((asset) =>
								asset.kind === 'token' && !isProgrammableNft(asset.token)
									? buildSweepTokenInner(
											owner,
											address(pda),
											holdings.wallet,
											[asset.token],
											plan.missing
										)
									: buildSendInnerInstructions({
											owner,
											pda: address(pda),
											asset,
											recipient: owner.address,
											amount: 1n,
											openAccount: plan.opensAccount(asset),
											rpc: browserRpc(),
											dasUrl: rpcUrl()
										})
							)
						)
					).flat();
					// SOL goes last, sized from the wallet balance after everything else in this batch.
					if (batch.some((entry) => entry.asset.kind === 'sol')) {
						const transfers = inner.length
							? [
									await buildExecuteWithOwnerInstruction({
										owner,
										phygitalToken: address(pda),
										instructions: inner
									})
								]
							: [];
						const balance = await walletBalanceAfterInstructions(
							payer.address,
							holdings.wallet,
							transfers
						);
						inner.push(
							...(await buildSendInnerInstructions({
								owner,
								pda: address(pda),
								asset: { kind: 'sol' },
								recipient: owner.address,
								amount: solSendAmount(balance, balance, refill, true)
							}))
						);
					}
					const execute = await buildExecuteWithOwnerInstruction({
						owner,
						phygitalToken: address(pda),
						instructions: inner
					});
					const envelope =
						refill > 0n
							? [execute, await buildRefillInstruction(owner, address(pda), payer.address, refill)]
							: [execute];
					if (!v1TransactionFits(payer.address, envelope))
						throw new Error('Transfer data changed and no longer fits. Refresh and try again.');
					return [execute];
				}
			}).then(() => {}),
		onProgress
	);
}
