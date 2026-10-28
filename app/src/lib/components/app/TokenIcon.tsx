'use client';

import { useState } from 'react';

export function TokenIcon({
	src = null,
	label,
	collectible = false
}: {
	src?: string | null;
	label: string;
	collectible?: boolean;
}) {
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	if (src && src !== failedSrc) {
		return (
			<img
				src={src}
				alt=""
				className={
					collectible
						? 'size-11 rounded-lg bg-muted object-cover'
						: 'size-9 rounded-full bg-muted object-cover'
				}
				onError={() => setFailedSrc(src)}
			/>
		);
	}
	return (
		<span
			aria-hidden="true"
			className={`grid place-items-center bg-muted text-[12px] font-semibold text-muted-foreground ${collectible ? 'size-11 rounded-lg' : 'size-9 rounded-full'}`}
		>
			{label.slice(0, 2).toUpperCase()}
		</span>
	);
}
