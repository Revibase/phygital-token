<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { accessoryWalletQuery } from '$lib/client/queries';
	import { formatCompactTokenAmount, SOL_DECIMALS } from '$lib/shared/amount';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import BondVisual from '$lib/components/app/BondVisual.svelte';
	import Countdown from '$lib/components/app/Countdown.svelte';
	import List from '$lib/components/app/List.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import WalletConnect from '$lib/components/app/WalletConnect.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import NetworkFeeLine from '$lib/components/app/NetworkFeeLine.svelte';
	import { explorerUrl } from '$lib/shared/explorer';
	import { canTapHere, tapHint } from '$lib/client/capability';
	import { finishLink, prepareTap, tapAccessory, type FinishPhase, type PreparedTap } from '$lib/client/link/flow';
	import { describeError, linkErrorCopy, type FriendlyError } from '$lib/client/link/messages';
	import { linkCopy } from '$lib/client/accessory/link-copy';
	import { rememberRecentWallet, rememberWallet } from '$lib/client/memory';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { shortAddress } from '$lib/shared/encoding';

	let { data } = $props();
	const a = $derived(data.accessory);
	const copy = $derived(linkCopy(a.kind));

	let prepared = $state.raw<PreparedTap | null>(null);
	let tapped = $state.raw<Awaited<ReturnType<typeof tapAccessory>> | null>(null);
	let linked = $state<{ recipient: string; signature: string } | null>(null);
	let tapping = $state(false);
	let failure = $state<FriendlyError | null>(null);
	let phase = $state<FinishPhase | null>(null);
	let hint = $state('Tap Approve, then hold your accessory to your phone.');
	let webauthnOk = $state(true);

	type View = 'tap' | 'choose' | 'confirm' | 'done';
	const view = $derived.by((): View => {
		if (linked) return 'done';
		if (!tapped) return 'tap';
		return walletStore.address ? 'confirm' : 'choose';
	});
	const holdings = createQuery(() => ({ ...accessoryWalletQuery(a.pda), enabled: view === 'confirm' && !!a.owner && a.kind === 'bearer' }));

	/** Only claim "your wallet" when the wallet connected here is the one that was linked. */
	const ownedResult = $derived(!!linked && walletStore.address === linked.recipient);

	// Fetched when a tap is due, then re-fetched once as it goes stale (not polled).
	const STALE_MS = 45_000;
	let staleTimer: ReturnType<typeof setTimeout> | undefined;
	let preparing = false;
	let prepareFailures = 0;
	async function refreshChallenge() {
		if (tapped || tapping || preparing) return;
		preparing = true;
		try {
			prepared = await prepareTap(a.publicKey, data.rpId);
			prepareFailures = 0;
			clearTimeout(staleTimer);
			staleTimer = setTimeout(() => void refreshChallenge(), STALE_MS);
		} catch (err) {
			// Background refresh: only surface it if it keeps failing.
			if (++prepareFailures >= 2) failure = describeError(err);
		} finally {
			preparing = false;
		}
	}
	onDestroy(() => clearTimeout(staleTimer));

	onMount(() => {
		hint = `Tap Approve, then ${tapHint().charAt(0).toLowerCase()}${tapHint().slice(1)}`;
		webauthnOk = canTapHere();
		walletStore.init(data.cluster);
		void refreshChallenge();
	});

	/** The tap's slot hash aged out before the wallet approved: it can never land, so tap again. */
	function tapExpired() {
		if (phase || linked) return;
		tapped = null;
		failure = linkErrorCopy('too_slow');
		void refreshChallenge();
	}

	async function tap() {
		if (!prepared) return;
		tapping = true;
		failure = null;
		const challenge = prepared;
		prepared = null;
		try {
			tapped = await tapAccessory(challenge);
		} catch (err) {
			failure = describeError(err, 'tap');
		} finally {
			tapping = false;
			if (!tapped) void refreshChallenge();
		}
	}


	async function approveHere() {
		if (!tapped) return;
		const ctx = walletStore.signingContext();
		failure = null;
		try {
			const signature = await finishLink(tapped, ctx, (p) => (phase = p));
			linked = { recipient: ctx.address, signature };
			rememberWallet(a.pda, ctx.address);
			rememberRecentWallet(ctx.wallet.name);
		} catch (err) {
			failure = describeError(err);
		} finally {
			phase = null;
		}
	}
