'use client';

import { useState } from 'react';

import { AccessoryMark } from './AccessoryMark';

/**
 * The page's one image: the project's featured image, with the accessory's own mark over its edge so the tapped object is
 * still what you see first. The mark keeps Revibase's verified check.
 */
export function HeroVisual({
	image,
	pda,
	onOpenNft
}: {
	image: string;
	pda: string;
	onOpenNft: () => void;
}) {
	const [broken, setBroken] = useState(false);
	return (
		<div className="relative w-full pb-10">
			<div className="relative aspect-[3/2] w-full overflow-hidden rounded-[22px] bg-muted shadow-[0_1px_2px_rgb(14_26_26/0.06),0_16px_40px_-20px_rgb(14_26_26/0.45)]">
				{broken ? null : (
					<img
						src={image}
						alt=""
						decoding="async"
						className="size-full object-cover"
						onError={() => setBroken(true)}
					/>
				)}
				<span className="pointer-events-none absolute inset-0 rounded-[22px] ring-1 ring-black/5 ring-inset" />
			</div>
			<button
				type="button"
				aria-label="View NFT details"
				onClick={onOpenNft}
				className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-[26%] bg-background p-1 outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring lg:left-6 lg:translate-x-0"
			>
				<AccessoryMark state="verified" size="md" pda={pda} hasMint />
			</button>
		</div>
	);
}
