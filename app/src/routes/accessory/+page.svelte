<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import List from '$lib/components/app/List.svelte';
	import ListRow from '$lib/components/app/ListRow.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import OpenInWalletSheet from '$lib/components/app/OpenInWalletSheet.svelte';
	import ReleaseSheet from '$lib/components/app/ReleaseSheet.svelte';
	import ShortcutGrid from '$lib/components/app/ShortcutGrid.svelte';
	import TechnicalDetails from '$lib/components/app/TechnicalDetails.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { createQuery } from '@tanstack/svelte-query';
	import { accessoryMediaQuery, accessoryShortcutsQuery } from '$lib/client/queries';
	import { recentWallet, rememberedWallet } from '$lib/client/memory';
	import { isLikelyWalletBrowser, platform, type Platform } from '$lib/client/capability';
	import { shortcutLaunch, walletLaunchHref, type ShortcutLaunch } from '$lib/client/shortcuts';
	import type { KnownWallet } from '$lib/client/wallet/catalog';
	import { shortcutsFor, type Shortcut } from '$lib/shared/shortcuts';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { changedElsewhereNotice, tapScreen } from '$lib/client/accessory/screen';

	let { data } = $props();
	const a = $derived(data.accessory);

	let detailsOpen = $state(false);
	let releaseOpen = $state(false);
	let refreshing = $state(false);

	// Silent reconnect only: if this browser already connected a wallet via
	// @solana/connector, we can tell whether the linked wallet is the viewer's.
	onMount(() => walletStore.init(data.cluster));

	const owned = $derived(!!a?.linkedWallet && walletStore.address === a.linkedWallet);

	// "Linked wallet changed" is only knowable against what this device linked before.
	let remembered = $state<string | null>(null);
	$effect(() => {
		if (a) remembered = rememberedWallet(a.pda);
	});
	const changedElsewhere = $derived(!!a?.linkedWallet && !!remembered && remembered !== a.linkedWallet);

	const screen = $derived(a ? tapScreen(a, owned) : null);

	// A collectible with metadata is introduced by its name; the ownership state moves to the line below.
	// Held as a skeleton while the metadata loads, so the title never swaps under the reader.
	const mediaQuery = createQuery(() => ({ ...accessoryMediaQuery(a?.pda ?? ''), enabled: !!a?.mint }));
	const media = $derived(mediaQuery.data ?? null);
	const namedCollectible = $derived(a?.kind === 'bearer' && !!a.mint);
	const collectibleLoading = $derived(namedCollectible && mediaQuery.isPending);
	const collectibleName = $derived(namedCollectible ? media?.name : null);

	// How each shortcut opens depends on this device, which is only known after hydration.
	const shortcutsQuery = createQuery(() => ({ ...accessoryShortcutsQuery(a?.pda ?? '', a?.linkedWallet ?? null), enabled: !!a?.mint }));
	let device = $state<{ platform: Platform; inWallet: boolean; recent: string | null; origin: string } | null>(null);
	onMount(() => {
		device = { platform: platform(), inWallet: isLikelyWalletBrowser(), recent: recentWallet(), origin: window.location.origin };
	});
	type Launchable = { s: Shortcut; index: number; launch: ShortcutLaunch };
	const shortcuts = $derived.by((): Launchable[] => {
		const d = device;
		const all = shortcutsQuery.data;
		if (!d || !all) return [];
		return shortcutsFor(all, d.platform === 'desktop' ? 'desktop' : 'mobile').map((s) => {
			const index = all.indexOf(s);
			return { s, index, launch: shortcutLaunch(s, d, index) };
		});
	});

	let picking = $state<Launchable | null>(null);
	let pickOpen = $state(false);
	function pickWallet(item: Launchable) {
		picking = item;
		pickOpen = true;
	}
	const pickHref = $derived.by(() => {
		const p = picking;
		const origin = device?.origin;
		return p && origin ? (w: KnownWallet) => walletLaunchHref(p.s, p.index, w, origin) : null;
	});

	async function retry() {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}
