'use client';

import { useEffect, useState } from 'react';

import { Button } from '#lib/components/ui/button';
import { Spinner } from '#lib/components/ui/spinner';
import type { BrowseTarget } from '#lib/shared/browse-link.ts';
import { EmbedBrowser } from './EmbedBrowser';
import { PageHeader } from './PageHeader';
import { PageShell } from './PageShell';

const REFUSED: Record<Exclude<BrowseTarget, { ok: true }>['reason'], { title: string; body: string }> = {
	missing: {
		title: 'Nothing to open',
		body: 'Scan the QR code again, or open the link you were given.'
	},
	invalid: {
		title: 'This link can’t be opened',
		body: 'It looks incomplete or damaged. Ask them for a new QR code.'
	}
};

/** Opens a page from a browse link (a payment QR code, say) in the in-app browser, where the wallet is. */
export function OpenScreen({ target }: { target: BrowseTarget }) {
	const [state, setState] = useState<'opening' | 'open' | 'closed'>('opening');
	const [href, setHref] = useState(target.ok ? target.href : '');

	useEffect(() => {
		if (!target.ok) return;
		const fragment = new URL(target.href).hash ? '' : window.location.hash;
		setHref(`${target.href}${fragment}`);
		setState('open');
	}, [target]);

	if (!target.ok) {
		const copy = REFUSED[target.reason];
		return (
			<PageShell footer={<Button href="/" size="xl">Go to your wallet</Button>}>
				<section className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center" role="alert">
					<PageHeader title={copy.title} body={copy.body} />
				</section>
			</PageShell>
		);
	}

	return (
		<>
			<PageShell
				footer={
					state === 'closed' ? (
						<div className="grid gap-2">
							<Button size="xl" onClick={() => setState('open')}>
								Open again
							</Button>
							<Button href="/" variant="quiet" size="xl">
								Go to your wallet
							</Button>
						</div>
					) : null
				}
			>
				<section className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center" role="status">
					{state === 'closed' ? (
						<PageHeader
							title={`Closed ${target.hostname}`}
							body="If you finished there, there’s nothing more to do. Otherwise, open it again to pick up where you left off."
						/>
					) : (
						<div className="flex flex-col items-center gap-4 text-center">
							<Spinner className="size-6 text-muted-foreground" />
							<PageHeader
								align="center"
								title={`Opening ${target.hostname}…`}
							/>
						</div>
					)}
				</section>
			</PageShell>
			{state === 'open' ? (
				<EmbedBrowser
					key={href}
					href={href}
					label={target.hostname}
					onClose={() => setState('closed')}
				/>
			) : null}
		</>
	);
}
