import {
	appendTransactionMessageInstructions,
	createTransactionMessage,
	getBase58Codec,
	pipe,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signAndSendTransactionMessageWithSigners,
	type Address
} from '@solana/kit';
import type { TransactionSendingSigner } from '@solana/signers';
import {
	buildCreateDesignMintInstructions,
	buildMintTokenTransactionInstructions,
	parseSecp256r1Pubkey,
	type MetadataFields
} from 'phygital-nfts-client';
import { getRpc } from './rpc';

export type CreateDesignInput = MetadataFields & {
	groupMint: Address;
	designId: Address;
};

export type MintTokenInput = {
	designMint: Address;
	secp256r1PubkeyBase58: string;
	uri: string;
};

async function sendInstructions(
	feePayer: TransactionSendingSigner,
	instructions: Awaited<ReturnType<typeof buildCreateDesignMintInstructions>>['instructions']
): Promise<string> {
	const rpc = getRpc();
	const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

	const transactionMessage = pipe(
		createTransactionMessage({ version: 0 }),
		(message) => setTransactionMessageFeePayerSigner(feePayer, message),
		(message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
		(message) => appendTransactionMessageInstructions(instructions, message)
	);

	const signatureBytes = await signAndSendTransactionMessageWithSigners(transactionMessage);
	return getBase58Codec().decode(signatureBytes);
}

export async function submitCreateDesign(
	signer: TransactionSendingSigner,
	input: CreateDesignInput
): Promise<{ signature: string; designMint: Address }> {
	const { instructions, designMint } = await buildCreateDesignMintInstructions({
		payer: signer,
		owner: signer,
		groupMint: input.groupMint,
		groupMintAuthority: signer,
		name: input.name,
		symbol: input.symbol,
		uri: input.uri,
		designId: input.designId
	});

	const signature = await sendInstructions(signer, instructions);
	return { signature, designMint };
}

export async function submitMintToken(
	signer: TransactionSendingSigner,
	input: MintTokenInput
): Promise<{ signature: string; cardInstance: Address }> {
	const secp256r1Pubkey = parseSecp256r1Pubkey(input.secp256r1PubkeyBase58);

	const { instructions, cardInstance } = await buildMintTokenTransactionInstructions(getRpc(), {
		authority: signer,
		designMint: input.designMint,
		secp256r1Pubkey,
		uri: input.uri
	});

	const signature = await sendInstructions(signer, instructions);
	return { signature, cardInstance };
}

export async function submitBatchMintTokens(
	signer: TransactionSendingSigner,
	designMint: Address,
	inputs: MintTokenInput[]
): Promise<{ signature: string; cardInstance: Address }[]> {
	const results: { signature: string; cardInstance: Address }[] = [];

	for (const input of inputs) {
		results.push(await submitMintToken(signer, { ...input, designMint }));
	}

	return results;
}
