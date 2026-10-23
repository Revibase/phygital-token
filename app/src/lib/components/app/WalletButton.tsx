'use client';

import { ChevronDown, LogOut, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useWallet } from '#lib/client/wallet/wallet-context';
import { Button } from '#lib/components/ui/button';
import * as DropdownMenu from '#lib/components/ui/dropdown-menu';
import { shortAddress } from '#lib/shared/encoding.ts';
import { WalletConnect } from './WalletConnect';

export function WalletButton({ connect = true }: { connect?: boolean }) {
	const wallet = useWallet();
	const [connecting, setConnecting] = useState(false);

	return (
		<>
			{wallet.address ? (
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						aria-label={`Wallet ${wallet.address}`}
						className="inline-flex h-10 items-center gap-1.5 rounded-full border bg-card px-4 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-muted/60"
					>
						<span className="font-mono text-[13px] font-medium">
							{shortAddress(wallet.address)}
						</span>
						<ChevronDown className="size-3.5 text-muted-foreground" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" className="min-w-44">
						<DropdownMenu.Item asChild>
							<Link href="/wallet">
								<Wallet className="size-4 shrink-0" />
								View wallet
							</Link>
						</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={() => void wallet.disconnect()}>
							<LogOut className="size-4 shrink-0" />
							Disconnect
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			) : connect && !wallet.pending ? (
				<Button size="sm" className="h-10 rounded-full px-4" onClick={() => setConnecting(true)}>
					Connect
				</Button>
			) : null}
			<WalletConnect open={connecting} onOpenChange={setConnecting} showButton={false} />
		</>
	);
}
