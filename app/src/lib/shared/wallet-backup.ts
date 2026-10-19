import {
	appendTransactionMessageInstructions,
	compileTransaction,
	createTransactionMessage,
	getTransactionEncoder,
	isAddress,
	pipe,
	setTransactionMessageConfig,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	type Address,
	type Blockhash
} from '@solana/kit';
import { buildSetBackupAuthorityInstruction, NO_BACKUP_AUTHORITY } from 'revibase-wallet-sdk';

import { networkFeeLamports, TRANSFER_TX_CONFIG, transferSignatureCount } from './wallet-fee';

export const backupFeeLamports = () =>
	networkFeeLamports(transferSignatureCount(true), TRANSFER_TX_CONFIG);

export function backupAuthorityProblem(input: string, vault: string): string | null {
	const value = input.trim();
	if (!value) return null;
	if (!isAddress(value)) return 'That isn’t a Solana address.';
	if (value === vault) return 'This wallet can’t be its own backup.';
	if (value === NO_BACKUP_AUTHORITY) return 'Use another address.';
	return null;
}

export function buildBackupAuthorityTransaction(
	input: { wallet: Address; vault: Address; backupAuthority: Address | null },
	feePayer: Address,
	blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint }
): Uint8Array {
	const message = pipe(
		createTransactionMessage({ version: 1 }),
		(m) => setTransactionMessageFeePayer(feePayer, m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
		(m) => setTransactionMessageConfig(TRANSFER_TX_CONFIG, m),
		(m) => appendTransactionMessageInstructions([buildSetBackupAuthorityInstruction(input)], m)
	);
	return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}
