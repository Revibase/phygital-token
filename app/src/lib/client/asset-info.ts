import { address, getBase64Encoder } from '@solana/kit';
import { TOKEN_PROGRAMS } from '$lib/shared/programs';

import { shortAddress } from '$lib/shared/encoding';
import type { AssetInfo } from '$lib/shared/policy-explain';
import { SOL_INFO } from '$lib/shared/policy-explain';
import { SOL } from '$lib/shared/policy-draft';
import type { WalletHoldings } from '$lib/shared/wallet-holdings';
import { browserRpc } from './rpc';

/** SPL Token and Token-2022 mints keep their decimals at byte 44. */
const MINT_DECIMALS_OFFSET = 44;

/**
 * Symbol and decimals for each asset: held tokens from the wallet's holdings,
 * other mints read from chain (their symbol falls back to a short address).
 */
export async function assetInfos(
	assets: readonly string[],
	holdings?: WalletHoldings
): Promise<Map<string, AssetInfo>> {
	const out = withHoldings(new Map<string, AssetInfo>([[SOL, SOL_INFO]]), holdings);
	const missing = [...new Set(assets)].filter((a) => !out.has(a));
	if (missing.length) {
		try {
			const { value } = await browserRpc()
				.getMultipleAccounts(
					missing.map((m) => address(m)),
					{ encoding: 'base64', dataSlice: { offset: 0, length: 82 } }
				)
				.send();
			missing.forEach((mint, i) => {
				const data = value[i] ? new Uint8Array(getBase64Encoder().encode(value[i].data[0])) : null;
				if (data?.length === 82 && data[45] === 1 && TOKEN_PROGRAMS.has(String(value[i]!.owner)))
					out.set(mint, { symbol: shortAddress(mint), decimals: data[MINT_DECIMALS_OFFSET] });
			});
		} catch {
			// Shown in raw units below.
		}
	}
	for (const m of missing)
		if (!out.has(m)) out.set(m, { symbol: `${shortAddress(m)} (raw units)`, decimals: 0 });
	return out;
}

/** `infos` with the wallet's held tokens named from its holdings, which know them best. */
export function withHoldings(
	infos: ReadonlyMap<string, AssetInfo>,
	holdings?: WalletHoldings
): Map<string, AssetInfo> {
	const out = new Map(infos);
	for (const t of holdings?.tokens ?? [])
		out.set(t.mint, {
			symbol: t.symbol ?? t.name ?? shortAddress(t.mint),
			decimals: t.decimals,
			icon: t.icon,
			name: t.name ?? undefined
		});
	return out;
}