</script>

<svelte:head><title>{copy.pageTitle} · Revibase</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col pt-4" aria-live="polite">
		{#key view}
			<div class="animate-rise flex flex-1 flex-col gap-7">
				{#if view === 'done' && linked}
					<div class="flex flex-1 flex-col justify-center gap-8">
						<BondVisual wallet={linked.recipient} icon={ownedResult ? walletStore.walletIcon : null} pda={a.pda} hasMint={!!a.mint} />
						<PageHeader align="center" title={copy.done.title} body={copy.done.body(ownedResult, shortAddress(linked.recipient))} />
						<List><WalletRow address={linked.recipient} label="Owner" context="Manages this accessory" icon={ownedResult ? walletStore.walletIcon : null} cluster={data.cluster} /></List>
					</div>
				{:else}
					{#if view === 'tap'}
						<PageHeader step={{ current: 1, total: 2 }} title="Approve with your accessory" body={hint} />
					{:else if view === 'choose'}
						<PageHeader step={{ current: 2, total: 2 }} title={copy.choose.title} body={copy.choose.body} />
					{:else}
						<PageHeader step={{ current: 2, total: 2 }} title={copy.confirm.title} body={copy.confirm.body} />
					{/if}

					<Notice error={failure} />

					{#if view === 'tap'}
						<div class="grid flex-1 place-items-center py-6">
							<AccessoryMark state={tapping ? 'waiting' : 'idle'} pda={a.pda} hasMint={!!a.mint} />
						</div>
						{#if !webauthnOk}
							<Notice title="Open this page in Safari or Chrome" body="This browser can’t read your accessory." />
						{/if}
					{:else if view === 'choose'}
						<WalletConnect />
					{:else if view === 'confirm' && walletStore.address}
						<List><WalletRow address={walletStore.address} label={walletStore.walletName ?? 'Owner'} context="Owner · Manages this accessory" icon={walletStore.walletIcon} cluster={data.cluster} /></List>
						{#if a.owner && a.kind === 'bearer'}
							<p class="text-[14px] leading-relaxed text-muted-foreground">
								{#if holdings.data}Held with this accessory: {formatCompactTokenAmount(holdings.data.lamports, SOL_DECIMALS)} SOL · {holdings.data.tokens.length + (holdings.data.nfts?.length ?? 0)} other assets.{#if holdings.data.nftStatus === 'partial' || holdings.data.nftStatus === 'unavailable'} Some collectibles could not be loaded.{/if}
								{:else if holdings.isError}Assets could not be loaded. Any assets stay with the accessory and come under your control.
								{:else}Checking assets held with this accessory…{/if}
							</p>
						{/if}
						<NetworkFeeLine pda={a.pda} />
					{/if}

					{#if tapped && (view === 'choose' || view === 'confirm')}
						<Countdown until={tapped.expiresAt} onexpire={tapExpired} />
					{/if}
				{/if}
			</div>
		{/key}
	</section>

	{#snippet footer()}
		<div class="grid gap-1">
			{#if view === 'done' && linked}
				<Button href="/accessory" size="xl">Use accessory</Button>
				<Button variant="quiet" class="w-full" href={explorerUrl('tx', linked.signature, data.cluster)} target="_blank" rel="noopener noreferrer">View transaction</Button>
			{:else if view === 'tap' && webauthnOk}
				<Button size="xl" disabled={tapping || !prepared} onclick={tap}>
					{#if tapping}<Spinner /> Hold your accessory to your phone…{:else if !prepared}<Spinner /> Preparing…{:else}Approve{/if}
				</Button>
			{:else if view === 'confirm' && walletStore.address}
				<Button size="xl" disabled={!!phase} onclick={approveHere}>
					{#if phase === 'approve'}<Spinner /> {walletStore.approvePrompt}
					{:else if phase === 'confirming'}<Spinner /> Confirming…
					{:else if phase}<Spinner /> Preparing…
					{:else}{copy.action}{/if}
				</Button>
				<Button variant="quiet" class="w-full" disabled={!!phase} onclick={() => walletStore.disconnect()}>Use a different wallet</Button>
			{/if}
			{#if view !== 'done'}
				<Button variant="quiet" class="w-full" disabled={!!phase} onclick={() => goto('/accessory')}>Cancel</Button>
			{/if}
		</div>
	{/snippet}
</PageShell>
