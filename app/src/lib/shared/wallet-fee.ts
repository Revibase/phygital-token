import { address, type Instruction, type V1TransactionConfig } from '@solana/kit';

import { SECP256R1_PROGRAM_ADDRESS } from './addresses';

/**
 * What a wallet transfer costs in network fees, for any wallet.
 *
 * An ordinary wallet pays its own fee. Revibase Passkey's vault can't, so the
 * Revibase fee payer pays it and the same transaction pays it back from the
 * vault (see `buildTransferTransaction`). Either way the wallet bears the fee.
 */
export const LAMPORTS_PER_SIGNATURE = 5_000n;

/**
 * A transfer as a v1 transaction. Opening the recipient's token account is the
 * costliest call; the loaded-data limit covers the token programs (Token-2022 is
 * large) plus the passkey wallet's program.
 */
export const TRANSFER_TX_CONFIG = {
	computeUnitLimit: 200_000,
	loadedAccountsDataSizeLimit: 4 * 1024 * 1024,
	priorityFeeLamports: 3_000n
} as const satisfies V1TransactionConfig;

/** Signatures a transfer carries: the fee payer, plus the passkey's secp256r1 verify. */
export const transferSignatureCount = (passkey: boolean) => (passkey ? 2 : 1);

/** Every signature costs the same, transaction signers and precompile signatures alike. */
export function networkFeeLamports(signatures: number, config: V1TransactionConfig): bigint {
	return BigInt(signatures) * LAMPORTS_PER_SIGNATURE + (config.priorityFeeLamports ?? 0n);
}

const PRECOMPILES = new Set<string>([
	SECP256R1_PROGRAM_ADDRESS,
	address('Ed25519SigVerify111111111111111111111111111'),
	address('KeccakSecp256k11111111111111111111111111111')
]);

/** The fee a decoded transaction will be charged: its signers plus each precompile's signature count. */
export function messageFeeLamports(message: {
	signers: readonly unknown[];
	instructions: readonly Instruction[];
	config: V1TransactionConfig;
}): bigint {
	const precompileSignatures = message.instructions
		.filter((ix) => PRECOMPILES.has(ix.programAddress))
		.reduce((n, ix) => n + (ix.data?.[0] ?? 0), 0);
	return networkFeeLamports(message.signers.length + precompileSignatures, message.config);
}
