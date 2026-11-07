import { concatBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
	getAddressEncoder,
	getU64Decoder,
	type Address,
	type Instruction,
	type Rpc,
	type SolanaRpcApi,
	type TransactionSigner
} from '@solana/kit';
import {
	findPhygitalTokenPda,
	getSecp256r1VerifyInstruction,
	getSetOwnerInstruction,
	parseSecp256r1Pubkey,
	PhygitalTokenError,
	verifyResponse,
	type AuthenticationResponseJSON
} from 'phygital-token-sdk';

import { SLOT_HASHES_SYSVAR } from './addresses';
import { base64ToBytes, bytesEqual } from './encoding';

/** What a `set_owner` tap is bound to. Tap with `startAuthentication(session.challenge)`. */
export type TransferSession = {
	phygitalToken: Address;
	/** The token's card public key (base64url compressed). */
	secp256r1Pubkey: string;
	/** Wallet named by the tap. {@link completeTransfer} must use this signer. */
	recipient: Address;
	slotNumber: bigint;
	/** `SHA256("t" || token || recipient || slot_hash)`: the payload the card signs. */
	challenge: Uint8Array;
};

const TRANSFER_TAG = new TextEncoder().encode('t');

/** The `set_owner` payload: `SHA256("t" || token || recipient || slot_hash)`. */
export function buildTransferChallenge(input: {
	phygitalToken: Address;
	recipient: Address;
	slotHash: Uint8Array;
}): Uint8Array {
	const address = getAddressEncoder();
	return sha256(
		concatBytes(
			TRANSFER_TAG,
			new Uint8Array(address.encode(input.phygitalToken)),
			new Uint8Array(address.encode(input.recipient)),
			input.slotHash
		)
	);
}

/** The latest `(slotNumber, slotHash)` from the SlotHashes sysvar. */
async function getLatestSlotHash(rpc: Rpc<SolanaRpcApi>) {
	const { value } = await rpc
		.getAccountInfo(SLOT_HASHES_SYSVAR, {
			encoding: 'base64',
			commitment: 'confirmed',
			dataSlice: { offset: 8, length: 40 }
		})
		.send();
	if (!value)
		throw new Error('Couldn’t read the latest slot hash. Check the connection and retry.');
	const data = base64ToBytes(value.data[0]);
	return {
		slotNumber: getU64Decoder().decode(data.subarray(0, 8)),
		slotHash: data.subarray(8, 40)
	};
}

/**
 * Bind a `set_owner` tap to the token, `recipient` and the latest slot hash.
 * Tap promptly: the slot hash ages out of SlotHashes after ~512 slots.
 */
export async function beginTransfer(input: {
	rpc: Rpc<SolanaRpcApi>;
	secp256r1Pubkey: string;
	recipient: Address;
}): Promise<TransferSession> {
	const [phygitalToken, { slotHash, slotNumber }] = await Promise.all([
		findPhygitalTokenPda(input.secp256r1Pubkey),
		getLatestSlotHash(input.rpc)
	]);
	return {
		phygitalToken,
		secp256r1Pubkey: input.secp256r1Pubkey,
		recipient: input.recipient,
		slotNumber,
		challenge: buildTransferChallenge({ phygitalToken, recipient: input.recipient, slotHash })
	};
}

/**
 * The precompile and `set_owner` instructions for a tap over `session.challenge`.
 * Throws if the tap isn't the token's card signing that challenge.
 */
export function completeTransfer(
	session: TransferSession,
	response: AuthenticationResponseJSON,
	recipient: TransactionSigner
): Instruction[] {
	if (recipient.address !== session.recipient) {
		throw new PhygitalTokenError(
			'INVALID_ARGUMENT',
			'The signing wallet must be the recipient named by the tap.'
		);
	}
	const tap = verifyResponse(response, session.challenge);
	const [expectedKey] = parseSecp256r1Pubkey(session.secp256r1Pubkey);
	if (!bytesEqual(tap.publicKey, expectedKey)) {
		throw new PhygitalTokenError(
			'INVALID_ASSERTION',
			'That’s a different tag from the one this transfer is for.'
		);
	}
	return [
		getSecp256r1VerifyInstruction([tap]),
		getSetOwnerInstruction({
			recipient,
			phygitalToken: session.phygitalToken,
			slotNumber: session.slotNumber,
			relativeIndex: -1,
			signatureIndex: 0
		})
	];
}
