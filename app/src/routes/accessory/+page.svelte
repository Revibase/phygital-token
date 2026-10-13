<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import CollectibleDialog from '$lib/components/app/CollectibleDialog.svelte';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import List from '$lib/components/app/List.svelte';
	import ListRow from '$lib/components/app/ListRow.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import WalletConnect from '$lib/components/app/WalletConnect.svelte';
	import { shortAddress } from '$lib/shared/encoding';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import ReleaseSheet from '$lib/components/app/ReleaseSheet.svelte';
	import ResponsiveSheet from '$lib/components/app/ResponsiveSheet.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import ShortcutGrid from '$lib/components/app/ShortcutGrid.svelte';
	import TechnicalDetails from '$lib/components/app/TechnicalDetails.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		accessoryMediaQuery,
		accessoryPolicyQuery,
		accessoryShortcutsQuery
	} from '$lib/client/queries';
	import { rememberedWallet } from '$lib/client/memory';
	import { shortcutsFor } from '$lib/shared/shortcuts';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import {
		changedElsewhereNotice,
		tapScreen,
		managementActions
	} from '$lib/client/accessory/screen';

	let { data } = $props();
	const a = $derived(data.accessory);

	let nftOpen = $state(false);
	let detailsOpen = $state(false);
	let releaseOpen = $state(false);
	let manageOpen = $state(false);
	let ownerConnectOpen = $state(false);
	let refreshing = $state(false);

	// Reconnect silently; never prompt on an accessory visit.
	onMount(() => {
		walletStore.init(data.cluster);
		let checking = false;
		const refreshLink = async () => {
			if (document.visibilityState !== 'visible' || checking) return;
			checking = true;
			try {
				await invalidateAll();
			} catch {
				/* Keep the current screen usable while offline. */
			} finally {
				checking = false;
			}
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
	const management = $derived(a ? managementActions(a, owned) : null);
	function openManagement() {
		if (management?.hasActions) manageOpen = true;
		else detailsOpen = true;
	}

	const policyQuery = createQuery(() => ({
		...accessoryPolicyQuery(a?.pda ?? ''),
		enabled: manageOpen && !!a?.owner
	}));
	const walletDetail = $derived(
		!a?.owner
			? 'Optional · View only until claimed'
			: policyQuery.data === undefined
				? 'Optional'
				: `Optional · Tap to sign ${policyQuery.data ? 'on' : 'off'}`
	);

	const mediaQuery = createQuery(() => ({
		...accessoryMediaQuery(a?.pda ?? ''),
		enabled: !!a?.mint
	}));
	const media = $derived(mediaQuery.data ?? null);
	const namedCollectible = $derived(!!a?.mint);
	const collectibleLoading = $derived(namedCollectible && mediaQuery.isPending);
	const collectibleName = $derived(namedCollectible ? media?.name : null);

	const linkedIcon = $derived(owned ? walletStore.walletIcon : null);
	const linkedDetail = $derived(owned ? walletStore.walletName : null);

	const shortcutsQuery = createQuery(() => ({
		...accessoryShortcutsQuery(a?.pda ?? '', a?.owner ?? null),
		enabled: !!a?.mint
	}));
	const shortcuts = $derived(
		shortcutsQuery.data ? shortcutsFor(shortcutsQuery.data, 'mobile') : []
	);

	async function retry() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}
</script>

<svelte:head><title>Your accessory · Revibase</title></svelte:head>

<PageShell size="wide">
	{#if !a || !screen}
		<section class="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center">
			<Notice
				title="Couldn’t load this accessory"
				body="It’s genuine, but we couldn’t reach the network to load it. Check your connection and try again."
				onretry={retry}
				retrying={refreshing}
			/>
		</section>
	{:else}
		<section
			class="flex flex-1 flex-col justify-center gap-6 pt-4 pb-10 [@media(max-height:640px)]:gap-4 [@media(max-height:640px)]:pb-2 lg:grid lg:flex-none lg:grid-cols-[5fr_6fr] lg:items-center lg:gap-16 lg:py-0"
		>
			<div class="flex justify-center">
				{#if a.mint}
					<button
						type="button"
						aria-label="View NFT details"
						class="rounded-[26%] outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
						onclick={() => {
							nftOpen = true;
							void mediaQuery.refetch();
						}}
					>
						<AccessoryMark
							state="verified"
							size="xl"
							pda={a.pda}
							hasMint={!!a.mint}
							class="[@media(max-height:640px)]:size-20"
						/>
					</button>
				{:else}
					<AccessoryMark
						state="verified"
						size="xl"
						pda={a.pda}
						hasMint={!!a.mint}
						class="[@media(max-height:640px)]:size-20"
					/>
				{/if}
			</div>
			<div class="flex flex-col gap-8 lg:gap-6">
				{#if collectibleLoading}
					<div class="flex flex-col items-center gap-3 lg:items-start" aria-hidden="true">
						<Skeleton class="h-3.5 w-24" /><Skeleton class="h-7 w-56" /><Skeleton
							class="h-4 w-64"
						/>
					</div>
				{:else if collectibleName}
					<PageHeader
						align="center-mobile"
						eyebrow={`Genuine · ${a.tag}`}
						eyebrowTone="success"
						title={collectibleName}
						body={media?.collection ? `${media.collection} · ${screen.title}` : screen.title}
					>
						{#if screen.body}<p class="text-[15px] leading-relaxed text-muted-foreground">
								{screen.body}
							</p>{/if}
					</PageHeader>
				{:else}
					<PageHeader
						align="center-mobile"
						eyebrow={`Genuine · ${a.tag}`}
						eyebrowTone="success"
						title={a.status === 'unavailable' ? screen.title : 'Your accessory'}
						body={screen.body || screen.title}
					/>
				{/if}

				{#if changedElsewhere}
					<Notice tone="info" {...changedElsewhereNotice(a)} />
				{/if}

				{#if a.owner}<List label="Owner"
						><WalletRow
							address={a.owner}
							label={linkedDetail ?? 'Owner'}
							icon={linkedIcon}
							context="Manages this accessory"
							nftOwnership={media?.owner ? (media.owner === a.owner ? 'same' : 'different') : null}
							cluster={data.cluster}
						/></List
					>{/if}

				{#if shortcuts.length}
					<ShortcutGrid label={`From ${media?.collection ?? 'the project'}`} items={shortcuts} />
				{:else if a.mint && shortcutsQuery.isError}
					<Notice
						title="Couldn’t load project apps"
						onretry={() => void shortcutsQuery.refetch()}
						retrying={shortcutsQuery.isFetching}
					/>
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
			<div class="grid gap-2">
				{#if !a.owner}<p class="px-3 text-center text-[13px] text-muted-foreground">
						Claim it to manage its settings with your wallet.
					</p>{/if}
				<Button href="/accessory/link" size="xl"
					>{a.owner ? 'Claim this accessory' : 'Claim accessory'}</Button
				>
				<Button variant="quiet" class="w-full" onclick={openManagement}
					>{management?.hasActions ? 'Manage accessory' : 'Details'}</Button
				>
			</div>
		{:else}
			<Button variant="quiet" class="w-full" onclick={openManagement}
				>{management?.hasActions ? 'Manage accessory' : 'Details'}</Button
			>
		{/if}
	{/if}
{/snippet}

{#if a && screen}
	<ResponsiveSheet bind:open={manageOpen} title="Manage accessory">
		<List>
			{#if management?.connectOwner}<ListRow
					label="Connect as owner"
					detail="Change settings or release this accessory"
					onclick={() => {
						manageOpen = false;
						ownerConnectOpen = true;
					}}
					chevron
				/>{/if}
			{#if management?.changeOwner}<ListRow
					label="Change owner"
					detail="Choose a new owner"
					href="/accessory/link"
					chevron
				/>{/if}
			{#if management?.release}<ListRow
					label="Release accessory"
					detail="Let someone else claim it"
					tone="destructive"
					onclick={() => {
						manageOpen = false;
						releaseOpen = true;
					}}
					chevron
				/>{/if}
			<ListRow
				label="Accessory details"
				onclick={() => {
					manageOpen = false;
					detailsOpen = true;
				}}
				chevron
			/>
			<!-- Last: authenticating never needs the wallet. -->
			{#if management?.wallet}<ListRow
					label="Accessory wallet"
					detail={walletDetail}
					href={`/wallet/${encodeURIComponent(a.pda)}`}
					chevron
				/>{/if}
		</List>
	</ResponsiveSheet>
	{#if a.owner && a.canRelease}
		<WalletConnect
			bind:open={ownerConnectOpen}
			showButton={false}
			description={`Connect the owner’s wallet (${shortAddress(a.owner)}) to manage this accessory.`}
			requireAddress={a.owner}
			onconnected={() => (manageOpen = true)}
		/>
	{/if}
	<TechnicalDetails accessory={a} cluster={data.cluster} bind:open={detailsOpen} />
	{#if a.canRelease}<ReleaseSheet
			accessory={a}
			cluster={data.cluster}
			bind:open={releaseOpen}
		/>{/if}
{/if}

{#if a?.mint}
	<CollectibleDialog
		mint={a.mint}
		{media}
		cluster={data.cluster}
		loading={mediaQuery.isPending}
		bind:open={nftOpen}
	/>
{/if}
