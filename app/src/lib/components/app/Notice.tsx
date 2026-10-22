'use client';

import { CircleAlert, Info } from 'lucide-react';
import { useState } from 'react';

import type { FriendlyError } from '#lib/client/link/messages.ts';
import { Button } from '#lib/components/ui/button';
import { cn } from '#lib/utils.ts';

/** Pass `error` to show a FriendlyError (nothing renders while it's null), or `title`/`body` directly. */
export function Notice({
	title: titleProp,
	body: bodyProp,
	detail: detailProp,
	error,
	tone = 'error',
	actions,
	onretry,
	retrying = false
}: {
	title?: string;
	body?: string;
	detail?: string;
	error?: FriendlyError | null;
	tone?: 'error' | 'info';
	actions?: React.ReactNode;
	onretry?: () => void;
	retrying?: boolean;
}) {
	const title = error ? error.title : titleProp;
	const body = error ? error.body : bodyProp;
	const detail = error ? error.detail : detailProp;
	const [showDetail, setShowDetail] = useState(false);
	if (!title) return null;
	return (
		<div className="animate-rise space-y-3" role={tone === 'error' ? 'alert' : 'status'}>
			<div
				className={cn(
					'flex gap-3 rounded-[14px] px-4 py-3.5',
					tone === 'error' ? 'bg-destructive/[0.07]' : 'bg-muted'
				)}
			>
				{tone === 'error' ? (
					<CircleAlert className="mt-0.5 size-[18px] shrink-0 text-destructive" />
				) : (
					<Info className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />
				)}
				<div className="min-w-0 space-y-0.5">
					<p className="text-[15px] font-medium">{title}</p>
					{body ? <p className="text-[14px] leading-snug text-muted-foreground">{body}</p> : null}
					{detail ? (
						<>
							<button
								type="button"
								className="-ml-1 mt-1 min-h-11 rounded px-1 text-[13px] text-muted-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
								aria-expanded={showDetail}
								onClick={() => setShowDetail((open) => !open)}
							>
								{showDetail ? 'Hide details' : 'Details'}
							</button>
							{showDetail ? (
								<pre className="animate-rise mt-1 overflow-x-auto text-[12px] whitespace-pre-wrap text-muted-foreground">
									{detail}
								</pre>
							) : null}
						</>
					) : null}
				</div>
			</div>
			{actions || onretry ? (
				<div className="grid gap-2">
					{actions}
					{onretry ? (
						<Button variant="secondary" className="w-full" disabled={retrying} onClick={onretry}>
							{retrying ? 'Trying again…' : 'Try again'}
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
