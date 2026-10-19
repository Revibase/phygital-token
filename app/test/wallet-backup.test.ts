import { describe, expect, it } from 'vitest';
import { AccountRole, blockhash, generateKeyPairSigner } from '@solana/kit';
import {
	getSetBackupAuthorityInstructionDataDecoder,
	NO_BACKUP_AUTHORITY,
	REVIBASE_WALLET_PROGRAM_ADDRESS
} from 'revibase-wallet-sdk';

import { decodeMessage } from '#lib/shared/passkey-transaction.ts';
import {
	backupAuthorityProblem,
	backupFeeLamports,
	buildBackupAuthorityTransaction
} from '#lib/shared/wallet-backup.ts';

const lifetime = {
	blockhash: blockhash('11111111111111111111111111111111'),
	lastValidBlockHeight: 1n
};
const addr = async () => (await generateKeyPairSigner()).address;

describe('backupAuthorityProblem', () => {
	it('accepts another address and says nothing while empty', async () => {
		const vault = await addr();
		expect(backupAuthorityProblem('', vault)).toBeNull();
		expect(backupAuthorityProblem(` ${await addr()} `, vault)).toBeNull();
	});

	it('refuses a non-address, the wallet itself and the empty authority', async () => {
		const vault = await addr();
		expect(backupAuthorityProblem('nope', vault)).toBe('That isn’t a Solana address.');
		expect(backupAuthorityProblem(vault, vault)).toBe('This wallet can’t be its own backup.');
		expect(backupAuthorityProblem(NO_BACKUP_AUTHORITY, vault)).toBe('Use another address.');
	});
});

describe('buildBackupAuthorityTransaction', () => {
	it('proposes one vault-signed set_backup_authority, v1, paid by the fee payer', async () => {
		const [wallet, vault, backup, feePayer] = await Promise.all([addr(), addr(), addr(), addr()]);
		const message = decodeMessage(
			buildBackupAuthorityTransaction(
				{ wallet, vault, backupAuthority: backup },
				feePayer,
				lifetime
			)
		);
		expect(message.version).toBe(1);
		expect(message.feePayer).toBe(feePayer);
		expect(message.instructions).toHaveLength(1);
		const [ix] = message.instructions;
		expect(ix.programAddress).toBe(REVIBASE_WALLET_PROGRAM_ADDRESS);
		expect(ix.accounts).toEqual([
			{ address: wallet, role: AccountRole.WRITABLE },
			{ address: vault, role: AccountRole.READONLY_SIGNER }
		]);
		expect(
			getSetBackupAuthorityInstructionDataDecoder().decode(new Uint8Array(ix.data!)).backupAuthority
		).toBe(backup);
	});

	it('clears with the empty authority', async () => {
		const [wallet, vault, feePayer] = await Promise.all([addr(), addr(), addr()]);
		const [ix] = decodeMessage(
			buildBackupAuthorityTransaction({ wallet, vault, backupAuthority: null }, feePayer, lifetime)
		).instructions;
		expect(
			getSetBackupAuthorityInstructionDataDecoder().decode(new Uint8Array(ix.data!)).backupAuthority
		).toBe(NO_BACKUP_AUTHORITY);
	});

	it('costs what a passkey transfer costs', () => {
		expect(backupFeeLamports()).toBe(13_000n);
	});
});
