<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onDestroy, onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import BondVisual from '$lib/components/app/BondVisual.svelte';
	import Countdown from '$lib/components/app/Countdown.svelte';
	import List from '$lib/components/app/List.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import QrCode from '$lib/components/app/QrCode.svelte';
	import WalletPicker from '$lib/components/app/WalletPicker.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import { canTapHere, isLikelyWalletBrowser, platform, tapHint } from '$lib/client/capability';
	import {
		finishLink,
		prepareTap,
		tapAccessory,
		type FinishPhase,
		type PreparedTap,
		type TappedAccessory
	} from '$lib/client/link/flow';
	import { describeError, linkErrorCopy, type FriendlyError } from '$lib/client/link/messages';
	import { linkCopy } from '$lib/client/accessory/link-copy';
	import { rememberAccessoryLink, rememberRecentWallet, rememberWallet } from '$lib/client/memory';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { shortAddress } from '$lib/shared/encoding';
	import { explorerUrl } from '$lib/shared/explorer';

	let { data } = $props();
	const accessory = $derived(data.accessory);
	const copy = $derived(linkCopy(accessory.kind));

	let prepared = $state.raw<PreparedTap | null>(null);
	let tapped = $state.raw<TappedAccessory | null>(null);
	let linked = $state<{ recipient: string; signature: string } | null>(null);
	let tapping = $state(false);
	let failure = $state<FriendlyError | null>(null);
	let connecting = $state<string | null>(null);
	let phase = $state<FinishPhase | null>(null);
	let hint = $state('Tap Approve, then hold your accessory to your phone.');
	let webauthnOk = $state(true);
	let device = $state<'pending' | 'desktop' | 'mobile'>('pending');

	type View = 'pending' | 'phone' | 'choose' | 'tap' | 'confirm' | 'done';
	const view = $derived.by((): View => {
		if (device === 'desktop') return 'phone';
		if (linked) return 'done';
		if (device === 'pending') return 'pending';
		if (!walletStore.address) return 'choose';
		if (!tapped) return 'tap';
		return 'confirm';
	});
	const ownedResult = $derived(!!linked && walletStore.address === linked.recipient);

	const STALE_MS = 45_000;
	let staleTimer: ReturnType<typeof setTimeout> | undefined;
	let prepareFailures = 0;
	let challengeEpoch = 0;
	async function refreshChallenge() {
		const recipient = walletStore.address;
		if (!recipient || tapped || tapping) return;
		const epoch = ++challengeEpoch;
		try {
			const next = await prepareTap(accessory.publicKey, data.rpId, recipient);
			if (epoch !== challengeEpoch || walletStore.address !== recipient || tapped) return;
			prepared = next;
			prepareFailures = 0;
			clearTimeout(staleTimer);
			staleTimer = setTimeout(() => void refreshChallenge(), STALE_MS);
		} catch (err) {
			if (epoch === challengeEpoch && ++prepareFailures >= 2) failure = describeError(err);
		}
	}
	onDestroy(() => clearTimeout(staleTimer));

	// The challenge names the connected wallet, so it is fetched only after connect.
	let watching: string | null = null;
	$effect(() => {
		const recipient = walletStore.address;
		if (tapping || phase || linked) return;
		if (recipient === watching) return;
		watching = recipient;
		if (tapped) tapped = null;
		prepared = null;
		clearTimeout(staleTimer);
		if (recipient) void refreshChallenge();
	});

	onMount(() => {
		if (platform() === 'desktop') {
			device = 'desktop';
			return;
		}
		device = 'mobile';
		hint = `Tap Approve, then ${tapHint().charAt(0).toLowerCase()}${tapHint().slice(1)}`;
		webauthnOk = canTapHere();
		walletStore.init(data.cluster);
	});

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
		clearTimeout(staleTimer);
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
		const context = walletStore.signingContext();
		failure = null;
		try {
			const signature = await finishLink(tapped, context, (next) => (phase = next));
			linked = { recipient: context.address, signature };
			rememberWallet(accessory.pda, context.address);
			rememberRecentWallet(context.wallet.name);
			rememberAccessoryLink(accessory.pda, {
				wallet: context.address,
				app: context.wallet.name,
				source: isLikelyWalletBrowser() ? 'wallet' : 'mobile'
			});
		} catch (err) {
			failure = describeError(err);
		} finally {
			phase = null;
		}
	}

	async function connectWallet(id: string) {
		connecting = id;
		failure = null;
		try {
			await walletStore.connect(id);
			rememberRecentWallet(walletStore.walletName);
		} catch (err) {
			failure = describeError(err);
		} finally {
			connecting = null;
		}
	}

	function cancel() {
		void goto('/accessory');
	}
