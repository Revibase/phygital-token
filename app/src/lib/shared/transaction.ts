/**
 * Decode the exact transaction the app asked a wallet to sign.
 * Address lookup tables are never allowed.
 */
import {
	decompileTransactionMessage,
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
	type Address,
	type Instruction,
	type TransactionVersion,
	type V1TransactionConfig
} from '@solana/kit';

export class TransactionRejected extends Error {
	constructor(readonly reason: string) {
		super(`Transaction rejected: ${reason}`);
		this.name = 'TransactionRejected';
	}
}

export type DecodedMessage = {
	version: TransactionVersion;
	/** A v1 transaction's budget (compute limit, priority fee, loaded data); empty otherwise. */
	config: V1TransactionConfig;
	feePayer: Address;
	instructions: readonly Instruction[];
	/** Accounts that must sign at the top level, from the message header. */
	signers: readonly Address[];
	/** What those signers sign. */
	messageBytes: Uint8Array;
};

/** Decode exact wire bytes; address lookup tables are never allowed. */
export function decodeMessage(wireBytes: Uint8Array): DecodedMessage {
	const reject = (reason: string): never => {
		throw new TransactionRejected(reason);
	};
	try {
		const tx = getTransactionDecoder().decode(wireBytes);
		const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
		if ('addressTableLookups' in compiled && (compiled.addressTableLookups?.length ?? 0) > 0)
			reject('address lookup tables are not allowed');
		const message = decompileTransactionMessage(compiled);
		return {
			version: message.version,
			config: message.version === 1 ? { ...message.config } : {},
			feePayer: message.feePayer.address,
			instructions: message.instructions,
			signers: Object.keys(tx.signatures) as Address[],
			messageBytes: new Uint8Array(tx.messageBytes)
		};
	} catch (err) {
		if (err instanceof TransactionRejected) throw err;
		return reject('undecodable transaction');
	}
}
