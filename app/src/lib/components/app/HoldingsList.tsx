'use client';

import { useState } from 'react';

import { formatCompactTokenAmount, SOL_DECIMALS } from '#lib/shared/amount.ts';
import {
	arrangeTokens,
	formatUsd,
	TOKEN_PREVIEW,
	tokenLabel,
	type TokenHolding,
	type WalletHoldings
} from '#lib/shared/wallet-holdings.ts';
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
	const [openFor, setOpenFor] = useState<string | null>(null);
	const ordered = holdings ? arrangeTokens(holdings.tokens) : [];
	const open = holdings ? openFor === holdings.wallet : false;
	const extra = Math.max(0, ordered.length - TOKEN_PREVIEW);
	const shown = extra > 0 && !open ? ordered.slice(0, TOKEN_PREVIEW) : ordered;

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
					{shown.map((token) => (
						<TokenRow key={token.tokenAccount} token={token} onSelect={onSelect} />
					))}
					{!holdings.tokens.length ? (
						<li className="px-4 py-5 text-[14px] text-muted-foreground">
							Tokens you receive will appear here.
						</li>
					) : null}
					{extra > 0 ? (
						<li>
							<button
								type="button"
								className="flex min-h-14 w-full items-center justify-center px-4 text-[15px] font-medium text-brand outline-none transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset active:bg-muted"
								aria-expanded={open}
								onClick={() => setOpenFor(open ? null : holdings.wallet)}
							>
								{open ? 'Show less' : `${extra} more`}
							</button>
						</li>
					) : null}
				</>
			)}
		</List>
	);
}

function TokenRow({
	token,
	onSelect
}: {
	token: TokenHolding;
	onSelect?: (asset: SendAsset) => void;
}) {
	return (
		<ListRow
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
	);
}