</script>

<svelte:head><title>Your accessory · Revibase</title></svelte:head>

<PageShell size="wide">
	{#if !a || !screen}
		<section class="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center">
			<Notice title="Couldn’t load this accessory" body="It’s genuine, but we couldn’t reach the network to load it. Check your connection and try again.">
				{#snippet actions()}
					<Button size="xl" disabled={refreshing} onclick={retry}>{refreshing ? 'Trying again…' : 'Try again'}</Button>
				{/snippet}
			</Notice>
		</section>
	{:else}
		<!-- Phone: one centred column. Desktop: two panes, the object on the left, what it is and what you can do on the right. -->
		<section class="flex flex-1 flex-col justify-center gap-6 pt-4 pb-10 [@media(max-height:640px)]:gap-4 [@media(max-height:640px)]:pb-2 lg:grid lg:flex-none lg:grid-cols-[5fr_6fr] lg:items-center lg:gap-16 lg:py-0">
			<div class="flex justify-center">
				<AccessoryMark state="verified" size="xl" pda={a.pda} hasMint={!!a.mint} class="[@media(max-height:640px)]:size-20" />
			</div>
			<div class="flex flex-col gap-8 lg:gap-6">
				{#if collectibleLoading}
					<div class="flex flex-col items-center gap-3 lg:items-start" aria-hidden="true">
						<Skeleton class="h-3.5 w-24" /><Skeleton class="h-7 w-56" /><Skeleton class="h-4 w-64" />
					</div>
				{:else if collectibleName}
					<PageHeader align="center-mobile" eyebrow={`Genuine · ${a.tag}`} eyebrowTone="success" title={collectibleName} body={media?.collection ? `${media.collection} · ${screen.title}` : screen.title}>
						<p class="text-[15px] leading-relaxed text-muted-foreground">{screen.body}</p>
					</PageHeader>
				{:else}
					<PageHeader align="center-mobile" eyebrow={`Genuine · ${a.tag}`} eyebrowTone="success" title={screen.title} body={screen.body} />
				{/if}

				{#if changedElsewhere}
					<Notice tone="info" {...changedElsewhereNotice(a)} />
				{/if}

				{#if a.linkedWallet && screen.walletLabel}
					<List footer={screen.footnote}>
						<WalletRow address={a.linkedWallet} label={screen.walletLabel} icon={owned ? walletStore.walletIcon : null} cluster={data.cluster} />
					</List>
				{/if}

				{#if shortcuts.length}
					<ShortcutGrid label={`From ${media?.collection ?? 'the project'}`} items={shortcuts} onpick={pickWallet} />
				{/if}

				<div class="hidden lg:block">{@render actions()}</div>
			</div>
		</section>
	{/if}

	{#snippet footer()}
		<div class="lg:hidden">{@render actions()}</div>
	{/snippet}
</PageShell>

{#snippet actions()}
	{#if a && screen}
		{#if screen.claim}
			<div class="grid gap-1">
				<Button href="/accessory/link" size="xl" class="w-full">Make it yours</Button>
				<Button variant="ghost" class="h-11 text-muted-foreground" onclick={() => (detailsOpen = true)}>Details</Button>
			</div>
		{:else}
			<List>
				{#if screen.move}
					<ListRow label="Move to another wallet" href="/accessory/link" chevron />
				{/if}
				{#if a.canRelease}
					<ListRow label="Unlink from wallet" onclick={() => (releaseOpen = true)} chevron />
				{/if}
				<ListRow label="Details" onclick={() => (detailsOpen = true)} chevron />
			</List>
		{/if}
	{/if}
{/snippet}

<OpenInWalletSheet hrefFor={pickHref} label={picking?.s.label ?? ''} bind:open={pickOpen} />

{#if a && screen}
	<TechnicalDetails accessory={a} cluster={data.cluster} bind:open={detailsOpen} />
	{#if a.canRelease}<ReleaseSheet accessory={a} cluster={data.cluster} bind:open={releaseOpen} />{/if}
{/if}
