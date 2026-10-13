import {
	appendTransactionMessageInstructions,
	compileTransaction,
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

export const MAX_V1_TRANSACTION_BYTES = 4096;
export const MAX_V1_ACCOUNTS = 64;

/** Raised by pre-signing simulation; a batch can safely be split and retried. */
export class TransactionComputeLimitError extends Error {}

/** Full wire size, including signature slots and the v1 resource configuration. */
export function v1TransactionFits(
	feePayer: Address,
	instructions: readonly Instruction[]
): boolean {
	const accounts = new Set<Address>([feePayer]);
	for (const instruction of instructions) {
		accounts.add(instruction.programAddress);
		for (const account of instruction.accounts ?? []) accounts.add(account.address);
	}
	if (accounts.size > MAX_V1_ACCOUNTS || instructions.length > 64) return false;
	const message = pipe(
		createTransactionMessage({ version: 1 }),
		(m) => setTransactionMessageFeePayer(feePayer, m),
		(m) =>
			setTransactionMessageLifetimeUsingBlockhash(
				{ blockhash: '11111111111111111111111111111111' as Blockhash, lastValidBlockHeight: 0n },
				m
			),
		(m) =>
			setTransactionMessageConfig(
				{
					computeUnitLimit: 1_400_000,
					loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
					priorityFeeLamports: 0xffffffffffffffffn
				},
				m
			),
		(m) => appendTransactionMessageInstructions(instructions, m)
	);
	return (
		getTransactionEncoder().encode(compileTransaction(message)).length <= MAX_V1_TRANSACTION_BYTES
	);
}

/** Preserve order and split only when the next item exceeds the serialized envelope. */
export async function packByV1Size<T>(
	items: readonly T[],
	fits: (items: readonly T[]) => Promise<boolean>
): Promise<T[][]> {
	const batches: T[][] = [];
	let current: T[] = [];
	for (const item of items) {
		const next = [...current, item];
		if (await fits(next)) {
			current = next;
			continue;
		}
		if (!current.length || !(await fits([item])))
			throw new Error('This asset transfer exceeds the v1 transaction limits.');
		batches.push(current);
		current = [item];
	}
	if (current.length) batches.push(current);
	return batches;
}
