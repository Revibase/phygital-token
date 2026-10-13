/**
 * Sends from the connected wallet's own address (the passkey wallet page).
 * Unlike an accessory action, the wallet pays its own network fee, as it
 * would in Phantom or Solflare: Revibase's fee service only pays for
 * accessory actions.
 */
import {
	address,
	compileTransaction,
	getBase58Decoder,
	getBase64EncodedWireTransaction,
	getTransactionDecoder,
	getTransactionEncoder,
	type Address,
	type Blockhash,
	type Instruction
} from '@solana/kit';
import { topUpNeeded } from 'phygital-token-sdk';

import { OwnerWalletNeedsSol } from '$lib/shared/fee-payer';
import {
	fetchWalletHoldings,
	isProgrammableNft,
	type WalletHoldings
} from '$lib/shared/wallet-holdings';
import {
	buildTokenSweepInstructions,
	buildTransferInstructions,
	type SendAsset
} from '$lib/shared/wallet-instructions';
import { assertTransactionIntact } from '$lib/shared/wallet-transaction';
import { packByV1Size, v1TransactionFits } from '$lib/shared/transaction-v1-size';
import { browserRpc, rpcUrl } from '../rpc';
import { waitForConfirmation } from '../tx';
import { queryClient, queryKeys } from '../cache';
import { signWithWallet, type SigningContext } from '../wallet/wallet.svelte';
import {
	computeLimit,
	feeFor,
	lamportsOf,
	measure,
	message,
	MAX_COMPUTE_UNITS,
	TYPICAL_COMPUTE_UNITS,
	walletBalanceAfterInstructions
} from '../accessory-wallet/submit';
import { recipientAccountFunding, sendInBatches, sweepTargets } from '../accessory-wallet/send';

export function fetchPasskeyWallet(wallet: string): Promise<WalletHoldings> {
	return fetchWalletHoldings(browserRpc(), address(wallet), rpcUrl());
}

/** A typical transfer's network fee, for the line shown before the exact one is built. */
export const typicalNetworkFee = (): bigint =>
	feeFor(1, computeLimit(TYPICAL_COMPUTE_UNITS, false));

/** The most one transaction's fee can be: what simulating it at the full compute limit charges. */
export const MAX_NETWORK_FEE = feeFor(1, MAX_COMPUTE_UNITS);

/** What the wallet can't afford, as the simulation reports it. */
const SHORT_OF_SOL = /InsufficientFundsFor(Fee|Rent)|AccountNotFound/;

type WalletSend = {
	/** The instructions, given the network fee this transaction pays. */
	build: (fee: bigint) => Promise<Instruction[]>;
	/** Build again once the exact fee is known: the transaction sends everything the fee leaves. */
	exactFee?: boolean;
	/** Lamports spent besides the fee (amount, rent), so "add SOL" names enough. */
	spends?: bigint;
};

async function simulate(
	wallet: Address,
	instructions: Instruction[],
	blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint },
	limit: number,
	short: () => Error
) {
	try {
		return await measure(wallet, instructions, blockhash, null, limit);
	} catch (err) {
		if (err instanceof Error && SHORT_OF_SOL.test(err.message)) throw short();
		throw err;
	}
}

/** Builds, has the wallet sign as its own fee payer, sends and waits for it to land. */
async function confirmFromWallet(ctx: SigningContext, send: WalletSend): Promise<string> {
	const rpc = browserRpc();
	const wallet = address(ctx.address);
	const [balance, { value: blockhash }] = await Promise.all([
		lamportsOf(wallet),
		rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
	]);
	const short = () =>
		new OwnerWalletNeedsSol(topUpNeeded(balance, MAX_NETWORK_FEE + (send.spends ?? 0n)));
	if (balance < MAX_NETWORK_FEE + (send.spends ?? 0n)) throw short();

	// Measured at the full limit, so the simulation charges the most this fee can be.
	const measured = await send.build(MAX_NETWORK_FEE);
	const { units } = await simulate(wallet, measured, blockhash, MAX_COMPUTE_UNITS, short);
	const limit = computeLimit(units, false);
	const expected = send.exactFee ? await send.build(feeFor(1, limit)) : measured;
	if (send.exactFee) await simulate(wallet, expected, blockhash, limit, short);

	const wire = new Uint8Array(
		getTransactionEncoder().encode(compileTransaction(message(wallet, blockhash, limit, expected)))
	);
	const outcome = await signWithWallet(ctx, wire);
	let signature: string;
	if (outcome.kind === 'sent') signature = getBase58Decoder().decode(outcome.signature);
	else {
		assertTransactionIntact(outcome.signedBytes, expected, wallet, wallet);
		signature = await rpc
			.sendTransaction(
				getBase64EncodedWireTransaction(getTransactionDecoder().decode(outcome.signedBytes)),
				{ encoding: 'base64', preflightCommitment: 'confirmed' }
			)
			.send();
	}
	await waitForConfirmation(signature);
	void queryClient.invalidateQueries({ queryKey: queryKeys.passkeyWallet(wallet) });
	return signature;
}

