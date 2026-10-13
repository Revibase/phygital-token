/** Illustrative NFT instructions for the isolated preview, which has no real NFT accounts/proofs. */
import {
	AccountRole,
	address,
	createNoopSigner,
	getAddressDecoder,
	type Instruction
} from '@solana/kit';
import { buildExecuteWithOwnerInstruction } from 'phygital-token-sdk';
import {
	buildRefillInstruction,
	buildSendInnerInstructions,
	buildSweepTokenInner,
	collectibleAssets,
	sendAssetRestriction,
	sweepTokenOrder
} from '../../src/lib/shared/wallet-instructions';
import { isProgrammableNft, type WalletHoldings } from '../../src/lib/shared/wallet-holdings';
import { packByV1Size, v1TransactionFits } from '../../src/lib/shared/transaction-v1-size';

export async function previewSweepApprovals(
	ownerAddress: string,
	pda: string,
	holdings: WalletHoldings,
	sendSol = true
): Promise<number> {
	const owner = createNoopSigner(address(ownerAddress));
	const entries: Instruction[][] = [];
	const tokens = sweepTokenOrder(holdings);
	for (const token of tokens)
		entries.push(await buildSweepTokenInner(owner, address(pda), holdings.wallet, [token]));
	for (const asset of collectibleAssets(holdings).filter(
		(a) =>
			!sendAssetRestriction(a) &&
			(a.kind === 'nft' || (a.kind === 'token' && isProgrammableNft(a.token)))
	)) {
		const id =
			asset.kind === 'nft'
				? asset.nft.id
				: asset.kind === 'token'
					? asset.token.mint
					: holdings.wallet;
		entries.push([
			{
				programAddress: getAddressDecoder().decode(new Uint8Array(32).fill(230)),
				accounts: [
					{ address: holdings.wallet, role: AccountRole.WRITABLE_SIGNER },
					{ address: id, role: AccountRole.WRITABLE },
					{ address: owner.address, role: AccountRole.READONLY }
				],
				data: new Uint8Array(100)
			}
		]);
	}
	if (sendSol && (holdings.lamports > 0n || tokens.length > 0))
		entries.push(
			await buildSendInnerInstructions({
				owner,
				pda: address(pda),
				asset: { kind: 'sol' },
				recipient: owner.address,
				amount: 1n
			})
		);
	const payer = getAddressDecoder().decode(new Uint8Array(32).fill(255));
	const refill = await buildRefillInstruction(owner, address(pda), payer, 1n);
	const batches = await packByV1Size(entries, async (batch) =>
		v1TransactionFits(payer, [
			await buildExecuteWithOwnerInstruction({
				owner,
				phygitalToken: address(pda),
				instructions: batch.flat()
			}),
			refill
		])
	);
	return batches.length;
}
