<script lang="ts">
	import { shortAddress } from '$lib/shared/encoding';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import type { AccessoryMedia } from '$lib/client/media';
	import CopyButton from './CopyButton.svelte';
	import ExplorerLink from './ExplorerLink.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';

	let { open = $bindable(false), mint, media, cluster, loading = false }: {
		open?: boolean; mint: string; media: AccessoryMedia | null; cluster: string; loading?: boolean;
	} = $props();
	let failedImage = $state<string | null>(null);
	let failedCollectionImage = $state<string | null>(null);
</script>

<ResponsiveSheet bind:open title={media?.name ?? 'NFT details'} description="Artwork and metadata for this NFT." hideTitle wide>
		<div class="grid gap-6 md:grid-cols-2 md:gap-8">
			<div class="flex aspect-square items-center justify-center overflow-hidden rounded-[18px] bg-muted">
				{#if media?.image && failedImage !== media.image}
					<img src={media.image} alt={media.name ?? 'NFT artwork'} referrerpolicy="no-referrer" class="size-full object-contain" onerror={() => failedImage = media?.image ?? null} />
				{:else if loading}
					<Skeleton class="size-full" />
				{:else}
					<p class="text-sm text-muted-foreground">Artwork unavailable</p>
				{/if}
			</div>
			<div class="min-w-0 space-y-5">
				<div class="space-y-3 pr-6">
					{#if media?.collection || media?.collectionImage}
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							{#if media.collectionImage && failedCollectionImage !== media.collectionImage}<img src={media.collectionImage} alt="" referrerpolicy="no-referrer" class="size-8 rounded-lg object-cover" onerror={() => failedCollectionImage = media?.collectionImage ?? null} />{/if}
							<span>{media.collection ?? 'Collection'}</span>
							{#if media.collectionAddress}<ExplorerLink value={media.collectionAddress} {cluster} label="View collection on Solana Explorer" />{/if}
						</div>
					{/if}
					<p class="text-2xl font-semibold tracking-tight">{media?.name ?? 'NFT details'}</p>
				</div>
				{#if media?.description}<p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{media.description}</p>{/if}

				<section class="space-y-2">
					<h3 class="text-sm font-medium">Details</h3>
					<dl class="divide-y divide-border rounded-xl border px-3">
						<div class="flex min-h-12 items-center justify-between gap-3">
							<dt class="text-xs text-muted-foreground">Mint</dt>
							<dd class="flex items-center font-mono text-xs"><span title={mint}>{shortAddress(mint)}</span><CopyButton value={mint} label="Copy NFT mint" /><ExplorerLink value={mint} {cluster} label="View NFT mint on Solana Explorer" /></dd>
						</div>
						<div class="flex min-h-12 items-center justify-between gap-3">
							<dt class="shrink-0 text-xs text-muted-foreground">NFT owner</dt>
							<dd class="min-w-0 py-2 text-xs">
								{#if media?.owner}
									<div class="flex items-center justify-end font-mono"><span title={media.owner}>{shortAddress(media.owner)}</span><CopyButton value={media.owner} label="Copy NFT owner" /><ExplorerLink value={media.owner} {cluster} label="View NFT owner on Solana Explorer" /></div>
								{:else}<span class="text-muted-foreground">Unavailable</span>{/if}
							</dd>
						</div>
						{#if media?.metadataUrl}<div class="flex min-h-12 items-center justify-between gap-3"><dt class="text-xs text-muted-foreground">Metadata</dt><dd><a href={media.metadataUrl} target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center text-xs text-brand underline underline-offset-4 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">View JSON ↗</a></dd></div>{/if}
						{#if media?.tokenStandard}<div class="flex min-h-12 items-center justify-between gap-3"><dt class="shrink-0 text-xs text-muted-foreground">Token standard</dt><dd class="text-right text-xs">{media.tokenStandard.replace(/([a-z])([A-Z])/g, '$1 $2')}</dd></div>{/if}
						{#if media?.royaltyBps != null}<div class="flex min-h-12 items-center justify-between gap-3"><dt class="text-xs text-muted-foreground">Royalties</dt><dd class="text-xs">{(media.royaltyBps / 100).toFixed(2)}%</dd></div>{/if}
					</dl>
				</section>
				{#if media?.attributes.length}
					<section class="space-y-2">
						<h3 class="text-sm font-medium">Attributes</h3>
						<dl class="grid grid-cols-2 min-[360px]:grid-cols-3 gap-2">
							{#each media.attributes as trait}
								<div class="min-w-0 rounded-xl bg-muted px-3 py-3">
									<dt class="break-words text-xs text-muted-foreground">{trait.label}</dt>
									<dd class="break-words text-sm font-medium">{trait.value}</dd>
								</div>
							{/each}
						</dl>
					</section>
				{/if}
			</div>
		</div>
</ResponsiveSheet>
