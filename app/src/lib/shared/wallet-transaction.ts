import {
	AccountRole,
	decompileTransactionMessage,
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
	type Instruction,
	type Transaction
} from '@solana/kit';
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from '@solana-program/compute-budget';

import { LIGHTHOUSE_PROGRAM_ADDRESS, LinkTransactionRejected, sameInstruction } from './link-transaction';

/**
 * Re-check what the owner's wallet returns: the fee payer is the expected one
 * (the owner, or a Revibase fee payer), our instructions appear unchanged and
 * in order, anything added is only compute-budget or Lighthouse, and nobody
 * but the owner and that fee payer signs.
 */
export function assertTransactionIntact(signedBytes: Uint8Array, expected: readonly Instruction[], owner: string, feePayer: string = owner): Transaction {
	const reject = (reason: string): never => {
		throw new LinkTransactionRejected(reason);
	};
	let tx: Transaction;
	let message;
	try {
		tx = getTransactionDecoder().decode(signedBytes);
		const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
		if ('addressTableLookups' in compiled && (compiled.addressTableLookups?.length ?? 0) > 0) reject('address lookup tables are not allowed');
		message = decompileTransactionMessage(compiled);
	} catch (err) {
		if (err instanceof LinkTransactionRejected) throw err;
		return reject('undecodable transaction');
	}
	if (message.feePayer.address !== feePayer) reject('unexpected fee payer');

	let next = 0;
	for (const ix of message.instructions) {
		if (next < expected.length && sameInstruction(ix, expected[next])) next++;
		else if (ix.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS && ix.programAddress !== LIGHTHOUSE_PROGRAM_ADDRESS) reject(`unexpected program ${ix.programAddress}`);
		for (const meta of ix.accounts ?? []) {
			const signer = meta.role === AccountRole.READONLY_SIGNER || meta.role === AccountRole.WRITABLE_SIGNER;
			if (signer && meta.address !== owner && meta.address !== feePayer) reject('unexpected additional signer');
		}
	}
	if (next !== expected.length) reject('instructions altered');
	return tx!;
}