</script>

<svelte:head><title>{copy.pageTitle} · Revibase</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col pt-4" aria-live="polite">
		{#key view}
			<div class="animate-rise flex flex-1 flex-col gap-7">
				{#if view === 'phone'}
					<div class="flex flex-1 flex-col justify-center gap-8">
						<PageHeader
							align="center"
							title="Continue on your phone"
							body="Claiming needs a tap, so it only works on a phone with NFC. Scan this code, then hold your accessory to your phone."
						/>
						<QrCode value={page.url.origin} label="Scan with your phone’s camera" />
					</div>
				{:else if view === 'pending'}
					<div class="flex-1"></div>
				{:else if view === 'done' && linked}
					<div class="flex flex-1 flex-col justify-center gap-8">
						<BondVisual
							wallet={linked.recipient}
							icon={ownedResult ? walletStore.walletIcon : null}
							pda={accessory.pda}
							hasMint={!!accessory.mint}
						/>
						<PageHeader
							align="center"
							title={copy.done.title}
							body={copy.done.body(ownedResult, shortAddress(linked.recipient))}
						/>
						<List>
							<WalletRow
								address={linked.recipient}
								label={ownedResult ? 'Your wallet' : 'Owner'}
								icon={ownedResult ? walletStore.walletIcon : null}
								cluster={data.cluster}
							/>
						</List>
					</div>
				{:else}
					{#if view === 'choose'}
						<PageHeader
							step={{ current: 1, total: 3 }}
							title={copy.choose.title}
							body={copy.choose.body}
						/>
					{:else if view === 'tap'}
						<PageHeader
							step={{ current: 2, total: 3 }}
							title="Approve with your accessory"
							body={hint}
						/>
					{:else}
						<PageHeader
							step={{ current: 3, total: 3 }}
							title={copy.confirm.title}
							body={copy.confirm.body}
						/>
					{/if}

					<Notice error={failure} />

					{#if view === 'choose'}
						<WalletPicker
							options={walletStore.options}
							{connecting}
							onpick={connectWallet}
							emptyHint="Open Revibase in a Solana wallet browser to connect."
						/>
					{:else if view === 'tap'}
						<div class="grid flex-1 place-items-center py-6">
							<AccessoryMark
								state={tapping ? 'waiting' : 'idle'}
								pda={accessory.pda}
								hasMint={!!accessory.mint}
							/>
						</div>
						{#if walletStore.address}
							<List>
								<WalletRow
									address={walletStore.address}
									label={walletStore.walletName ?? 'Owner'}
									icon={walletStore.walletIcon}
									cluster={data.cluster}
								/>
							</List>
							<Button
								variant="quiet"
								class="w-full"
								disabled={tapping}
								onclick={() => void walletStore.disconnect()}>Use a different wallet</Button
							>
						{/if}
						{#if !webauthnOk}
							<Notice
								title="Open this page in Safari or Chrome"
								body="This browser can’t read your accessory."
							/>
						{/if}
					{:else if view === 'confirm' && walletStore.address}
						<List>
							<WalletRow
								address={walletStore.address}
								label={walletStore.walletName ?? 'Owner'}
								icon={walletStore.walletIcon}
								cluster={data.cluster}
							/>
						</List>
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
				<Button href="/accessory" size="xl" class="w-full">Done</Button>
				<Button
					variant="quiet"
					class="w-full"
					href={explorerUrl('tx', linked.signature, data.cluster)}
					target="_blank"
					rel="noopener noreferrer">View transaction</Button
				>
			{:else if view === 'tap' && webauthnOk}
				<Button size="xl" class="w-full" disabled={tapping || !prepared} onclick={tap}>
					{#if tapping}<Spinner /> Hold your accessory to your phone…{:else if !prepared}<Spinner /> Preparing…{:else}Approve{/if}
				</Button>
			{:else if view === 'confirm' && walletStore.address}
				<Button size="xl" class="w-full" disabled={!!phase} onclick={approveHere}>
					{#if phase === 'approve'}<Spinner /> {walletStore.approvePrompt}
					{:else if phase === 'confirming'}<Spinner /> Confirming…
					{:else if phase}<Spinner /> Preparing…
					{:else}{copy.action}{/if}
				</Button>
			{/if}
			{#if view !== 'done'}
				<Button variant="quiet" class="w-full" disabled={!!phase} onclick={cancel}>Cancel</Button>
			{/if}
		</div>
	{/snippet}
</PageShell>
