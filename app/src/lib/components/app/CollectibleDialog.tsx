'use client';

import { useState } from 'react';

import { Skeleton } from '#lib/components/ui/skeleton';
import { shortAddress } from '#lib/shared/encoding.ts';
import type { MintMedia } from '#lib/shared/mint-media.ts';
import { CopyButton } from './CopyButton';
import { ExplorerLink } from './ExplorerLink';
import { ResponsiveSheet } from './ResponsiveSheet';

export function CollectibleDialog({
	open,
	onOpenChange,
	mint,
	media,
	cluster,
	loading = false
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mint: string;
	media: MintMedia | null;
	cluster: string;
	loading?: boolean;
}) {
	const [failedImage, setFailedImage] = useState<string | null>(null);
	const [failedCollectionImage, setFailedCollectionImage] = useState<string | null>(null);

	return (
		<ResponsiveSheet
			open={open}
			onOpenChange={onOpenChange}
			title={media?.name ?? 'NFT details'}
			description="Artwork and metadata for this NFT."
			hideTitle
			wide
		>
			<div className="grid gap-6 md:grid-cols-2 md:gap-8">
				<div className="flex aspect-square items-center justify-center overflow-hidden rounded-[18px] bg-muted">
					{media?.image && failedImage !== media.image ? (
						<img
							src={media.image}
							alt={media.name ?? 'NFT artwork'}
							referrerPolicy="no-referrer"
							className="size-full object-contain"
							onError={() => setFailedImage(media.image ?? null)}
						/>
					) : loading ? (
						<Skeleton className="size-full" />
					) : (
						<p className="text-sm text-muted-foreground">Artwork unavailable</p>
					)}
				</div>
				<div className="min-w-0 space-y-5">
					<div className="space-y-3 pr-6">
						{media?.collection || media?.collectionImage ? (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								{media.collectionImage && failedCollectionImage !== media.collectionImage ? (
									<img
										src={media.collectionImage}
										alt=""
										referrerPolicy="no-referrer"
										className="size-8 rounded-lg object-cover"
										onError={() => setFailedCollectionImage(media.collectionImage ?? null)}
									/>
								) : null}
								<span>{media.collection ?? 'Collection'}</span>
								{media.collectionAddress ? (
									<ExplorerLink
										value={media.collectionAddress}
										cluster={cluster}
										label="View collection on Solana Explorer"
									/>
								) : null}
							</div>
						) : null}
						<p className="text-2xl font-semibold tracking-tight">{media?.name ?? 'NFT details'}</p>
					</div>
					{media?.description ? (
						<p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
							{media.description}
						</p>
					) : null}
					<section className="space-y-2">
						<h3 className="text-sm font-medium">Details</h3>
						<dl className="divide-y divide-border rounded-xl border px-3">
							<div className="flex min-h-12 items-center justify-between gap-3">
								<dt className="text-xs text-muted-foreground">Mint</dt>
								<dd className="flex items-center font-mono text-xs">
									<span title={mint}>{shortAddress(mint)}</span>
									<CopyButton value={mint} label="Copy NFT mint" />
									<ExplorerLink value={mint} cluster={cluster} label="View NFT mint on Solana Explorer" />
								</dd>
							</div>
							<div className="flex min-h-12 items-center justify-between gap-3">
								<dt className="shrink-0 text-xs text-muted-foreground">NFT owner</dt>
								<dd className="min-w-0 py-2 text-xs">
									{media?.owner ? (
										<div className="flex items-center justify-end font-mono">
											<span title={media.owner}>{shortAddress(media.owner)}</span>
											<CopyButton value={media.owner} label="Copy NFT owner" />
											<ExplorerLink
												value={media.owner}
												cluster={cluster}
												label="View NFT owner on Solana Explorer"
											/>
										</div>
									) : (
										<span className="text-muted-foreground">Unavailable</span>
									)}
								</dd>
							</div>
							{media?.metadataUrl ? (
								<div className="flex min-h-12 items-center justify-between gap-3">
									<dt className="text-xs text-muted-foreground">Metadata</dt>
									<dd>
										<a
											href={media.metadataUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex min-h-11 items-center text-xs text-brand underline underline-offset-4 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
										>
											View JSON ↗
										</a>
									</dd>
								</div>
							) : null}
							{media?.tokenStandard ? (
								<div className="flex min-h-12 items-center justify-between gap-3">
									<dt className="shrink-0 text-xs text-muted-foreground">Token standard</dt>
									<dd className="text-right text-xs">{media.tokenStandard.replace(/([a-z])([A-Z])/g, '$1 $2')}</dd>
								</div>
							) : null}
							{media?.royaltyBps != null ? (
								<div className="flex min-h-12 items-center justify-between gap-3">
									<dt className="text-xs text-muted-foreground">Royalties</dt>
									<dd className="text-xs">{(media.royaltyBps / 100).toFixed(2)}%</dd>
								</div>
							) : null}
						</dl>
					</section>
					{media?.attributes.length ? (
						<section className="space-y-2">
							<h3 className="text-sm font-medium">Attributes</h3>
							<dl className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-3">
								{media.attributes.map((trait, i) => (
									<div key={i} className="min-w-0 rounded-xl bg-muted px-3 py-3">
										<dt className="text-xs break-words text-muted-foreground">{trait.label}</dt>
										<dd className="text-sm font-medium break-words">{trait.value}</dd>
									</div>
								))}
							</dl>
						</section>
					) : null}
				</div>
			</div>
		</ResponsiveSheet>
	);
}
