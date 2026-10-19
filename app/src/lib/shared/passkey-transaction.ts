/**
 * Revibase Passkey transactions, seen as the transaction the app asked for.
 *
 * The passkey wallet's vault is a PDA, so it can't sign at the top level. Its
 * adapter turns `[...precompiles, ...calls]` into the v1 transaction
 * `[secp256r1(wallet), ...precompiles, execute(calls)]`, with the same budget
 * in its header and a Revibase fee payer. `unwrapPasskeyTransaction` undoes that, so the
 * same validators can check the calls the vault actually makes.
 */
import {
	AccountRole,
	address,
	decompileTransactionMessage,
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
	isWritableRole,
	type Address,
	type Instruction,
	type TransactionVersion,
	type V1TransactionConfig
} from '@solana/kit';
import {
	CREATE_WALLET_DISCRIMINATOR,
	EXECUTE_DISCRIMINATOR,
	findVaultPda,
	getExecuteInstructionDataDecoder,
	REVIBASE_WALLET_PROGRAM_ADDRESS
} from 'revibase-wallet-sdk';

import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from '@solana-program/compute-budget';
import { INSTRUCTIONS_SYSVAR, SECP256R1_PROGRAM_ADDRESS, SLOT_HASHES_SYSVAR } from './addresses';
import { bytesEqual } from './encoding';

export const PASSKEY_WALLET_NAME = 'Revibase Passkey';

export class PasskeyTransactionRejected extends Error {
	constructor(readonly reason: string) {
		super(`Transaction rejected: ${reason}`);
		this.name = 'PasskeyTransactionRejected';
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
		throw new PasskeyTransactionRejected(reason);
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
		if (err instanceof PasskeyTransactionRejected) throw err;
		return reject('undecodable transaction');
	}
}

export type UnwrappedPasskeyTransaction = {
	feePayer: Address;
	wallet: Address;
	vault: Address;
	slotNumber: bigint;
	/** Compute budget, the other precompiles, then the vault's calls (vault as signer). */
	instructions: Instruction[];
	precompileCount: number;
	/** The wallet's first transaction creates its config first (`create_wallet`). */
	createWallet: Instruction | null;
};

/**
 * Strict: `[create_wallet?, ...computeBudget, secp256r1(wallet), ...secp256r1,
 * execute]` and nothing else, with `execute` reading the wallet's verify at its
 * own index. A leading `create_wallet` must create this same wallet; it sits
 * before every precompile, so the relative indices are unchanged.
 */
export async function unwrapPasskeyTransaction(
	message: DecodedMessage
): Promise<UnwrappedPasskeyTransaction> {
	const reject = (reason: string): never => {
		throw new PasskeyTransactionRejected(reason);
	};
	const ixs = message.instructions;
	let i = 0;
	const isCreate = (ix: Instruction | undefined) =>
		ix?.programAddress === REVIBASE_WALLET_PROGRAM_ADDRESS &&
		bytesEqual(
			new Uint8Array(ix.data ?? []).subarray(0, 8),
			new Uint8Array(CREATE_WALLET_DISCRIMINATOR)
		);
	const createWallet = isCreate(ixs[0]) ? ixs[i++] : null;
	const budget: Instruction[] = [];
	while (ixs[i]?.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS) budget.push(ixs[i++]);
	const precompiles: Instruction[] = [];
	while (ixs[i]?.programAddress === SECP256R1_PROGRAM_ADDRESS) precompiles.push(ixs[i++]);
	const execute = ixs[i];
	if (!execute || i !== ixs.length - 1) reject('unexpected instruction after execute');
	if (precompiles.length === 0) reject('missing wallet signature verify');
	if (execute.programAddress !== REVIBASE_WALLET_PROGRAM_ADDRESS) reject('not a passkey execute');

	const data = new Uint8Array(execute.data ?? []);
	if (!bytesEqual(data.subarray(0, 8), new Uint8Array(EXECUTE_DISCRIMINATOR)))
		reject('not a passkey execute');
	let args;
	try {
		args = getExecuteInstructionDataDecoder().decode(data);
	} catch {
		return reject('undecodable execute');
	}
	// The wallet's own verify is the first precompile after the compute budget.
	if (args.verifyArgsRelativeIndex !== -BigInt(precompiles.length))
		reject('unexpected wallet verify index');
	if (args.signedMessageIndex !== 0) reject('unexpected wallet verify slot');

	const accounts = execute.accounts ?? [];
	const fixed = (n: number, addr: Address | null, roles: AccountRole[], what: string) => {
		const meta = accounts[n];
		if (!meta || !roles.includes(meta.role) || (addr && meta.address !== addr))
			reject(`unexpected ${what} account`);
		return meta.address;
	};
	const wallet = fixed(0, null, [AccountRole.WRITABLE], 'wallet');
	// Compiled once with the calls' accounts, so the vault is writable when a call writes it.
	const vault = fixed(1, null, [AccountRole.READONLY, AccountRole.WRITABLE], 'vault');
	fixed(2, SLOT_HASHES_SYSVAR, [AccountRole.READONLY], 'slot hashes');
	fixed(3, INSTRUCTIONS_SYSVAR, [AccountRole.READONLY], 'instructions sysvar');
	const [derived] = await findVaultPda({ wallet });
	if (derived !== vault) reject('vault does not belong to the wallet');
	// create_wallet accounts: [payer, wallet, vault, system program].
	if (
		createWallet &&
		(createWallet.accounts?.[1]?.address !== wallet ||
			createWallet.accounts?.[2]?.address !== vault)
	)
		reject('create_wallet is for another wallet');

	const table = accounts.slice(4);
	const at = (index: number) => table[index] ?? reject('account index out of range');
	const calls: Instruction[] = args.cpiIntents.map((intent) => ({
		programAddress: address(at(intent.programIdIndex).address),
		accounts: intent.accounts.map((meta) => {
			const account = at(meta.index);
			if (meta.isSigner && account.address !== vault) reject('only the vault can sign');
			// The fee payer is a writable signer at the top level; a call may only write to it.
			if (meta.isWritable && !isWritableRole(account.role))
				reject('writable account passed read-only');
			return {
				address: account.address,
				role: meta.isSigner
					? meta.isWritable
						? AccountRole.WRITABLE_SIGNER
						: AccountRole.READONLY_SIGNER
					: meta.isWritable
						? AccountRole.WRITABLE
						: AccountRole.READONLY
			};
		}),
		data: new Uint8Array(intent.data)
	}));

	return {
		feePayer: message.feePayer,
		wallet,
		vault,
		slotNumber: args.slotNumber,
		instructions: [...budget, ...precompiles.slice(1), ...calls],
		precompileCount: precompiles.length - 1,
		createWallet
	};
}
