'use client';

import { formatCompactTokenAmount, SOL_DECIMALS } from '#lib/shared/amount.ts';
import { formatUsd, tokenLabel, type WalletHoldings } from '#lib/shared/wallet-holdings.ts';
import type { SendAsset } from '#lib/shared/wallet-transfer.ts';
import { List } from './List';
import { ListRow } from './ListRow';
import { ListRowSkeleton } from './ListRowSkeleton';
import { TokenIcon } from './TokenIcon';

const usd = (amount: bigint, decimals: number, price: number | null) =>
	price === null ? undefined : formatUsd((Number(amount) / 10 ** decimals) * price);

export function HoldingsList({
	holdings,
	label = 'Assets',
	onSelect
}: {
	holdings: WalletHoldings | undefined;
	label?: string | null;
	onSelect?: (asset: SendAsset) => void;
}) {
	return (
		<List label={label ?? undefined}>
			{!holdings ? (
				[0, 1].map((i) => <ListRowSkeleton key={i} />)
			) : (
				<>
					<ListRow
						label="Solana"
						detail={usd(holdings.lamports, SOL_DECIMALS, holdings.solPriceUsd) ?? 'SOL'}
						value={`${formatCompactTokenAmount(holdings.lamports, SOL_DECIMALS)} SOL`}
						onClick={onSelect ? () => onSelect({ kind: 'sol' }) : undefined}
						chevron={!!onSelect}
						leading={<TokenIcon src="/solana.svg" label="SOL" />}
					/>
					{holdings.tokens.map((token) => (
						<ListRow
							key={token.tokenAccount}
							label={token.name ?? tokenLabel(token)}
							detail={
								token.frozen
									? 'Frozen · can’t be sent'
									: (usd(token.amount, token.decimals, token.priceUsd) ??
										(token.name && token.symbol ? token.symbol : 'Token'))
							}
							value={`${formatCompactTokenAmount(token.amount, token.decimals)}${token.symbol ? ` ${token.symbol}` : ''}`}
							onClick={onSelect && !token.frozen ? () => onSelect({ kind: 'token', token }) : undefined}
							chevron={!!onSelect && !token.frozen}
							leading={<TokenIcon src={token.icon} label={tokenLabel(token)} />}
						/>
					))}
					{!holdings.tokens.length ? (
						<li className="px-4 py-5 text-[14px] text-muted-foreground">Tokens you receive will appear here.</li>
					) : null}
				</>
			)}
		</List>
	);
}
