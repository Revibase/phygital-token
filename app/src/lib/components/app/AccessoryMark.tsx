'use client';

import { useQuery } from '@tanstack/react-query';
import { Nfc } from 'lucide-react';
import { useState } from 'react';

import { accessoryMediaQuery } from '#lib/client/queries.ts';
import { cn } from '#lib/utils.ts';

type MarkState = 'idle' | 'waiting' | 'verified' | 'unverified';

const box = { sm: 'size-12', md: 'size-20', lg: 'size-28', xl: 'size-28 lg:size-64' };
const mark = { sm: 'size-6', md: 'size-9', lg: 'size-12', xl: 'size-12 lg:size-24' };

export function AccessoryMark({
	state: mode = 'idle',
	size = 'lg',
	pda = null,
	hasMint,
	className = ''
}: {
	state?: MarkState;
	size?: 'sm' | 'md' | 'lg' | 'xl';
	pda?: string | null;
	hasMint?: boolean;
	className?: string;
}) {
	const wantsMedia = !!pda && hasMint !== false;
	const media = useQuery({ ...accessoryMediaQuery(pda ?? ''), enabled: wantsMedia });
	const image = media.data?.image ?? null;
	const resolved = !wantsMedia || media.isSuccess || media.isError;
	const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const loaded = !!image && loadedSrc === image;
	const failed = !!image && failedSrc === image;
	const showArtwork = !!image && !failed;
	const showPlaceholder = hasMint === true && (!resolved || (showArtwork && !loaded));

	return (
		<div
			className={cn('relative grid shrink-0 place-items-center', box[size], className)}
			aria-hidden="true"
		>
			{mode === 'waiting' ? (
				<span className="animate-ripple absolute inset-0 rounded-[26%] ring-2 ring-brand/60" />
			) : null}
			<div
				className={cn(
					'relative grid size-full place-items-center overflow-hidden rounded-[26%] transition-colors duration-200 ease-out',
					showPlaceholder || (showArtwork && loaded)
						? 'bg-muted'
						: mode === 'unverified'
							? 'bg-muted text-muted-foreground/60'
							: 'bg-accent bg-[linear-gradient(160deg,rgb(255_255_255/0.5),transparent_55%)] text-accent-foreground',
					'shadow-[0_1px_1px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(14_26_26/0.35),inset_0_1px_0_rgb(255_255_255/0.28)]'
				)}
			>
				{!showPlaceholder && !(showArtwork && loaded) ? (
					<Nfc
						strokeWidth={1.75}
						className={cn(mark[size], resolved && hasMint === true && 'animate-rise')}
					/>
				) : null}
				{showArtwork ? (
					<>
						<img
							src={image}
							alt=""
							decoding="async"
							referrerPolicy="no-referrer"
							className={cn(
								'absolute inset-0 size-full object-cover transition-opacity duration-200 ease-out',
								loaded ? 'opacity-100' : 'opacity-0'
							)}
							onLoad={() => setLoadedSrc(image)}
							onError={() => setFailedSrc(image)}
						/>
						<span className="pointer-events-none absolute inset-0 rounded-[26%] ring-1 ring-black/5 ring-inset" />
					</>
				) : null}
			</div>
			{mode === 'verified' ? (
				<span
					className={cn(
						'animate-pop absolute grid place-items-center rounded-full bg-success text-white ring-[3px] ring-background',
						size === 'sm'
							? '-right-1 -bottom-1 size-5'
							: size === 'xl'
								? '-right-1.5 -bottom-1.5 size-7 lg:-right-2.5 lg:-bottom-2.5 lg:size-11'
								: '-right-1.5 -bottom-1.5 size-7'
					)}
				>
					<svg
						viewBox="0 0 24 24"
						className={size === 'sm' ? 'size-3' : size === 'xl' ? 'size-4 lg:size-6' : 'size-4'}
						fill="none"
						stroke="currentColor"
						strokeWidth="3.2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path className="animate-draw" d="M5 12.5l4.5 4.5L19 7.5" />
					</svg>
				</span>
			) : null}
		</div>
	);
}
