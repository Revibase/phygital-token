import { address } from '@solana/kit';
import { findWalletPda } from 'phygital-token-sdk';

import { fetchWalletHoldings, type WalletHoldings } from '$lib/shared/wallet-holdings';
import { browserRpc, rpcUrl } from '../rpc';

export async function fetchAccessoryWallet(pda: string): Promise<WalletHoldings> {
	const [wallet] = await findWalletPda({ phygitalToken: address(pda) });
	return fetchWalletHoldings(browserRpc(), wallet, rpcUrl());
}
