import {
	address,
	getBase58Decoder,
	getBase64EncodedWireTransaction,
	getTransactionDecoder,
	type Address
} from '@solana/kit';

import { queryKeys, queryClient } from '../cache';
import { browserRpc } from '../rpc';
import { waitForConfirmation } from '../tx';
import { walletSetupFor } from './passkey-cost';
import { signWithWallet, type SigningContext } from './wallet.svelte';
import {
	assertTransferIntact,
	buildTransferTransaction,
	recipientTokenAccount,
	TransferRejected,
	transferCost,
	transferProblem,
	type SendAsset,
	type TransferCost,
	type TransferRequest
} from '#lib/shared/wallet-transfer.ts';
import type { WalletHoldings } from '#lib/shared/wallet-holdings.ts';

export type TransferPlan = {
	request: TransferRequest;
	cost: TransferCost;
	/** Why it can't be sent, in the user's words. */
	problem: string | null;
};

/** Look up the recipient (and a passkey wallet's one-time setup), then price the transfer. */
export async function planTransfer(
	ctx: SigningContext,
	holdings: WalletHoldings,
	asset: SendAsset,
	recipient: Address,
	amount: bigint
): Promise<TransferPlan> {
	const rpc = browserRpc();
	const [recipientLamports, openAccount, setup] = await Promise.all([
		rpc
			.getBalance(recipient, { commitment: 'confirmed' })
			.send()
			.then(({ value }) => BigInt(value)),
		asset.kind === 'token'
			? recipientTokenAccount(recipient, asset.token).then(
					async (ata) =>
						!(await rpc.getAccountInfo(ata, { encoding: 'base64', commitment: 'confirmed' }).send())
							.value
				)
			: Promise.resolve(false),
		ctx.passkey ? walletSetupFor(ctx.address) : Promise.resolve(0n)
	]);
	const request = { owner: address(ctx.address), asset, recipient, amount, openAccount };
	return {
		request,
		cost: transferCost(request, ctx.passkey, setup),
		problem: transferProblem(request, holdings, ctx.passkey, recipientLamports, setup)
	};
}

/**
 * Sign with the connected wallet and send. Revibase Passkey sends through its
 * fee payer (the signature comes back already submitted); an ordinary wallet's
 * signed copy is checked before it is broadcast.
 */
export async function sendTransfer(ctx: SigningContext, plan: TransferPlan): Promise<string> {
	if (plan.problem) throw new TransferRejected(plan.problem);
	const rpc = browserRpc();
	const blockhash = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
	const { instructions, wireBytes } = await buildTransferTransaction(
		plan.request,
		address(ctx.feePayer),
		blockhash
	);
	const outcome = await signWithWallet(ctx, wireBytes);
	let signature: string;
	if (outcome.kind === 'signed') {
		assertTransferIntact(outcome.signedBytes, instructions, plan.request.owner);
		const signed = getTransactionDecoder().decode(outcome.signedBytes);
		signature = await rpc
			.sendTransaction(getBase64EncodedWireTransaction(signed), {
				encoding: 'base64',
				preflightCommitment: 'confirmed'
			})
			.send();
	} else {
		signature = getBase58Decoder().decode(outcome.signature);
	}
	await waitForConfirmation(signature);
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: queryKeys.walletHoldings(ctx.address) }),
		queryClient.invalidateQueries({ queryKey: queryKeys.walletSetup(ctx.address) })
	]);
	return signature;
}
