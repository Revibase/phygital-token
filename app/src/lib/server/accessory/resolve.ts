import { address, type Rpc, type SolanaRpcApi } from '@solana/kit';
import {
	fetchMaybePhygitalToken,
	fetchPhygitalTokenByIdentifier,
	findPhygitalTokenPda,
	type PhygitalToken
} from 'phygital-token-sdk';

export type ResolvedAccessory = { pda: string; account: PhygitalToken };

/**
 * The token whose on-chain `identifier` is this chip's (the dynamic-URL `pk`),
 * or null. The PDA is seeded by the card key, not the identifier, so this
 * scans the program (`getProgramAccounts` + memcmp); with the card key,
 * `fetchAccessory` is cheaper.
 */
export async function fetchAccessoryByIdentifier(
	rpc: Rpc<SolanaRpcApi>,
	identifier: string
): Promise<ResolvedAccessory | null> {
	const account = await fetchPhygitalTokenByIdentifier(rpc, identifier);
	if (!account) return null;
	return { pda: String(await findPhygitalTokenPda(account.publicKey)), account };
}

export async function fetchAccessory(
	rpc: Rpc<SolanaRpcApi>,
	pda: string
): Promise<ResolvedAccessory | null> {
	const maybe = await fetchMaybePhygitalToken(rpc, address(pda), { commitment: 'confirmed' });
	return maybe.exists ? { pda, account: maybe.data } : null;
}
