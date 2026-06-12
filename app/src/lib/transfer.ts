import {
	address,
	getBase58Codec,
	appendTransactionMessageInstructions,
	createTransactionMessage,
	pipe,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signAndSendTransactionMessageWithSigners,
	type Address
} from '@solana/kit';
import type { TransactionSendingSigner } from '@solana/signers';
import {
	authenticateCard,
	beginTransfer,
	completeTransfer,
	type TransferSession
} from 'phygital-nfts-client';
import { getRpc } from './rpc';

export async function createTransferSession(cardInstance: Address): Promise<TransferSession> {
	return beginTransfer({
		rpc: getRpc(),
		cardInstance
	});
}

export async function authenticateTransferCard(session: TransferSession) {
	return authenticateCard(session);
}

export async function submitTransfer(
	session: TransferSession,
	webauthnResponse: Awaited<ReturnType<typeof authenticateTransferCard>>,
	recipient: TransactionSendingSigner
): Promise<string> {
	const rpc = getRpc();
	const instructions = await completeTransfer(session, webauthnResponse, recipient);
	const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

	const transactionMessage = pipe(
		createTransactionMessage({ version: 0 }),
		(message) => setTransactionMessageFeePayerSigner(recipient, message),
		(message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
		(message) => appendTransactionMessageInstructions(instructions, message)
	);

	const signatureBytes = await signAndSendTransactionMessageWithSigners(transactionMessage);
	return getBase58Codec().decode(signatureBytes);
}

export function parseMintParam(value: string | null): Address {
	if (!value?.trim()) {
		throw new Error('Missing card instance address. Use /card/<instance-address>.');
	}
	return address(value.trim());
}
