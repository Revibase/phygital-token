import { address, getBase58Decoder, type Address } from '@solana/kit';
import { fetchMaybeWalletConfig, NO_BACKUP_AUTHORITY } from 'revibase-wallet-sdk';

import { queryClient, queryKeys } from '../cache';
import { browserRpc } from '../rpc';
import { waitForConfirmation } from '../tx';
import { passkeySession } from './passkey.svelte';
import { signWithWallet, type SigningContext } from './wallet.svelte';
import { buildBackupAuthorityTransaction } from '#lib/shared/wallet-backup.ts';

export async function fetchBackupAuthority(vault: string): Promise<string | null> {
	const session = passkeySession();
	if (!session || session.vault !== vault) return null;
	const config = await fetchMaybeWalletConfig(browserRpc(), address(session.wallet));
	if (!config.exists) return null;
	const current = String(config.data.backupAuthority);
	return current === NO_BACKUP_AUTHORITY ? null : current;
}

export async function setBackupAuthority(
	ctx: SigningContext,
	backupAuthority: Address | null
): Promise<string> {
	const session = passkeySession();
	if (!ctx.passkey || !session || session.vault !== ctx.address)
		throw new Error('Connect your Revibase Passkey wallet to change its backup.');
	const rpc = browserRpc();
	const blockhash = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
	const wireBytes = buildBackupAuthorityTransaction(
		{ wallet: address(session.wallet), vault: address(session.vault), backupAuthority },
		address(ctx.feePayer),
		blockhash
	);
	const outcome = await signWithWallet(ctx, wireBytes);
	if (outcome.kind !== 'sent') throw new Error('Revibase Passkey should have sent this.');
	const signature = getBase58Decoder().decode(outcome.signature);
	await waitForConfirmation(signature);
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: queryKeys.walletBackup(ctx.address) }),
		queryClient.invalidateQueries({ queryKey: queryKeys.walletHoldings(ctx.address) }),
		queryClient.invalidateQueries({ queryKey: queryKeys.walletSetup(ctx.address) })
	]);
	return signature;
}
