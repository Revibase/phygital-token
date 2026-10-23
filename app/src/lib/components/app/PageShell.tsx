'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { RevibaseMark } from '#lib/brand/RevibaseMark';
import { useBoot } from '#lib/client/boot';
import { networkLabel } from '#lib/shared/explorer.ts';
import { WalletButton } from './WalletButton';

export function PageShell({
	children,
	footer,
	size = 'narrow',
	back = false,
	brand = true,
	connect = true
}: {
	children: React.ReactNode;
	footer?: React.ReactNode;
	size?: 'narrow' | 'medium' | 'wide';
	back?: boolean;
	brand?: boolean;
	connect?: boolean;
}) {
	const pathname = usePathname();
	const { cluster } = useBoot();
	const [showBack, setShowBack] = useState(false);
	useEffect(() => {
		setShowBack(back && window.history.length > 1);
	}, [back, pathname]);
	const network = networkLabel(cluster);
	const max = { narrow: 'lg:max-w-[440px]', medium: 'lg:max-w-[560px]', wide: 'lg:max-w-[920px]' };

	return (
		<div className="flex min-h-dvh w-full flex-col">
			<header className="pt-[max(0.75rem,env(safe-area-inset-top))] lg:border-b lg:border-border/70 lg:pt-0">
				<div className="mx-auto flex h-12 w-full max-w-[440px] items-center justify-between px-5 lg:h-14 lg:max-w-none lg:px-8">
					{showBack ? (
						<button
							type="button"
							onClick={() => history.back()}
							className="-mx-2 inline-flex h-11 items-center gap-1 rounded-lg px-2 text-[15px] font-medium focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
						>
							<ChevronLeft className="-ml-1 size-5" />
							Back
						</button>
					) : brand ? (
						<Link
							href="/"
							className="-mx-2 inline-flex h-11 items-center gap-2 rounded-lg px-2 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
							aria-label="Revibase home"
						>
							<span className="grid size-6 place-items-center rounded-[26%] bg-brand text-brand-cream">
								<RevibaseMark className="w-3.5" />
							</span>
							<span className="text-[15px] font-semibold tracking-[-0.01em]">Revibase</span>
						</Link>
					) : null}
					<div className="ml-auto flex items-center gap-2">
						{network ? (
							<span
								className="rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground"
								title="Solana network"
							>
								{network}
							</span>
						) : null}
						{pathname !== '/wallet' ? <WalletButton connect={connect} /> : null}
					</div>
				</div>
			</header>
			<div className="flex flex-1 flex-col lg:justify-center">
				<div
					className={`mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:flex-none lg:px-8 lg:py-12 ${max[size]}`}
				>
					<main className="flex flex-1 flex-col">{children}</main>
					{footer ? <footer className="pt-6">{footer}</footer> : null}
				</div>
			</div>
		</div>
	);
}
