import { address } from '@solana/kit';
import { decodeBase64Strict, walletSetupLamports } from 'revibase-wallet-sdk';

import { browserRpc } from '../rpc';
import { passkeySession } from './passkey.svelte';

/**
 * What the Revibase Passkey wallet pays on top of the network fee for its next
 * transaction: its config's rent, once, while the wallet doesn't exist on-chain
 * yet (it is created by its first transaction). 0 for any other wallet.
 */
export async function walletSetupFor(vault: string): Promise<bigint> {
	const session = passkeySession();
	if (!session || session.vault !== vault) return 0n;
	const { setup } = await walletSetupLamports(
		browserRpc(),
		address(session.wallet),
		decodeBase64Strict(session.credentialId, 1023, 'url').length
	);
	return setup;
}