/** One asset to `recipient`. `sendAll` sends every lamport the fee leaves. */
export async function sendFromPasskeyWallet(
	ctx: SigningContext,
	input: { asset: SendAsset; recipient: string; amount: bigint; sendAll?: boolean }
): Promise<string> {
	const wallet = address(ctx.address);
	const recipient = address(input.recipient);
	const { openAccount, rent } = await recipientAccountFunding(recipient, input.asset);
	const sendAll = input.asset.kind === 'sol' && !!input.sendAll;
	const balance = sendAll ? await lamportsOf(wallet) : 0n;
	return confirmFromWallet(ctx, {
		exactFee: sendAll,
		spends: rent + (input.asset.kind === 'sol' && !sendAll ? input.amount : 0n),
		build: (fee) => {
			if (sendAll && balance <= fee) throw new OwnerWalletNeedsSol(topUpNeeded(balance, fee));
			return buildTransferInstructions({
				wallet,
				asset: input.asset,
				recipient,
				amount: sendAll ? balance - fee : input.amount,
				openAccount,
				rpc: browserRpc(),
				dasUrl: rpcUrl()
			});
		}
	});
}

/** The wallet's SOL once `instructions` run, before the fee of the transaction carrying them. */
async function balanceAfter(wallet: Address, instructions: Instruction[]): Promise<bigint> {
	if (!instructions.length) return lamportsOf(wallet);
	try {
		// The wallet pays the simulation's fee too (at the full compute limit): add it back.
		return (await walletBalanceAfterInstructions(wallet, wallet, instructions)) + MAX_NETWORK_FEE;
	} catch (err) {
		if (err instanceof Error && SHORT_OF_SOL.test(err.message))
			throw new OwnerWalletNeedsSol(topUpNeeded(await lamportsOf(wallet), MAX_NETWORK_FEE));
		throw err;
	}
}

type Entry = { asset: SendAsset; inner: Instruction[] };

async function planSendAll(
	wallet: Address,
	recipient: Address,
	holdings: WalletHoldings,
	sendSol: boolean
) {
	if (recipient === wallet) throw new Error('That’s this wallet itself.');
	const targets = await sweepTargets(recipient, holdings);
	const build = (asset: SendAsset): Promise<Instruction[]> =>
		asset.kind === 'token' && !isProgrammableNft(asset.token)
			? buildTokenSweepInstructions(wallet, recipient, [asset.token], targets.missing)
			: buildTransferInstructions({
					wallet,
					asset,
					recipient,
					amount: 1n,
					openAccount: targets.opensAccount(asset),
					rpc: browserRpc(),
					dasUrl: rpcUrl()
				});
	const entries: Entry[] = await Promise.all(
		[
			...targets.tokens.map((token) => ({ kind: 'token', token }) as const),
			...targets.collectibles
		].map(async (asset) => ({ asset, inner: await build(asset) }))
	);
	if (sendSol && (holdings.lamports > 0n || targets.tokens.length > 0))
		entries.push({
			asset: { kind: 'sol' },
			inner: await buildTransferInstructions({
				wallet,
				asset: { kind: 'sol' },
				recipient,
				amount: 1n
			})
		});
	const batches = await packByV1Size(entries, async (batch) =>
		v1TransactionFits(
			wallet,
			batch.flatMap((entry) => entry.inner)
		)
	);
	return { batches, build };
}

/** Uses the same instructions and v1 wire-size planner as the send itself. */
export async function estimateSendAllApprovals(
	wallet: string,
	recipient: string,
	holdings: WalletHoldings,
	sendSol = true
): Promise<number> {
	return (await planSendAll(address(wallet), address(recipient), holdings, sendSol)).batches.length;
}

/**
 * Everything selected in `holdings` to `recipient`, in as few approvals as fit.
 * SOL goes last: whatever the final batch's fee leaves, after token accounts
 * close and return their rent.
 */
export async function sendAllFromPasskeyWallet(
	ctx: SigningContext,
	recipient: string,
	holdings: WalletHoldings,
	onProgress?: (done: number, total: number) => void,
	{ sendSol = true }: { sendSol?: boolean } = {}
): Promise<void> {
	const wallet = address(ctx.address);
	const to = address(recipient);
	const plan = await planSendAll(wallet, to, holdings, sendSol);
	await sendInBatches(
		plan.batches,
		async (batch) => {
			// Rebuilt per batch: NFT proofs and rules can change while earlier batches wait for approval.
			const assets = (
				await Promise.all(
					batch
						.filter((entry) => entry.asset.kind !== 'sol')
						.map((entry) => plan.build(entry.asset))
				)
			).flat();
			if (!batch.some((entry) => entry.asset.kind === 'sol')) {
				await confirmFromWallet(ctx, { build: async () => assets });
				return;
			}
			const before = await balanceAfter(wallet, assets);
			await confirmFromWallet(ctx, {
				exactFee: true,
				build: async (fee) =>
					before > fee
						? [
								...assets,
								...(await buildTransferInstructions({
									wallet,
									asset: { kind: 'sol' },
									recipient: to,
									amount: before - fee
								}))
							]
						: assets
			});
		},
		onProgress
	);
}
