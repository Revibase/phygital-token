'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '#lib/utils.ts';

export function Countdown({
	until,
	onExpire,
	className = ''
}: {
	until: number;
	onExpire?: () => void;
	className?: string;
}) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(timer);
	}, []);
	const remaining = Math.max(0, until - now);
	const label = `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`;
	const fired = useRef(false);
	useEffect(() => {
		fired.current = false;
	}, [until]);
	useEffect(() => {
		if (remaining === 0 && !fired.current) {
			fired.current = true;
			onExpire?.();
		}
	}, [remaining, onExpire]);

	return (
		<p
			className={cn(
				'text-[13px] tabular-nums transition-colors duration-300',
				remaining < 30_000 ? 'text-destructive' : 'text-muted-foreground',
				className
			)}
		>
			{remaining > 0 ? `Approval expires in ${label}` : 'Approval expired'}
		</p>
	);
}
