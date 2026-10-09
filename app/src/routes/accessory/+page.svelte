<script lang="ts">
	import { untrack, onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import CollectibleDialog from '$lib/components/app/CollectibleDialog.svelte';
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
	import { forgetOwnerDetails, shouldChooseWallet, reconcileAccessoryWallet, accessoryLinkContext, type OwnerContext, recentConnectionMethod, accessoryConnectionMethod, type ConnectionMethod, recentWallet, rememberedWallet, accessoryWalletApp, rememberAccessoryWalletApp, rememberRecentWallet } from '$lib/client/memory';
	import { isLikelyWalletBrowser, platform, type Platform } from '$lib/client/capability';
	import { shortcutLaunch, walletLaunchHref, type ShortcutLaunch } from '$lib/client/shortcuts';
	import { KNOWN_WALLETS, type KnownWallet } from '$lib/client/wallet/catalog';
	import { shortcutsFor, type Shortcut } from '$lib/shared/shortcuts';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { changedElsewhereNotice, tapScreen } from '$lib/client/accessory/screen';

	let { data } = $props();
	const a = $derived(data.accessory);

	let nftOpen = $state(false);
	let linkedContext = $state<OwnerContext | null>(null);
	let detailsOpen = $state(false);
	let releaseOpen = $state(false);
	let refreshing = $state(false);

	// Reconnect silently; never prompt on an accessory visit.
	onMount(() => {
		walletStore.init(data.cluster);
		let checking = false;
		const refreshLink = async () => {
			if (document.visibilityState !== 'visible' || checking) return;
			checking = true;
			try { await invalidateAll(); } catch { /* Keep the current screen usable while offline. */ } finally { checking = false; }
		};
		window.addEventListener('focus', refreshLink);
		window.addEventListener('storage', refreshLink);
		document.addEventListener('visibilitychange', refreshLink);
		return () => {
			window.removeEventListener('focus', refreshLink);
			window.removeEventListener('storage', refreshLink);
			document.removeEventListener('visibilitychange', refreshLink);
		};
	});

	const owned = $derived(!!a?.owner && walletStore.address === a.owner);

	// "Owner changed" is only knowable against what this device linked before.
	let remembered = $state<string | null>(null);
	$effect(() => {
		if (a) remembered = rememberedWallet(a.pda);
	});
	const changedElsewhere = $derived(!!a?.owner && !!remembered && remembered !== a.owner);

	const screen = $derived(a ? tapScreen(a, owned) : null);

	const mediaQuery = createQuery(() => ({ ...accessoryMediaQuery(a?.pda ?? ''), enabled: !!a?.mint }));
	const media = $derived(mediaQuery.data ?? null);
	const namedCollectible = $derived(!!a?.mint);
	const collectibleLoading = $derived(namedCollectible && mediaQuery.isPending);
	const collectibleName = $derived(namedCollectible ? media?.name : null);

	const linkedApp = $derived(linkedContext?.app ?? (owned ? walletStore.walletName : null));
	const linkedIcon = $derived(KNOWN_WALLETS.find(w => linkedApp && w.match.test(linkedApp))?.icon ?? (owned && walletStore.walletName === linkedApp ? walletStore.walletIcon : null));
	const linkedDetail = $derived([linkedApp, linkedContext ? ({desktop:'Linked from desktop', mobile:'Linked from mobile browser', wallet:'Linked in wallet app'}[linkedContext.source]) : null].filter(Boolean).join(' · ') || null);

	const shortcutsQuery = createQuery(() => ({ ...accessoryShortcutsQuery(a?.pda ?? '', a?.owner ?? null), enabled: !!a?.mint }));
	let device = $state<{ platform: Platform; inWallet: boolean; recent: string | null; method: ConnectionMethod | null; chooseWallet?: boolean; origin: string } | null>(null);
	onMount(() => {
		linkedContext = a ? accessoryLinkContext(a.pda, a.owner) : null;
		device = { chooseWallet: shouldChooseWallet(a?.pda ?? ''), method: (a ? accessoryConnectionMethod(a.pda, a.owner) : null) ?? recentConnectionMethod(), platform: platform(), inWallet: isLikelyWalletBrowser(), recent: (a ? accessoryWalletApp(a.pda, a.owner) : null) ?? recentWallet(), origin: window.location.origin };
	});
	$effect(() => {
		const current = a;
		untrack(() => {
			if (!device || !current) return;
			const stale = reconcileAccessoryWallet(current.pda, current.owner);
			linkedContext = accessoryLinkContext(current.pda, current.owner);
			device = { ...device, chooseWallet: shouldChooseWallet(a?.pda ?? ''),
				recent: accessoryWalletApp(current.pda, current.owner) ?? (stale ? null : recentWallet()),
				method: accessoryConnectionMethod(current.pda, current.owner) ?? (stale ? null : recentConnectionMethod())
			};
		});
	});
	function forgetApps() {
		if (a) forgetOwnerDetails(a.pda);
		linkedContext = null;
		if (device) device = { ...device, recent: null, method: null, chooseWallet: true };
	}
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
		try { await invalidateAll(); } finally { refreshing = false; }
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
		<section class="flex flex-1 flex-col justify-center gap-6 pt-4 pb-10 [@media(max-height:640px)]:gap-4 [@media(max-height:640px)]:pb-2 lg:grid lg:flex-none lg:grid-cols-[5fr_6fr] lg:items-center lg:gap-16 lg:py-0">
			<div class="flex justify-center">
				{#if a.mint}
					<button type="button" aria-label="View NFT details" class="rounded-[26%] outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4" onclick={() => { nftOpen = true; void mediaQuery.refetch(); }}>
						<AccessoryMark state="verified" size="xl" pda={a.pda} hasMint={!!a.mint} class="[@media(max-height:640px)]:size-20" />
					</button>
				{:else}
					<AccessoryMark state="verified" size="xl" pda={a.pda} hasMint={!!a.mint} class="[@media(max-height:640px)]:size-20" />
				{/if}
			</div>
			<div class="flex flex-col gap-8 lg:gap-6">
				{#if collectibleLoading}
					<div class="flex flex-col items-center gap-3 lg:items-start" aria-hidden="true">
						<Skeleton class="h-3.5 w-24" /><Skeleton class="h-7 w-56" /><Skeleton class="h-4 w-64" />
					</div>
				{:else if collectibleName}
					<PageHeader align="center-mobile" eyebrow={`Genuine · ${a.tag}`} eyebrowTone="success" title={collectibleName} body={media?.collection ? `${media.collection} · ${screen.title}` : screen.title}>
						{#if screen.body}<p class="text-[15px] leading-relaxed text-muted-foreground">{screen.body}</p>{/if}
					</PageHeader>
				{:else}
					<PageHeader align="center-mobile" eyebrow={`Genuine · ${a.tag}`} eyebrowTone="success" title={screen.title} body={screen.body} />
				{/if}

				{#if changedElsewhere}
					<Notice tone="info" {...changedElsewhereNotice(a)} />
				{/if}

				{#if a.owner && screen.walletLabel}
					<List footer={screen.footnote}>
						<WalletRow address={a.owner} label={screen.walletLabel} icon={linkedIcon} context={linkedDetail} nftOwnership={media?.owner ? (media.owner === a.owner ? 'same' : 'different') : null} onforget={linkedContext?.app || (a && accessoryWalletApp(a.pda, a.owner)) ? forgetApps : undefined} cluster={data.cluster} />
					</List>
				{/if}

				{#if shortcuts.length}
					<ShortcutGrid label={`From ${media?.collection ?? 'the project'}`} items={shortcuts} onpick={pickWallet} />
				{:else if a.mint && shortcutsQuery.isError}
					<Notice title="Couldn’t load project apps">
						{#snippet actions()}<Button variant="secondary" class="h-11 w-full" disabled={shortcutsQuery.isFetching} onclick={() => void shortcutsQuery.refetch()}>{shortcutsQuery.isFetching ? 'Trying again…' : 'Try again'}</Button>{/snippet}
					</Notice>
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
				<Button href="/accessory/link" size="xl" class="w-full">Link a wallet</Button>
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

<OpenInWalletSheet browserHref={picking ? (picking.s.proof ? `/shortcut/${picking.index}` : picking.s.href) : null} onbrowser={() => {
	rememberRecentWallet(device?.recent ?? 'Browser', 'browser');
	if (a) rememberAccessoryWalletApp(a.pda, a.owner, device?.recent ?? 'Browser', 'browser');
	if (device) device = { ...device, method: 'browser', chooseWallet: false };
}} destination={picking?.s.href ?? null} hrefFor={pickHref} label={picking?.s.label ?? ''} onchoose={(w) => {
	rememberRecentWallet(w.name);
	if (a) rememberAccessoryWalletApp(a.pda, a.owner, w.name);
	if (device) device = { ...device, recent: w.name, method: 'wallet', chooseWallet: false };
}} bind:open={pickOpen} />

{#if a && screen}
	<TechnicalDetails accessory={a} cluster={data.cluster} bind:open={detailsOpen} />
	{#if a.canRelease}<ReleaseSheet accessory={a} cluster={data.cluster} bind:open={releaseOpen} />{/if}
{/if}

{#if a?.mint}
	<CollectibleDialog mint={a.mint} {media} cluster={data.cluster} loading={mediaQuery.isPending} bind:open={nftOpen} />
{/if}
